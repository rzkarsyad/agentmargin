# Sourced ONLY after the caller's disposable CI guard. No production entry point.
prepare_restore_fixture(){
 restore_owner="agentmargin_restore_owner_$(openssl rand -hex 6)"
 restore_password=$(openssl rand -hex 24)
 psql -Xq -v ON_ERROR_STOP=1 -c "CREATE ROLE \"$restore_owner\" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$restore_password';
  ALTER ROLE \"$restore_owner\" SET log_parameter_max_length=0; ALTER ROLE \"$restore_owner\" SET log_parameter_max_length_on_error=0" >/dev/null
 export AGENTMARGIN_RESTORE_OWNER=$restore_owner AGENTMARGIN_RESTORE_OWNER_PASSWORD=$restore_password
 AGENTMARGIN_RESTORE_PRE_REVOKE_KEY="am_$(openssl rand -hex 32)"
 export AGENTMARGIN_RESTORE_PRE_REVOKE_KEY
 restore_probe_digest=$(printf '%s' "$AGENTMARGIN_RESTORE_PRE_REVOKE_KEY" | sha256sum); restore_probe_digest=${restore_probe_digest%% *}
 psql -Xq -v ON_ERROR_STOP=1 -c "INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name)
  SELECT gen_random_uuid(),id,'$restore_probe_digest','agentmargin-qa pre-backup revocation' FROM workspaces ORDER BY id LIMIT 1" >/dev/null
}
revoke_source_fixture(){
 psql -Xq -v ON_ERROR_STOP=1 -c "UPDATE workspace_api_keys SET revoked_at=statement_timestamp() WHERE key_digest='$restore_probe_digest'" >/dev/null
}
snapshot_restore_fingerprints(){
 fingerprint_file=$1
 : > "$fingerprint_file"
 for table in workspaces workspace_api_keys customers price_versions workspace_price_versions usage_events revenue_records revenue_deliveries revenue_adjustments revenue_payment_sources adjustment_deliveries delivery_history delivery_requeues; do
   psql -XAt -v ON_ERROR_STOP=1 -c "SELECT '$table:'||md5(coalesce(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text),'')) FROM public.$table t" >> "$fingerprint_file"
 done
}
compare_restore_fingerprints(){
 local restored_database=$1 actual_file=$2
 ( export PGDATABASE=$restored_database; snapshot_restore_fingerprints "$actual_file" )
 cmp "$fingerprint_file" "$actual_file"
}
