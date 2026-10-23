#!/usr/bin/env bash
# Post-restore checks for newly created synthetic drill databases only.
set -euo pipefail
restored_db=${1:-}
[[ "${GITHUB_ACTIONS:-}" == true && "${PGDATABASE:-}" == agentmargin_ci && \
   "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" == 5432 && \
   "${PGUSER:-}" == agentmargin_ci && \
   "$restored_db" =~ ^agentmargin_(restore|backup)_ci_[a-f0-9]{12}$ ]] || exit 2
sql() { psql -XAt -v ON_ERROR_STOP=1 --dbname="$restored_db" -c "$1"; }
# --no-acl deliberately omits original ACLs. Quarantine those default function
# grants before any runtime access. The runtime template repeats this step and
# grants only its exact public entry points when an operator provisions a role.
sql 'REVOKE ALL ON SCHEMA agentmargin_auth FROM PUBLIC;
     REVOKE ALL ON ALL FUNCTIONS IN SCHEMA agentmargin_auth FROM PUBLIC' >/dev/null
predicates=(
 "SELECT count(*)=2 FROM pg_catalog.pg_trigger WHERE tgname='enforce_delivery_transition' AND tgfoid='agentmargin_auth.enforce_delivery_transition()'::regprocedure AND tgenabled='O'"
 "SELECT count(*)=10 FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relrowsecurity"
 "SELECT count(*)=3 FROM pg_catalog.pg_proc WHERE oid IN ('agentmargin_auth.validate_adjustment()'::regprocedure,'agentmargin_auth.validate_stripe_adjustment_source()'::regprocedure,'agentmargin_auth.record_delivery_transition()'::regprocedure) AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']"
 "SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='agentmargin_auth'::regnamespace AND a.grantee=0 AND a.privilege_type='EXECUTE')"
 "SELECT count(*)=0 FROM agentmargin_auth.principal(NULL)"
 "SELECT NOT EXISTS(SELECT 1 FROM revenue_adjustments a JOIN revenue_records p ON p.workspace_id=a.workspace_id AND p.id=a.original_payment_id WHERE a.customer_id<>p.customer_id OR a.currency<>p.currency OR a.occurred_at<p.occurred_at)"
 "SELECT NOT EXISTS(SELECT 1 FROM revenue_records p JOIN (SELECT workspace_id,original_payment_id,sum(amount_micros) AS reductions FROM revenue_adjustments GROUP BY workspace_id,original_payment_id) a ON a.workspace_id=p.workspace_id AND a.original_payment_id=p.id WHERE a.reductions>p.amount_micros)"
 "SELECT NOT EXISTS(SELECT 1 FROM revenue_adjustments a LEFT JOIN revenue_payment_sources s ON a.workspace_id=s.workspace_id AND a.original_payment_id=s.record_id AND a.provider_account=s.provider_account WHERE a.provider='stripe' AND s.record_id IS NULL)"
)
for predicate in "${predicates[@]}"; do
  [[ "$(sql "$predicate")" == t ]] || { echo 'Post-restore security/financial probe failed.' >&2; exit 1; }
done
echo 'Post-restore RLS, private definer ACLs, missing-proof denial and financial integrity: PASSED (synthetic only)'
