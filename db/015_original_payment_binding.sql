-- AM-01: authority follows immutable payment provenance, never an adjustment label.
-- Do not rewrite applied migrations or historical accounting records.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE OR REPLACE FUNCTION agentmargin_auth.validate_stripe_adjustment_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE payment_account pg_catalog.text;
BEGIN
 IF session_user<>(SELECT r.rolname FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_class c ON c.relowner=r.oid WHERE c.oid='public.revenue_adjustments'::regclass)
    AND NEW.workspace_id IS DISTINCT FROM agentmargin_auth.workspace('ingest') THEN
   RAISE EXCEPTION 'Adjustment authorization denied' USING ERRCODE='42501';
 END IF;
 -- validate_adjustment runs first and locks the original payment. The source is
 -- append-only and is written atomically with a normalized Stripe payment.
 SELECT s.provider_account INTO payment_account FROM public.revenue_payment_sources s
   WHERE s.workspace_id=NEW.workspace_id AND s.record_id=NEW.original_payment_id;
 IF FOUND THEN
   IF NEW.provider<>'stripe' OR NEW.provider_account<>payment_account THEN
     RAISE EXCEPTION 'Original payment provider or account mismatch' USING ERRCODE='23514';
   END IF;
 ELSIF NEW.provider='stripe' THEN
   RAISE EXCEPTION 'Original payment account evidence missing' USING ERRCODE='23503';
 END IF;
 -- Generic provider labels remain compatible only for payments without Stripe
 -- source evidence. Labels are asserted provenance, not independent verification.
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agentmargin_auth.validate_stripe_adjustment_source() FROM PUBLIC;
-- Provenance may arrive after a legacy direct payment. Serialize with adjustment
-- validation so attaching a Stripe account cannot bless contradictory history.
CREATE FUNCTION agentmargin_auth.validate_payment_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user<>(SELECT r.rolname FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_class c ON c.relowner=r.oid WHERE c.oid='public.revenue_payment_sources'::regclass)
    AND NEW.workspace_id IS DISTINCT FROM agentmargin_auth.workspace('ingest') THEN
   RAISE EXCEPTION 'Payment source authorization denied' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.revenue_records WHERE workspace_id=NEW.workspace_id AND id=NEW.record_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.revenue_adjustments a WHERE a.workspace_id=NEW.workspace_id
   AND a.original_payment_id=NEW.record_id AND (a.provider<>'stripe' OR a.provider_account<>NEW.provider_account)) THEN
   RAISE EXCEPTION 'Payment source conflicts with adjustment history' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agentmargin_auth.validate_payment_source() FROM PUBLIC;
CREATE TRIGGER validate_payment_source BEFORE INSERT ON revenue_payment_sources
 FOR EACH ROW EXECUTE FUNCTION agentmargin_auth.validate_payment_source();
COMMIT;
