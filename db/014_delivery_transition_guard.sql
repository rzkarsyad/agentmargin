-- Keep direct runtime state grants from bypassing reviewed dead-letter recovery.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE FUNCTION agentmargin_auth.enforce_delivery_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 -- The reviewed SECURITY DEFINER recovery function updates as the trusted owner.
 -- Direct runtime callers (even holding an admin bearer key) must use that RPC.
 IF current_user<>(SELECT r.rolname FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_class c ON c.relowner=r.oid WHERE c.oid=TG_RELID) THEN
   IF OLD.state<>'pending' OR NEW.attempts<>OLD.attempts+1 OR NEW.retry_cycle<>OLD.retry_cycle
      OR NEW.available_at<statement_timestamp()+make_interval(secs=>least(300,power(2,NEW.attempts)::integer))
      OR (NEW.state='pending' AND (NEW.attempts>=8 OR NEW.error_class IS NULL OR NEW.error_class NOT IN ('database_retry','unmatched_payment'))) THEN
     RAISE EXCEPTION 'Delivery transition requires normal replay or reviewed recovery' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agentmargin_auth.enforce_delivery_transition() FROM PUBLIC;
CREATE TRIGGER enforce_delivery_transition BEFORE UPDATE ON revenue_deliveries
 FOR EACH ROW EXECUTE FUNCTION agentmargin_auth.enforce_delivery_transition();
CREATE TRIGGER enforce_delivery_transition BEFORE UPDATE ON adjustment_deliveries
 FOR EACH ROW EXECUTE FUNCTION agentmargin_auth.enforce_delivery_transition();
COMMIT;
