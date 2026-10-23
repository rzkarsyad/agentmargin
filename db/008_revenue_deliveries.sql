-- Optional durable normalized-revenue inbox. Apply after migration 007.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE revenue_deliveries (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  provider_event_id text NOT NULL CHECK (provider_event_id ~ '^evt_[A-Za-z0-9_]{1,196}$'),
  provider_account text NOT NULL CHECK (length(provider_account) BETWEEN 1 AND 200),
  record_id text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 200),
  customer_id text NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 200),
  occurred_at timestamptz NOT NULL,
  amount_micros bigint NOT NULL CHECK (amount_micros >= 0),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  available_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  error_class text CHECK (error_class IN ('idempotency_conflict','database_retry','invalid_record')),
  PRIMARY KEY(workspace_id,provider_event_id),
  CHECK ((state='delivered') = (delivered_at IS NOT NULL)),
  CHECK (state<>'failed' OR error_class IS NOT NULL)
);
CREATE INDEX revenue_delivery_pending ON revenue_deliveries(workspace_id,available_at,received_at)
 WHERE state='pending';
ALTER TABLE revenue_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON revenue_deliveries FOR SELECT
 USING (workspace_id=(SELECT agentmargin_auth.workspace()));
CREATE POLICY tenant_insert ON revenue_deliveries FOR INSERT
 WITH CHECK (workspace_id=(SELECT agentmargin_auth.workspace('ingest')));
CREATE POLICY tenant_update ON revenue_deliveries FOR UPDATE
 USING (workspace_id=(SELECT agentmargin_auth.workspace('ingest')))
 WITH CHECK (workspace_id=(SELECT agentmargin_auth.workspace('ingest')));
REVOKE ALL ON TABLE revenue_deliveries FROM PUBLIC;
COMMIT;
