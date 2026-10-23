# v0.7 security baseline — development

This experimental branch adds a **pre-authentication invalid-key limiter** to `/v1/*`. It applies before JSON body parsing and counts missing, malformed, and unknown workspace bearer keys. It cannot be bypassed by forging `X-Forwarded-For`; instead it is process-local and global, and intentionally does not lock out authenticated keys if invalid attempts flood the service.

**Limitations:** This is NOT adequate internet-facing abuse prevention. Multiple Node processes do not share this state. A flood of valid-looking keys still incurs database lookup before being rejected; attackers may exhaust DB connections. Direct public use also needs a trusted TLS gateway, distributed/IP+account rate limiting, request size limits at ingress, alerting and adversarial review.

## Database least-privilege evaluation

PostgreSQL app credentials currently can view multiple workspaces if compromised because RLS is not enabled. The optional [runtime role grants](DB_RUNTIME_ROLE.md) now narrow database operations to specific SELECT/INSERT privileges and are exercised with a throwaway, non-owner role in CI. An authorized DBA must provision that role separately from the owner/migrator for each deployment. The local demo still uses a privileged synthetic database account by default; this is not evidence of secure production configuration.

Do not enable RLS solely from a copied SQL snippet: RLS requires a trusted tenant session identity, transaction ownership rules, no bypass privilege, a separate migration role, and denial-by-default tests. Until verified, the API must remain localhost-only.

## v0.7–v1.0 outstanding gates

See [GitHub security gate #10](https://github.com/rzkarsyad/agentmargin/issues/10). Production controls, encrypted backups/restore drills, retention/export/delete, incident response, and independent penetration review remain **NOT DONE**.
