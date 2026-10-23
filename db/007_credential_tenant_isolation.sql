-- Additive PostgreSQL 16 tenant boundary. Apply after 006 as the trusted owner.
-- Deploy the matching API and reapply runtime_privileges.psql before resuming traffic.
BEGIN;
CREATE SCHEMA agentmargin_auth;
REVOKE ALL ON SCHEMA agentmargin_auth FROM PUBLIC;

-- Only this narrow function can inspect key digests. No dynamic SQL, tenant
-- parameter, or caller-controlled search_path. Raw keys are never persisted.
CREATE FUNCTION agentmargin_auth.principal(credential text)
RETURNS TABLE(workspace_id uuid, access_role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT k.workspace_id, k.access_role FROM public.workspace_api_keys k
  WHERE credential ~ '^am_[A-Za-z0-9_-]{32,}$'
    AND length(credential) <= 256
    AND k.key_digest = encode(sha256(convert_to(credential, 'UTF8')), 'hex')
    AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > statement_timestamp())
$$;
REVOKE ALL ON FUNCTION agentmargin_auth.principal(text) FROM PUBLIC;

-- The setting contains proof of key possession, never an asserted workspace ID.
-- Changing it to another workspace ID or a known digest grants no authority.
CREATE FUNCTION agentmargin_auth.workspace(required_role text DEFAULT NULL)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT p.workspace_id
  FROM agentmargin_auth.principal(current_setting('agentmargin.api_key', true)) p
  WHERE required_role IS NULL OR p.access_role = 'admin' OR p.access_role = required_role
$$;
REVOKE ALL ON FUNCTION agentmargin_auth.workspace(text) FROM PUBLIC;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_price_versions ENABLE ROW LEVEL SECURITY;
-- Ingest requires reading existing digests and prices for replay safety. HTTP
-- read/ingest capabilities remain distinct; DB reads are bounded to the key's tenant.
CREATE POLICY tenant_read ON customers FOR SELECT
 USING (workspace_id = (SELECT agentmargin_auth.workspace()));
CREATE POLICY tenant_insert ON customers FOR INSERT
 WITH CHECK (workspace_id = (SELECT agentmargin_auth.workspace('ingest')));
CREATE POLICY tenant_read ON usage_events FOR SELECT
 USING (workspace_id = (SELECT agentmargin_auth.workspace()));
CREATE POLICY tenant_insert ON usage_events FOR INSERT
 WITH CHECK (workspace_id = (SELECT agentmargin_auth.workspace('ingest')));
CREATE POLICY tenant_read ON revenue_records FOR SELECT
 USING (workspace_id = (SELECT agentmargin_auth.workspace()));
CREATE POLICY tenant_insert ON revenue_records FOR INSERT
 WITH CHECK (workspace_id = (SELECT agentmargin_auth.workspace('ingest')));
CREATE POLICY tenant_read ON workspace_price_versions FOR SELECT
 USING (workspace_id = (SELECT agentmargin_auth.workspace()));
CREATE POLICY tenant_insert ON workspace_price_versions FOR INSERT
 WITH CHECK (workspace_id = (SELECT agentmargin_auth.workspace('admin'))
   AND created_by_key_digest = encode(sha256(convert_to(current_setting('agentmargin.api_key', true), 'UTF8')), 'hex'));
COMMIT;
