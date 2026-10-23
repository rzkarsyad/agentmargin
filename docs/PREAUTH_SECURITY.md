# v0.7 security baseline — development

This experimental branch adds a **pre-authentication invalid-key limiter** to `/v1/*`. It applies before JSON body parsing and counts missing, malformed, and unknown workspace bearer keys. It cannot be bypassed by forging `X-Forwarded-For`; instead it is process-local and global, and intentionally does not lock out authenticated keys if invalid attempts flood the service.

**Limitations:** This is NOT adequate internet-facing abuse prevention. Multiple Node processes do not share this state. A flood of valid-looking keys still incurs database lookup before being rejected; attackers may exhaust DB connections. Direct public use also needs a trusted TLS gateway, distributed/IP+account rate limiting, request size limits at ingress, alerting and adversarial review.

## Database least-privilege evaluation

PostgreSQL app credentials currently can view multiple workspaces if compromised because RLS is not enabled. The optional [runtime role grants](DB_RUNTIME_ROLE.md) now narrow database operations to specific SELECT/INSERT privileges and are exercised with a throwaway, non-owner role in CI. An authorized DBA must provision that role separately from the owner/migrator for each deployment. The local demo still uses a privileged synthetic database account by default; this is not evidence of secure production configuration.

Do not enable RLS solely from a copied SQL snippet: RLS requires a trusted tenant session identity, transaction ownership rules, no bypass privilege, a separate migration role, and denial-by-default tests. Until verified, the API must remain localhost-only.

## v0.7–v1.0 outstanding gates

See [GitHub security gate #10](https://github.com/rzkarsyad/agentmargin/issues/10). Production controls, encrypted backups/restore drills, retention/export/delete, incident response, and independent penetration review remain **NOT DONE**.

## CodeQL alert audit (2026-10-23 candidate)

This is a preliminary implementer audit, not independent security approval. The candidate targets `main` separately from unmerged PRs #24–#32. It does not change SDK APIs, API key format/digest bytes, grants, or migrations. It must remain unmerged pending review and explicit authorization.

| Reported finding on main | Reachability and decision | Candidate resolution |
| --- | --- | --- |
| [#3](https://github.com/rzkarsyad/agentmargin/security/code-scanning/3) `js/insufficient-password-hash`, API `digest` helper | SHA-256 is inappropriate for human-selected passwords, but this credential is `am_` plus **32 bytes from `crypto.randomBytes`** (256 random bits). The prefix adds no entropy. Key creation/demo/rotation generate the secret; HTTP callers must prove possession of a provisioned digest. Guessing arbitrary strings does not create an account or choose its stored key. No password-registration/reset feature exists. This is a false positive for this bearer-token use, subject to verification of the actual reported source path. | Preserve SHA-256 over exact UTF-8 bytes, lowercase hex, without a salt/KDF change. Document the entropy/usage boundary and add a fixed-vector test plus PostgreSQL SHA-256 agreement. Do **not** suppress/exclude the query or claim that a slow password KDF fixes this API. |
| [#2](https://github.com/rzkarsyad/agentmargin/security/code-scanning/2) `js/incomplete-multi-character-sanitization`, Arc button regex | The serialized child key was stripped with a tag-looking regex only to select icon/text animation. It never became `innerHTML` or executable markup. React renders the original children and escapes text. No XSS path is demonstrated, but literal `<svg>` text was misclassified as an icon and string/element keys could collide. | Inspect declared React children structurally, ignoring SVG/aria-hidden icon internals, retaining fragments/numbers/text, and never invoking components. Use structured label keys. Test nested/malformed tag-looking labels and escaped rendering. |
| [#1](https://github.com/rzkarsyad/agentmargin/security/code-scanning/1) `js/bad-tag-filter`, API fallback script regex | Input is a repository-owned local HTML file, selected by a fixed URL; request/customer/provider text does not reach it. The expression extracted trusted script bytes for a CSP hash; it was not a sanitizer for external HTML. No remote exploit path is demonstrated. Local source/host compromise is outside this control. | Split the trusted fallback script into `dashboard.js`, assemble it into one explicit template marker and hash exactly the inserted bytes. Missing/duplicate markers fail closed. Remove HTML parsing by regex, retain hash-only script CSP, and exercise actual fallback behavior under that CSP in Chromium. |

### Authentication and database compatibility

The existing `digest` export stays compatible for provisioning, authentication and payload idempotency. Migrations 007/009 independently compute `encode(sha256(convert_to(credential,'UTF8')),'hex')`; 010/011 depend on that authenticated workspace context. Replacing it with bcrypt/Argon2/PBKDF2 or adding a salt without a complete migration would break existing keys, SQL credential-backed RLS and revocation semantics. This patch performs no such migration. Human passwords must use a separately designed password-authentication system; this helper must not be repurposed for them. Randomness quality and secure key transport/storage remain required.

The additional CI job applies this patch to an **isolated worktree pinned to #32 at `e80792d328b24d816edba76bc6cf52f40eef1180`**, then builds SDK/apps, typechecks and runs all tests plus real PostgreSQL 16 migrations 001–011/security/revocation/pooling/financial regressions. It never rewrites the stacked branches. The existing main CI runs its own clean PostgreSQL/browser/backup/rotation checks. After any future stack changes, refresh/review the fixture and rerun compatibility. Merging/cherry-picking must still be separately approved; #24 → … → #32 retains its dependency order.

### Analysis evidence and remaining access limitation

At audit start, `main` was `bea396246af6495081f6bc596501c6af28750ff5`; its default [CodeQL setup run](https://github.com/rzkarsyad/agentmargin/actions/runs/39949959530) completed successfully (JavaScript query pack 2.4.8). The GitHub connector rejects the code-scanning endpoints, and the available CLI request returned `Forbidden`. Stored alert IDs/dispositions/data-flow details therefore cannot yet be independently read or changed through this connection. This limitation is not a claim that the alerts are closed.

The audit workflow runs the full JavaScript/TypeScript `security-extended` suite against base and patch, retaining full SARIF (including any false positives), query metadata, source locations and path steps as artifacts. It does not filter queries, add `lgtm`/CodeQL suppressions, dismiss alerts, or replace default setup. `upload: false` avoids conflicting with the repository's enabled default setup; the normal default CodeQL scan remains authoritative for GitHub alert state. Review raw SARIF rather than equating workflow success with zero findings.

Main alerts cannot become fixed on an unmerged branch. After approved integration, rerun default CodeQL on main; verify the two removed regex sites, and separately triage any remaining token/password classification with the entropy/path evidence. Authenticated security-alert access is required to confirm all open alerts and record an evidence-based false-positive disposition. Existing independent RLS/cursor/ingest authority, operational and financial review gates remain open.
