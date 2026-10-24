-- Additive AM-04/05/06 hardening; snapshot only an approved migrated schema.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER FUNCTION agentmargin_auth.principal(text) SET search_path=pg_catalog,pg_temp;
ALTER FUNCTION agentmargin_auth.workspace(text) SET search_path=pg_catalog,pg_temp;
ALTER FUNCTION agentmargin_auth.event_digest(uuid,text,text) SET search_path=pg_catalog,pg_temp;
ALTER FUNCTION agentmargin_auth.requeue_delivery(uuid,text,text,text,text,uuid) SET search_path=pg_catalog,pg_temp;
CREATE FUNCTION agentmargin_auth.verify_delivery_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.state<>'delivered' THEN RETURN NEW; END IF;
 IF session_user<>(SELECT r.rolname FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_class c ON c.relowner=r.oid WHERE c.oid=TG_RELID) THEN
   IF NEW.workspace_id IS DISTINCT FROM agentmargin_auth.workspace('ingest') THEN
     RAISE EXCEPTION 'Delivery authorization changed' USING ERRCODE='42501';
   END IF;
   IF NEW.state='delivered' THEN
     IF TG_TABLE_NAME='revenue_deliveries' THEN
       IF NOT EXISTS(SELECT 1 FROM public.revenue_records r JOIN public.revenue_payment_sources s ON s.workspace_id=r.workspace_id AND s.record_id=r.id
         WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.record_id AND r.customer_id=NEW.customer_id
           AND r.occurred_at=NEW.occurred_at AND r.amount_micros=NEW.amount_micros AND r.payload_digest=NEW.payload_digest
           AND s.provider_account=NEW.provider_account) THEN
         RAISE EXCEPTION 'Delivered payment evidence missing' USING ERRCODE='23514';
       END IF;
     ELSIF NOT EXISTS(SELECT 1 FROM public.revenue_adjustments a WHERE a.workspace_id=NEW.workspace_id
       AND a.id=NEW.record->>'id' AND a.payload_digest=NEW.record->>'payloadDigest' AND a.payload_digest=NEW.payload_digest
       AND a.original_payment_id=NEW.record->>'originalPaymentId' AND a.customer_id=NEW.record->>'customerId'
       AND a.kind=NEW.record->>'kind' AND a.amount_micros::text=NEW.record->>'amountMicros'
       AND a.currency=NEW.record->>'currency' AND a.occurred_at=(NEW.record->>'occurredAt')::timestamptz
       AND a.source_object_id=NEW.record->>'sourceObjectId' AND a.evidence_ref=NEW.record->>'evidenceRef'
       AND a.provider='stripe' AND a.provider=NEW.record->>'provider'
       AND a.provider_account=NEW.provider_account AND a.provider_account=NEW.record->>'providerAccount') THEN
       RAISE EXCEPTION 'Delivered adjustment evidence missing' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agentmargin_auth.verify_delivery_completion() FROM PUBLIC;
CREATE TRIGGER verify_delivery_completion BEFORE UPDATE ON revenue_deliveries
 FOR EACH ROW EXECUTE FUNCTION agentmargin_auth.verify_delivery_completion();
CREATE TRIGGER verify_delivery_completion BEFORE UPDATE ON adjustment_deliveries
 FOR EACH ROW EXECUTE FUNCTION agentmargin_auth.verify_delivery_completion();

-- The owner-only baseline detects accidental/post-provisioning drift. It is NOT
-- a boundary against a malicious migrator who can alter both data and verifier.
CREATE FUNCTION agentmargin_auth.installed_contract() RETURNS TABLE(kind text,identity text,digest text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
 SELECT 'policy',n.nspname||'.'||c.relname||'.'||p.polname,
   md5(concat_ws('|',p.polcmd,p.polpermissive,p.polroles::text,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)))
 FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'function',p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))
 FROM pg_catalog.pg_proc p WHERE p.pronamespace='agentmargin_auth'::regnamespace
 UNION ALL
 SELECT 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,md5(pg_get_triggerdef(t.oid)||t.tgenabled::text)
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
$$;
REVOKE ALL ON FUNCTION agentmargin_auth.installed_contract() FROM PUBLIC;
CREATE TABLE agentmargin_auth.security_contract AS SELECT * FROM agentmargin_auth.installed_contract();
ALTER TABLE agentmargin_auth.security_contract ADD PRIMARY KEY(kind,identity);
REVOKE ALL ON agentmargin_auth.security_contract FROM PUBLIC;
COMMIT;
