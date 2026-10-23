-- Apply AFTER 004_workspace_pricing.sql. PostgreSQL 15+.
-- Existing keys retain their prior full-access behavior (admin) until rotated.
BEGIN;
ALTER TABLE workspace_api_keys
  ADD COLUMN access_role text NOT NULL DEFAULT 'admin'
  CHECK (access_role IN ('admin','ingest','read'));
COMMIT;
