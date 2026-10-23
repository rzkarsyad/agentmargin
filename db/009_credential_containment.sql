-- PostgreSQL 16: reject reusable pre-revocation snapshots; narrow ingest reads.
-- Apply after 008 with traffic drained and matching API/grants ready.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE OR REPLACE FUNCTION agentmargin_auth.principal(credential text)
RETURNS TABLE(workspace_id uuid, access_role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT k.workspace_id, k.access_role FROM public.workspace_api_keys k
  WHERE current_setting('transaction_isolation') = 'read committed'
    AND credential ~ '^am_[A-Za-z0-9_-]{32,}$' AND length(credential) <= 256
    AND k.key_digest = encode(sha256(convert_to(credential, 'UTF8')), 'hex')
    AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > statement_timestamp())
$$;
ALTER POLICY tenant_read ON customers
 USING (workspace_id = (SELECT agentmargin_auth.workspace('read')));
ALTER POLICY tenant_read ON usage_events
 USING (workspace_id = (SELECT agentmargin_auth.workspace('read')));
ALTER POLICY tenant_read ON revenue_records
 USING (workspace_id = (SELECT agentmargin_auth.workspace('read')));
-- Exact-ID replay oracle only: no customer, amount, timestamp, or bulk enumeration.
-- Owner is the trusted migrator, never the runtime; no dynamic SQL or public EXECUTE.
CREATE FUNCTION agentmargin_auth.event_digest(tenant uuid, kind text, event_id text)
RETURNS TABLE(payload_digest text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT u.payload_digest FROM public.usage_events u
 WHERE kind='usage' AND tenant=agentmargin_auth.workspace('ingest')
   AND u.workspace_id=tenant AND u.event_id=event_digest.event_id
 UNION ALL
 SELECT r.payload_digest FROM public.revenue_records r
 WHERE kind='revenue' AND tenant=agentmargin_auth.workspace('ingest')
   AND r.workspace_id=tenant AND r.id=event_id
$$;
REVOKE ALL ON FUNCTION agentmargin_auth.event_digest(uuid,text,text) FROM PUBLIC;
COMMIT;
