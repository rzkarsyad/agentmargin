-- v0.3: append-only workspace price versions, isolated from legacy global prices.
-- Apply AFTER 003_revenue_ingestion.sql. PostgreSQL 15+.
BEGIN;
CREATE TABLE workspace_price_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  input_micros_per_million bigint NOT NULL CHECK (input_micros_per_million >= 0),
  output_micros_per_million bigint NOT NULL CHECK (output_micros_per_million >= 0),
  cached_input_micros_per_million bigint CHECK (cached_input_micros_per_million >= 0),
  source_note text NOT NULL CHECK (length(source_note) BETWEEN 3 AND 500),
  created_by_key_digest text NOT NULL CHECK (length(created_by_key_digest) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,model,effective_from),
  UNIQUE(workspace_id,id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX workspace_price_versions_lookup
  ON workspace_price_versions(workspace_id,model,effective_from DESC);
-- A priced usage event may reference only a price version in its own workspace.
ALTER TABLE usage_events ADD COLUMN workspace_price_version_id uuid;
ALTER TABLE usage_events ADD CONSTRAINT usage_workspace_price_version_fk
 FOREIGN KEY (workspace_id,workspace_price_version_id)
 REFERENCES workspace_price_versions(workspace_id,id);
CREATE FUNCTION reject_workspace_price_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Workspace pricing history is append-only';
END;
$$;
CREATE TRIGGER workspace_prices_immutable BEFORE UPDATE OR DELETE
 ON workspace_price_versions FOR EACH ROW EXECUTE FUNCTION reject_workspace_price_mutation();
COMMIT;
