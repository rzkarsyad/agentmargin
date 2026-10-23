-- Additive containment: never change applied migration checksums.
-- Explicit pg_temp-last plus qualified catalogs prevent temporary relation shadowing.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE OR REPLACE FUNCTION agentmargin_auth.validate_adjustment() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE original public.revenue_records%ROWTYPE; reductions numeric;
BEGIN
 -- BEFORE triggers precede RLS WITH CHECK. Reject a forged tenant before any
 -- privileged lookup, including error-based existence probes. Trusted owner
 -- maintenance remains outside the runtime boundary.
 IF session_user<>(SELECT rolname FROM pg_catalog.pg_roles WHERE oid=(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.revenue_adjustments'::regclass))
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

CREATE OR REPLACE FUNCTION agentmargin_auth.validate_stripe_adjustment_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.provider<>'stripe' THEN RETURN NEW; END IF;
 IF session_user<>(SELECT rolname FROM pg_catalog.pg_roles WHERE oid=(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.revenue_adjustments'::regclass))
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

CREATE OR REPLACE FUNCTION agentmargin_auth.record_delivery_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 -- BEFORE any privileged insert, validate actual key possession for runtime calls.
 -- The trusted owner/migrator is outside this boundary.
 IF session_user<>(SELECT rolname FROM pg_catalog.pg_roles WHERE oid=(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.delivery_history'::regclass))
    AND NEW.workspace_id IS DISTINCT FROM agentmargin_auth.workspace('ingest') THEN
   RAISE EXCEPTION 'Delivery authorization changed' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' OR (OLD.state,OLD.attempts,OLD.retry_cycle,OLD.error_class) IS DISTINCT FROM
                       (NEW.state,NEW.attempts,NEW.retry_cycle,NEW.error_class) THEN
   INSERT INTO public.delivery_history(workspace_id,kind,provider_event_id,payload_digest,operation,previous_state,state,attempts,retry_cycle,error_class)
   VALUES(NEW.workspace_id,CASE WHEN TG_TABLE_NAME='revenue_deliveries' THEN 'payment' ELSE 'adjustment' END,
     NEW.provider_event_id,NEW.payload_digest,CASE WHEN TG_OP='INSERT' THEN 'enqueue' WHEN OLD.retry_cycle<>NEW.retry_cycle THEN 'requeue' ELSE 'transition' END,
     CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.state END,NEW.state,NEW.attempts,NEW.retry_cycle,NEW.error_class);
 END IF;
 RETURN NEW;
END $$;
COMMIT;
