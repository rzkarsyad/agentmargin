-- Apply AFTER 005_api_key_roles.sql. Existing API keys remain valid until revoked.
-- A NULL expiry is reserved for pre-existing / independently provisioned legacy keys.
BEGIN;
ALTER TABLE workspace_api_keys
  ADD COLUMN expires_at timestamptz;
COMMIT;
