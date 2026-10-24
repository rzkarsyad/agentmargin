#!/usr/bin/env bash
# Post-restore checks for newly created synthetic drill databases only.
set -euo pipefail
restored_db=${1:-}
[[ "${GITHUB_ACTIONS:-}" == true && "${PGDATABASE:-}" == agentmargin_ci && \
   "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" == 5432 && \
   "${PGUSER:-}" == agentmargin_ci && \
   "$restored_db" =~ ^agentmargin_(restore|backup)_ci_[a-f0-9]{12}$ ]] || exit 2
sql() { psql -XAt -v ON_ERROR_STOP=1 --dbname="$restored_db" -c "$1"; }
# Inspect BEFORE repair: no ACL revocation may make this probe tautological.
[[ "${AGENTMARGIN_RESTORE_OWNER:-}" =~ ^agentmargin_restore_owner_[a-f0-9]{12}$ && -n "${AGENTMARGIN_RESTORE_OWNER_PASSWORD:-}" ]] || exit 2
owner_sql(){ PGUSER="$AGENTMARGIN_RESTORE_OWNER" PGPASSWORD="$AGENTMARGIN_RESTORE_OWNER_PASSWORD" psql -XAt -v ON_ERROR_STOP=1 --dbname="$restored_db" -c "$1"; }
predicates=(
 "SELECT count(*)=2 FROM pg_catalog.pg_trigger WHERE tgname='enforce_delivery_transition' AND tgfoid='agentmargin_auth.enforce_delivery_transition()'::regprocedure AND tgenabled='O'"
 "SELECT count(*)=10 FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relrowsecurity"
 "SELECT count(*)=3 FROM pg_catalog.pg_proc WHERE oid IN ('agentmargin_auth.validate_adjustment()'::regprocedure,'agentmargin_auth.validate_stripe_adjustment_source()'::regprocedure,'agentmargin_auth.record_delivery_transition()'::regprocedure) AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']"
 "SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='agentmargin_auth'::regnamespace AND a.grantee=0 AND a.privilege_type='EXECUTE')"
 "SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE p.pronamespace='agentmargin_auth'::regnamespace AND (r.rolsuper OR r.rolbypassrls OR r.rolname<>'$AGENTMARGIN_RESTORE_OWNER' OR (p.prosecdef AND NOT p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'])))"
 "SELECT NOT EXISTS((SELECT * FROM agentmargin_auth.installed_contract() EXCEPT SELECT * FROM agentmargin_auth.security_contract) UNION ALL (SELECT * FROM agentmargin_auth.security_contract EXCEPT SELECT * FROM agentmargin_auth.installed_contract()))"
 "SELECT count(*)=0 FROM agentmargin_auth.principal(NULL)"
 "SELECT NOT EXISTS(SELECT 1 FROM revenue_adjustments a JOIN revenue_records p ON p.workspace_id=a.workspace_id AND p.id=a.original_payment_id WHERE a.customer_id<>p.customer_id OR a.currency<>p.currency OR a.occurred_at<p.occurred_at)"
 "SELECT NOT EXISTS(SELECT 1 FROM revenue_records p JOIN (SELECT workspace_id,original_payment_id,sum(amount_micros) AS reductions FROM revenue_adjustments GROUP BY workspace_id,original_payment_id) a ON a.workspace_id=p.workspace_id AND a.original_payment_id=p.id WHERE a.reductions>p.amount_micros)"
 "SELECT NOT EXISTS(SELECT 1 FROM revenue_adjustments a LEFT JOIN revenue_payment_sources s ON a.workspace_id=s.workspace_id AND a.original_payment_id=s.record_id AND a.provider_account=s.provider_account WHERE (a.provider='stripe' AND s.record_id IS NULL) OR EXISTS(SELECT 1 FROM revenue_payment_sources bound WHERE bound.workspace_id=a.workspace_id AND bound.record_id=a.original_payment_id AND (a.provider<>'stripe' OR a.provider_account<>bound.provider_account)))"
)
for predicate in "${predicates[@]}"; do
  [[ "$(sql "$predicate")" == t ]] || { echo 'Post-restore security/financial probe failed.' >&2; exit 1; }
done
echo 'Post-restore RLS, private definer ACLs, missing-proof denial and financial integrity: PASSED (synthetic only)'

# Demonstrate the pre-revocation backup risk while isolated, then fail closed.
[[ "${AGENTMARGIN_RESTORE_PRE_REVOKE_KEY:-}" =~ ^am_[a-f0-9]{64}$ ]] || exit 2
[[ $(sql "SELECT count(*) FROM agentmargin_auth.principal('$AGENTMARGIN_RESTORE_PRE_REVOKE_KEY')") == 1 ]] || exit 1
psql -Xq -v ON_ERROR_STOP=1 --dbname="$restored_db" -v restore_database="$restored_db" \
 -v restore_confirmation=invalidate-all-restored-keys -f db/quarantine_restored_credentials.psql >/dev/null
[[ $(sql "SELECT count(*) FROM agentmargin_auth.principal('$AGENTMARGIN_RESTORE_PRE_REVOKE_KEY')") == 0 ]] || exit 1
[[ $(sql 'SELECT count(*) FROM workspace_api_keys WHERE revoked_at IS NULL') == 0 ]] || exit 1
echo 'Pre-revocation backup resurrection REPRODUCED; restored keys quarantined before runtime provisioning: PASSED'

