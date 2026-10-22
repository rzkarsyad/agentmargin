# AgentMargin v0.3 — visual acceptance rules

The dark interface is a utilitarian developer analytics workspace, **not** a startup marketing page.

## Visual direction

Inspired by the maintainer's attached references (Lunor, Taskplus, Kravio, dark CRM/productivity dashboards), without copying their identities or product-specific assets.

- Permanent neutral graphite / near-black appearance, moderate surface contrast, subtle gray borders, compact components.
- Sans-serif typography; page headings are compact and informational. No hero slogans, giant display type, decorative orbital graphics, gradients, neon-lime backgrounds, floating flourishes, or imaginary growth charts.
- Narrow dark sidebar with real navigation only; subtle filled active state. Small outlined icons with consistent stroke.
- Data-first composition: page title, access/period filters, four KPIs, customer-derived comparison and coverage panels, searchable table, unknown-cost diagnostics.
- Pricing view: exact model-rate entry and immutable history, with dates and source notes; do not show fictional prices as real provider rates.
- Responsive: desktop cards/tables; mobile stacked panels with horizontally scrollable tabular data, **no document-level horizontal overflow**.
- Functional source-first Arc UI Button, Input, Badge, Segmented Control. Upstream free/MIT attribution retained in apps/web.
- No invented financial metrics: charts use the loaded customer aggregates. A missing inference cost must be labeled **Unverified**, not visually misrepresented as $0; a partial known portion is also labeled.
- No fake actions, upgrades, users, billing or trendlines. Empty states and actual server errors must remain visible.

## Acceptance gate

1. Review GitHub Actions screenshot artifacts at 1280px Overview, 390px Overview, Pricing desktop and Pricing mobile.
2. CI must pass Docker/PostgreSQL-backed analytics and pricing forms in Chromium, TypeScript/build, tenant/price immutability tests and dependency scan.
3. Browser assertions cover dark theme, non-serif typography, compact heading, financial data correctness, no unknown-is-zero presentation, search/filter behavior and mobile overflow.
4. Maintainer performs an independent local OrbStack visual review and approves before merging PR #3.

The maintainers' screenshots and specific UI feedback take precedence over automated visual heuristics. **Passing CI does not equal visual approval.**
