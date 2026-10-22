# AgentMargin frontend — Arc UI source-first

Experimental React 19 / Vite workspace for the v0.3 **Arc UI** migration. Uses the **official MIT-licensed source** for Arc Button, Input, Badge, Segmented Control and shared foundation/motion tokens. The copied code and original MIT license are checked into this repo. Source: https://github.com/kuratlielia/arc-library.

The dashboard keeps API keys in React memory only and sends them as bearer headers to the same-origin local `/v1/analytics` and `/v1/prices` routes. It does not use storage, cookies, third-party scripts or a hosted API.

The build runs in CI and produces `apps/web/dist`, which the local Hono API serves from `/dashboard`. Nothing is deployed publicly. Arc Pro assets are **not** used.

**Build locally:** `npm ci && npm run build:web`

**Run local API:** `npm run demo` (after building). Requires Docker/OrbStack and Node.js 22.18+.

See `apps/web/ARC_LICENSE.txt` for the upstream free-source MIT license.

## Reference-led product interface (v0.3 draft)

The v0.3 dashboard is an intentionally **neutral charcoal/graphite SaaS workspace**, not a marketing landing page. It uses the genuine free, MIT-licensed Arc UI Button, Input, Badge and Segmented Control sources while retaining the financial/API contract.

The app avoids decorative hero graphics, neon accent blocks, made-up growth metrics, and invented time-series charts. Instead it shows compact KPI cards, a real **per-customer revenue versus known AI cost** bar comparison, a customer-based cost-coverage summary, filtering/search and an auditable pricing table. Colors are used sparingly for contribution, negative performance, and unknown-data warnings.

Dark mode is permanent (`data-theme="dark"`) and the page uses native system sans-serif typography. Live Chromium CI asserts a compact header, charcoal background, accessible API flow and the absence of promotional hero artwork.

The layout direction was rewritten after explicit maintainer rejection of the earlier lime-and-marketing presentation. Visual sign-off is still required before merge.
