# AgentMargin frontend — Arc UI source-first

Experimental React 19 / Vite workspace for the v0.3 **Arc UI** migration. Uses the **official MIT-licensed source** for Arc Button, Input, Badge, Segmented Control and shared foundation/motion tokens. The copied code and original MIT license are checked into this repo. Source: https://github.com/kuratlielia/arc-library.

The dashboard keeps API keys in React memory only and sends them as bearer headers to the same-origin local `/v1/analytics` and `/v1/prices` routes. It does not use storage, cookies, third-party scripts or a hosted API.

The build runs in CI and produces `apps/web/dist`, which the local Hono API serves from `/dashboard`. Nothing is deployed publicly. Arc Pro assets are **not** used.

**Build locally:** `npm ci && npm run build:web`

**Run local API:** `npm run demo` (after building). Requires Docker/OrbStack and Node.js 22.18+.

See `apps/web/ARC_LICENSE.txt` for the upstream free-source MIT license.

## Dark-first design (v0.3 draft)

The complete application uses **permanent dark mode**, not just Arc components with dark props. `apps/web/index.html` selects `data-theme="dark"` and `apps/web/src/styles.css` maps Arc tokens to the AgentMargin palette: near-black canvas, graphite surfaces, muted borders, lime accents, warm warning states. System sans-serif typography is explicitly set on the root/body to prevent default serif fallback.

The restructured dashboard includes a filterable customer table, real customer-based cost coverage, financial signals, unknown-cost model diagnostics, and a fully dark pricing editor. No analytics numbers are fabricated. A truncated customer table is marked as partial. Component keyboard controls and reduced-motion handling remain enabled.

**Visual validation:** CI's live Chromium E2E asserts permanent dark theme and sans-serif typography, verifies financial totals and the pricing form, and uploads synthetic desktop/mobile screenshots as run artifacts. View them in the PR's latest GitHub Actions run.
