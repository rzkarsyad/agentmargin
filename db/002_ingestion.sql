-- Apply AFTER 001_initial.sql. PostgreSQL 15+.
BEGIN;
CREATE TABLE workspace_api_keys (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key_digest text NOT NULL UNIQUE CHECK (length(key_digest) = 64),
  name text NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_workspace ON workspace_api_keys(workspace_id);
ALTER TABLE usage_events ADD COLUMN payload_digest text;
-- Legacy rows predate this field; the new ingestion API only writes non-null digests.
CREATE INDEX usage_events_created ON usage_events(workspace_id,created_at);
COMMIT;
