# AgentMargin frontend — Arc UI source-first

Experimental React 19 / Vite workspace for the v0.3 **Arc UI** migration. Uses the **official MIT-licensed source** for Arc Button, Input and shared foundation/motion tokens. The copied code and original MIT license are checked into this repo. Source: https://github.com/kuratlielia/arc-library.

The dashboard keeps API keys in React memory only and sends them as bearer headers to the same-origin local `/v1/analytics` and `/v1/prices` routes. It does not use storage, cookies, third-party scripts or a hosted API.

The build runs in CI and produces `apps/web/dist`, which the local Hono API serves from `/dashboard`. Nothing is deployed publicly. Arc Pro assets are **not** used.

**Build locally:** `npm ci && npm run build:web`

**Run local API:** `npm run demo` (after building). Requires Docker/OrbStack and Node.js 22.18+.

See `apps/web/ARC_LICENSE.txt` for the upstream free-source MIT license.
