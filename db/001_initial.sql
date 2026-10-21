-- PostgreSQL 15+. Apply via psql -v ON_ERROR_STOP=1 -f db/001_initial.sql.
BEGIN;
CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customers (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  name text,
  PRIMARY KEY (workspace_id,id)
);
CREATE TABLE price_versions (
  id uuid PRIMARY KEY,
  model text NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  input_micros_per_million bigint NOT NULL CHECK (input_micros_per_million >= 0),
  output_micros_per_million bigint NOT NULL CHECK (output_micros_per_million >= 0),
  cached_input_micros_per_million bigint CHECK (cached_input_micros_per_million >= 0),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX price_versions_lookup ON price_versions(model,effective_from);
CREATE TABLE usage_events (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 200),
  customer_id text NOT NULL,
  model text NOT NULL,
  occurred_at timestamptz NOT NULL,
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  cached_input_tokens bigint NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0 AND cached_input_tokens <= input_tokens),
  reported_cost_micros bigint CHECK (reported_cost_micros >= 0),
  calculated_cost_micros bigint CHECK (calculated_cost_micros >= 0),
  cost_source text NOT NULL CHECK (cost_source IN ('reported','estimated','unknown')),
  price_version_id uuid REFERENCES price_versions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,event_id),
  FOREIGN KEY (workspace_id,customer_id) REFERENCES customers(workspace_id,id),
  CHECK ((cost_source = 'unknown' AND calculated_cost_micros IS NULL) OR
         (cost_source <> 'unknown' AND calculated_cost_micros IS NOT NULL))
);
CREATE INDEX usage_events_customer_period ON usage_events(workspace_id,customer_id,occurred_at);
CREATE TABLE revenue_records (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  customer_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  amount_micros bigint NOT NULL CHECK (amount_micros >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,customer_id) REFERENCES customers(workspace_id,id)
);
CREATE INDEX revenue_customer_period ON revenue_records(workspace_id,customer_id,occurred_at);
COMMIT;
