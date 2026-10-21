-- Apply AFTER 002_ingestion.sql. Existing records remain without a digest;
-- retrying an old ID through the new API returns a conflict.
BEGIN;
ALTER TABLE revenue_records ADD COLUMN payload_digest text;
COMMIT;
