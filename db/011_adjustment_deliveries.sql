-- Durable normalized adjustment receipts and account-bound payment provenance.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE revenue_deliveries ADD UNIQUE(workspace_id,provider_event_id,provider_account,record_id);
CREATE TABLE revenue_payment_sources (
 workspace_id uuid NOT NULL,
 record_id text NOT NULL,
 provider_account text NOT NULL,
 provider_event_id text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(workspace_id,record_id),
 FOREIGN KEY(workspace_id,record_id) REFERENCES revenue_records(workspace_id,id),
 FOREIGN KEY(workspace_id,provider_event_id,provider_account,record_id)
   REFERENCES revenue_deliveries(workspace_id,provider_event_id,provider_account,record_id)
);
ALTER TABLE revenue_payment_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON revenue_payment_sources FOR SELECT
 USING(workspace_id=(SELECT agentmargin_auth.workspace()));
CREATE POLICY tenant_insert ON revenue_payment_sources FOR INSERT
 WITH CHECK(workspace_id=(SELECT agentmargin_auth.workspace('ingest')));
REVOKE ALL ON revenue_payment_sources FROM PUBLIC;
CREATE TRIGGER immutable_payment_source BEFORE UPDATE OR DELETE OR TRUNCATE ON revenue_payment_sources
 FOR EACH STATEMENT EXECUTE FUNCTION agentmargin_auth.immutable_financial_record();
-- No guessed provenance backfill for legacy direct payments or completed inbox
-- records: an operator must review those mappings against original evidence.
CREATE FUNCTION agentmargin_auth.validate_stripe_adjustment_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.provider<>'stripe' THEN RETURN NEW; END IF;
 IF session_user<>(SELECT rolname FROM pg_roles WHERE oid=(SELECT relowner FROM pg_class WHERE oid='public.revenue_adjustments'::regclass))
    AND NEW.workspace_id IS DISTINCT FROM agentmargin_auth.workspace('ingest') THEN
   RAISE EXCEPTION 'Adjustment authorization denied' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.revenue_payment_sources s WHERE s.workspace_id=NEW.workspace_id
   AND s.record_id=NEW.original_payment_id AND s.provider_account<>NEW.provider_account) THEN
   RAISE EXCEPTION 'Original payment account mismatch' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.revenue_payment_sources s
   WHERE s.workspace_id=NEW.workspace_id AND s.record_id=NEW.original_payment_id
     AND s.provider_account=NEW.provider_account) THEN
   RAISE EXCEPTION 'Original payment account evidence missing' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agentmargin_auth.validate_stripe_adjustment_source() FROM PUBLIC;
CREATE TRIGGER validate_stripe_adjustment_source BEFORE INSERT ON revenue_adjustments
 FOR EACH ROW EXECUTE FUNCTION agentmargin_auth.validate_stripe_adjustment_source();
CREATE TABLE adjustment_deliveries (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 provider_event_id text NOT NULL CHECK(provider_event_id ~ '^evt_[A-Za-z0-9_]{1,196}$'),
 provider_account text NOT NULL CHECK(provider_account ~ '^[A-Za-z0-9:_-]{1,200}$'),
 record jsonb NOT NULL CHECK((jsonb_typeof(record)='object' AND record->>'provider'='stripe'
   AND record->>'providerAccount'=provider_account AND record->>'currency'='USD') IS TRUE),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
 available_at timestamptz NOT NULL DEFAULT now(),
 received_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,
 error_class text CHECK(error_class IN ('idempotency_conflict','database_retry','invalid_record','unmatched_payment')),
 PRIMARY KEY(workspace_id,provider_event_id),
 CHECK((state='delivered')=(delivered_at IS NOT NULL)),
 CHECK(state<>'failed' OR error_class IS NOT NULL)
);
CREATE INDEX adjustment_delivery_pending ON adjustment_deliveries(workspace_id,available_at,received_at) WHERE state='pending';
ALTER TABLE adjustment_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON adjustment_deliveries FOR SELECT USING(workspace_id=(SELECT agentmargin_auth.workspace()));
CREATE POLICY tenant_insert ON adjustment_deliveries FOR INSERT WITH CHECK(workspace_id=(SELECT agentmargin_auth.workspace('ingest')));
CREATE POLICY tenant_update ON adjustment_deliveries FOR UPDATE
 USING(workspace_id=(SELECT agentmargin_auth.workspace('ingest')))
 WITH CHECK(workspace_id=(SELECT agentmargin_auth.workspace('ingest')));
REVOKE ALL ON adjustment_deliveries FROM PUBLIC;
COMMIT;
