-- Append-only USD accounting reductions. Original positive records stay intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Existing contracts explicitly recorded USD micros. No FX conversion is implied.
ALTER TABLE revenue_records ADD COLUMN currency text NOT NULL DEFAULT 'USD' CHECK (currency='USD');
CREATE TABLE revenue_adjustments (
 workspace_id uuid NOT NULL,
 id text NOT NULL,
 original_payment_id text NOT NULL,
 customer_id text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('refund','credit','payment_reversal')),
 amount_micros bigint NOT NULL CHECK (amount_micros>0),
 currency text NOT NULL CHECK (currency='USD'),
 occurred_at timestamptz NOT NULL,
 provider text NOT NULL CHECK (provider ~ '^[a-z0-9_]{1,32}$'),
 provider_account text NOT NULL CHECK (provider_account ~ '^[A-Za-z0-9:_-]{1,200}$'),
 source_object_id text NOT NULL CHECK (source_object_id ~ '^[A-Za-z0-9:_-]{1,200}$'),
 evidence_ref text NOT NULL CHECK (length(evidence_ref) BETWEEN 1 AND 500),
 payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,provider,provider_account,source_object_id),
 FOREIGN KEY(workspace_id,original_payment_id) REFERENCES revenue_records(workspace_id,id),
 FOREIGN KEY(workspace_id,customer_id) REFERENCES customers(workspace_id,id),
 CHECK(id='adj:'||encode(sha256(convert_to(provider||chr(10)||provider_account||chr(10)||source_object_id,'UTF8')),'hex'))
);
CREATE INDEX revenue_adjustments_payment ON revenue_adjustments(workspace_id,original_payment_id);
CREATE INDEX revenue_adjustments_period ON revenue_adjustments(workspace_id,occurred_at);
ALTER TABLE revenue_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON revenue_adjustments FOR SELECT
 USING(workspace_id=(SELECT agentmargin_auth.workspace('read')));
CREATE POLICY tenant_insert ON revenue_adjustments FOR INSERT
 WITH CHECK(workspace_id=(SELECT agentmargin_auth.workspace('ingest')));
REVOKE ALL ON revenue_adjustments FROM PUBLIC;

CREATE FUNCTION agentmargin_auth.validate_adjustment() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original public.revenue_records%ROWTYPE; reductions numeric;
BEGIN
 -- BEFORE triggers precede RLS WITH CHECK. Reject a forged tenant before any
 -- privileged lookup, including error-based existence probes. Trusted owner
 -- maintenance remains outside the runtime boundary.
 IF session_user<>(SELECT rolname FROM pg_roles WHERE oid=(SELECT relowner FROM pg_class WHERE oid='public.revenue_adjustments'::regclass))
    AND NEW.workspace_id IS DISTINCT FROM agentmargin_auth.workspace('ingest') THEN
   RAISE EXCEPTION 'Adjustment authorization denied' USING ERRCODE='42501';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
   RAISE EXCEPTION 'Adjustments require READ COMMITTED' USING ERRCODE='23514';
 END IF;
 -- Lock the payment before reading reductions. Each subsequent VOLATILE query
 -- gets a fresh READ COMMITTED snapshot after any concurrent writer commits.
 SELECT * INTO original FROM public.revenue_records
   WHERE workspace_id=NEW.workspace_id AND id=NEW.original_payment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original payment not found' USING ERRCODE='23503'; END IF;
 IF original.customer_id<>NEW.customer_id OR original.currency<>NEW.currency
    OR NEW.occurred_at<original.occurred_at THEN
   RAISE EXCEPTION 'Adjustment payment attribution mismatch' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(amount_micros),0) INTO reductions FROM public.revenue_adjustments
   WHERE workspace_id=NEW.workspace_id AND original_payment_id=NEW.original_payment_id;
 IF reductions+NEW.amount_micros>original.amount_micros THEN
   RAISE EXCEPTION 'Adjustment exceeds original payment' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agentmargin_auth.validate_adjustment() FROM PUBLIC;
CREATE TRIGGER validate_adjustment BEFORE INSERT ON revenue_adjustments
 FOR EACH ROW EXECUTE FUNCTION agentmargin_auth.validate_adjustment();
CREATE FUNCTION agentmargin_auth.immutable_financial_record() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Financial records are append-only' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION agentmargin_auth.immutable_financial_record() FROM PUBLIC;
CREATE TRIGGER immutable_adjustment BEFORE UPDATE OR DELETE OR TRUNCATE ON revenue_adjustments
 FOR EACH STATEMENT EXECUTE FUNCTION agentmargin_auth.immutable_financial_record();
CREATE TRIGGER immutable_payment BEFORE UPDATE OR DELETE OR TRUNCATE ON revenue_records
 FOR EACH STATEMENT EXECUTE FUNCTION agentmargin_auth.immutable_financial_record();

CREATE OR REPLACE FUNCTION agentmargin_auth.event_digest(tenant uuid, kind text, event_id text)
RETURNS TABLE(payload_digest text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT u.payload_digest FROM public.usage_events u
 WHERE event_digest.kind='usage' AND tenant=agentmargin_auth.workspace('ingest')
   AND u.workspace_id=tenant AND u.event_id=event_digest.event_id
 UNION ALL
 SELECT r.payload_digest FROM public.revenue_records r
 WHERE event_digest.kind='revenue' AND tenant=agentmargin_auth.workspace('ingest')
   AND r.workspace_id=tenant AND r.id=event_id
 UNION ALL
 SELECT a.payload_digest FROM public.revenue_adjustments a
 WHERE event_digest.kind='adjustment' AND tenant=agentmargin_auth.workspace('ingest')
   AND a.workspace_id=tenant AND a.id=event_id
$$;
COMMIT;