# Authenticate a genuine fresh restricted LOGIN, not SET ROLE in an owner
# session (session_user owner exemptions would make that a misleading probe).
probe_role="agentmargin_restore_probe_$(openssl rand -hex 6)"
probe_password=$(openssl rand -hex 24)
probe_key="am_$(openssl rand -hex 32)"
probe_other_key="am_$(openssl rand -hex 32)"
probe_tenant=$(sql 'SELECT gen_random_uuid()')
probe_other=$(sql 'SELECT gen_random_uuid()')
cleanup_probe(){
 local code=$?
 trap - EXIT
 # Only the newly provisioned disposable role is cleaned; never source roles.
 sql "DROP OWNED BY \"$probe_role\"; DROP ROLE \"$probe_role\"" >/dev/null 2>&1 || code=1
 exit "$code"
}
# Values are locally generated restricted alphabets, never user-supplied SQL.
sql "CREATE ROLE \"$probe_role\" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$probe_password'" >/dev/null
trap cleanup_probe EXIT
psql -X -v ON_ERROR_STOP=1 --dbname="$restored_db" -v runtime_role="$probe_role" -f db/runtime_privileges.psql >/dev/null
owner_sql "INSERT INTO public.workspaces(id,name) VALUES('$probe_tenant','agentmargin-qa restore A'),('$probe_other','agentmargin-qa restore B');
 INSERT INTO public.workspace_api_keys(id,workspace_id,key_digest,name,access_role) VALUES
 (gen_random_uuid(),'$probe_tenant',encode(sha256(convert_to('$probe_key','UTF8')),'hex'),'restore-probe','admin'),
 (gen_random_uuid(),'$probe_other',encode(sha256(convert_to('$probe_other_key','UTF8')),'hex'),'restore-probe','admin');
 INSERT INTO public.customers(workspace_id,id) VALUES('$probe_tenant','restore-probe'),('$probe_other','restore-probe');
 INSERT INTO public.revenue_records(workspace_id,id,customer_id,occurred_at,amount_micros) VALUES
 ('$probe_tenant','restore-probe','restore-probe','2026-10-10Z',7),('$probe_other','restore-probe','restore-probe','2026-10-10Z',11)" >/dev/null
runtime_sql(){
 PGUSER="$probe_role" PGPASSWORD="$probe_password" psql -X -v ON_ERROR_STOP=1 --dbname="$restored_db" >/dev/null
}
runtime_sql <<SQL
DO \$probe\$
BEGIN
 IF EXISTS(SELECT 1 FROM public.revenue_records) OR EXISTS(SELECT 1 FROM public.delivery_history)
    OR EXISTS(SELECT 1 FROM public.delivery_requeues) THEN RAISE EXCEPTION 'Missing proof read allowed'; END IF;
 BEGIN PERFORM key_digest FROM public.workspace_api_keys; RAISE EXCEPTION 'Authentication table read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('agentmargin.api_key','$probe_key',true);
 IF (SELECT count(*) FROM public.revenue_records)<>1 OR
    EXISTS(SELECT 1 FROM public.revenue_records WHERE workspace_id<>'$probe_tenant') THEN
   RAISE EXCEPTION 'Restored tenant read isolation failed'; END IF;
 BEGIN
  INSERT INTO public.customers(workspace_id,id) VALUES('$probe_other','cross-tenant-probe');
  RAISE EXCEPTION 'Cross-tenant insert allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.revenue_records; RAISE EXCEPTION 'Financial delete allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO public.customers(workspace_id,id) VALUES('$probe_tenant','authorized-probe');
END \$probe\$;
DO \$probe\$ BEGIN
 IF EXISTS(SELECT 1 FROM public.revenue_records) THEN RAISE EXCEPTION 'Transaction proof leaked'; END IF;
END \$probe\$;
SQL
sql "UPDATE public.workspace_api_keys SET revoked_at=now() WHERE workspace_id='$probe_tenant';
 UPDATE public.workspace_api_keys SET expires_at=now()-interval '1 second' WHERE workspace_id='$probe_other'" >/dev/null
runtime_sql <<SQL
DO \$probe\$ BEGIN
 PERFORM set_config('agentmargin.api_key','$probe_key',true);
 IF EXISTS(SELECT 1 FROM public.revenue_records) OR EXISTS(SELECT 1 FROM agentmargin_auth.principal('$probe_key')) THEN
   RAISE EXCEPTION 'Revoked proof accepted after restore'; END IF;
 PERFORM set_config('agentmargin.api_key','$probe_other_key',true);
 IF EXISTS(SELECT 1 FROM public.revenue_records) OR EXISTS(SELECT 1 FROM agentmargin_auth.principal('$probe_other_key')) THEN
   RAISE EXCEPTION 'Expired proof accepted after restore'; END IF;
END \$probe\$;
SQL
echo 'Post-restore restricted LOGIN: missing/revoked/expired proof, tenant SELECT/INSERT, transaction reuse and immutable permission probes PASSED (synthetic only)'
