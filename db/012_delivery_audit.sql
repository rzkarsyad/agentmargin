-- Append-only delivery transitions and explicitly reviewed dead-letter recovery.
-- Existing attempt counts are checkpoints, never fabricated historical attempts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE revenue_deliveries ADD COLUMN retry_cycle integer NOT NULL DEFAULT 0 CHECK(retry_cycle BETWEEN 0 AND 3);
ALTER TABLE adjustment_deliveries ADD COLUMN retry_cycle integer NOT NULL DEFAULT 0 CHECK(retry_cycle BETWEEN 0 AND 3);
CREATE TABLE delivery_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 kind text NOT NULL CHECK(kind IN ('payment','adjustment')),
 provider_event_id text NOT NULL,
 payload_digest text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('checkpoint','enqueue','transition','requeue')),
 previous_state text,
 state text NOT NULL,
 attempts integer NOT NULL,
 retry_cycle integer NOT NULL,
 error_class text,
 database_actor name NOT NULL DEFAULT session_user,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX delivery_history_event ON delivery_history(workspace_id,kind,provider_event_id,recorded_at,id);
CREATE TABLE delivery_requeues (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 request_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('payment','adjustment')),
 provider_event_id text NOT NULL,
 payload_digest text NOT NULL,
 review_ref text NOT NULL CHECK(review_ref ~ '^[A-Za-z0-9:/._-]{1,200}$'),
 authorizing_key_id uuid NOT NULL,
 retry_cycle integer NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,request_id)
);
ALTER TABLE delivery_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_requeues ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON delivery_history FOR SELECT USING(workspace_id=(SELECT agentmargin_auth.workspace('read')));
CREATE POLICY tenant_read ON delivery_requeues FOR SELECT USING(workspace_id=(SELECT agentmargin_auth.workspace('admin')));
REVOKE ALL ON delivery_history,delivery_requeues FROM PUBLIC;
CREATE TRIGGER immutable_delivery_history BEFORE UPDATE OR DELETE OR TRUNCATE ON delivery_history
 FOR EACH STATEMENT EXECUTE FUNCTION agentmargin_auth.immutable_financial_record();
CREATE TRIGGER immutable_delivery_requeue BEFORE UPDATE OR DELETE OR TRUNCATE ON delivery_requeues
 FOR EACH STATEMENT EXECUTE FUNCTION agentmargin_auth.immutable_financial_record();
INSERT INTO delivery_history(workspace_id,kind,provider_event_id,payload_digest,operation,state,attempts,retry_cycle,error_class)
 SELECT workspace_id,'payment',provider_event_id,payload_digest,'checkpoint',state,attempts,retry_cycle,error_class FROM revenue_deliveries
 UNION ALL
 SELECT workspace_id,'adjustment',provider_event_id,payload_digest,'checkpoint',state,attempts,retry_cycle,error_class FROM adjustment_deliveries;
CREATE FUNCTION agentmargin_auth.record_delivery_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- BEFORE any privileged insert, validate actual key possession for runtime calls.
 -- The trusted owner/migrator is outside this boundary.
 IF session_user<>(SELECT rolname FROM pg_roles WHERE oid=(SELECT relowner FROM pg_class WHERE oid='public.delivery_history'::regclass))
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
REVOKE ALL ON FUNCTION agentmargin_auth.record_delivery_transition() FROM PUBLIC;
CREATE TRIGGER delivery_history AFTER INSERT OR UPDATE ON revenue_deliveries FOR EACH ROW EXECUTE FUNCTION agentmargin_auth.record_delivery_transition();
CREATE TRIGGER delivery_history AFTER INSERT OR UPDATE ON adjustment_deliveries FOR EACH ROW EXECUTE FUNCTION agentmargin_auth.record_delivery_transition();

CREATE FUNCTION agentmargin_auth.requeue_delivery(tenant uuid, delivery_kind text, event_id text,
 expected_digest text, review text, request uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job record; receipt public.delivery_requeues%ROWTYPE; key_id uuid;
BEGIN
 IF tenant IS DISTINCT FROM agentmargin_auth.workspace('admin') THEN
   RAISE EXCEPTION 'Admin authorization required' USING ERRCODE='42501';
 END IF;
 IF delivery_kind NOT IN ('payment','adjustment') OR delivery_kind IS NULL OR request IS NULL
    OR review IS NULL OR review !~ '^[A-Za-z0-9:/._-]{1,200}$'
    OR expected_digest IS NULL OR expected_digest !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Invalid recovery evidence' USING ERRCODE='23514';
 END IF;
 -- Serialize replay of a request ID even when callers name different jobs.
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text||request::text,0));
 SELECT * INTO receipt FROM public.delivery_requeues WHERE workspace_id=tenant AND request_id=request;
 IF FOUND THEN
   IF (receipt.kind,receipt.provider_event_id,receipt.payload_digest,receipt.review_ref)
      IS DISTINCT FROM (delivery_kind,event_id,expected_digest,review) THEN
     RAISE EXCEPTION 'Recovery request conflict' USING ERRCODE='23514';
   END IF;
   RETURN receipt.retry_cycle;
 END IF;
 IF delivery_kind='payment' THEN
   SELECT * INTO job FROM public.revenue_deliveries WHERE workspace_id=tenant AND provider_event_id=event_id FOR UPDATE;
 ELSE
   SELECT * INTO job FROM public.adjustment_deliveries WHERE workspace_id=tenant AND provider_event_id=event_id FOR UPDATE;
 END IF;
 IF job IS NULL OR job.payload_digest IS DISTINCT FROM expected_digest OR job.state<>'failed'
    OR job.error_class NOT IN ('database_retry','unmatched_payment') OR job.retry_cycle>=3 THEN
   RAISE EXCEPTION 'Delivery is not eligible for recovery' USING ERRCODE='23514';
 END IF;
 SELECT id INTO STRICT key_id FROM public.workspace_api_keys
 WHERE workspace_id=tenant AND key_digest=encode(sha256(convert_to(current_setting('agentmargin.api_key'),'UTF8')),'hex');
 INSERT INTO public.delivery_requeues(workspace_id,request_id,kind,provider_event_id,payload_digest,review_ref,authorizing_key_id,retry_cycle)
 VALUES(tenant,request,delivery_kind,event_id,expected_digest,review,key_id,job.retry_cycle+1);
 IF delivery_kind='payment' THEN
   UPDATE public.revenue_deliveries SET state='pending',attempts=0,retry_cycle=job.retry_cycle+1,
     error_class=NULL,delivered_at=NULL,available_at=statement_timestamp() WHERE workspace_id=tenant AND provider_event_id=event_id;
 ELSE
   UPDATE public.adjustment_deliveries SET state='pending',attempts=0,retry_cycle=job.retry_cycle+1,
     error_class=NULL,delivered_at=NULL,available_at=statement_timestamp() WHERE workspace_id=tenant AND provider_event_id=event_id;
 END IF;
 RETURN job.retry_cycle+1;
END $$;
REVOKE ALL ON FUNCTION agentmargin_auth.requeue_delivery(uuid,text,text,text,text,uuid) FROM PUBLIC;
COMMIT;
