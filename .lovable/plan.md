# Lovable Cloud Cost Simulator

Add a public `/costs` page that explains how Lovable Cloud pricing applies to opentape and lets users simulate monthly cost based on adjustable parameters. All pricing constants hardcoded from Lovable Cloud docs (easy to update later).

## Pricing model (hardcoded constants)

Lovable Cloud bills usage on top of subscription. Free monthly allowance: **$25 Cloud + $1 AI**. Main billable dimensions for opentape:

- **Compute / instance size** — fixed monthly fee per Postgres instance tier (Micro ~$10, Small ~$25, Medium ~$60, etc.)
- **Database storage** — $/GB-month
- **Egress (data transfer out)** — $/GB
- **Edge function invocations** — $/million
- **Database read units** — $/million row reads (approx.)

Constants will live in `src/lib/cloudPricing.ts` with a comment linking to Lovable Cloud pricing docs and a "last updated" date.

## Page: `/costs` (public)

Layout: single column, hero + 3 sections.

1. **How Lovable Cloud pricing works** — short explainer (4-6 bullets) covering the $25 free allowance, what counts as Cloud usage, and which opentape activities drive each cost.
2. **Cost simulator** (interactive)
3. **Result breakdown + verdict** ("Yes, fits in $20/mo if…" / "Will exceed $20/mo because…")

### Inputs (sliders + number fields)

| Input | Default | Range | Drives |
|---|---|---|---|
| Number of enabled venues | 6 | 1–10 | invocations, trades |
| Fetch interval (minutes) | 5 | 1–60 | edge function invocations |
| Market hours per day | 9 | 1–24 | invocations |
| Trading days per month | 21 | 1–31 | invocations, trades |
| Avg trades ingested per day | 500,000 | 1k–10M | DB writes, storage |
| Data retention (days) | 7 | 1–90 | DB storage |
| External API requests per day | 1,000 | 0–1M | invocations, egress |
| Avg API response size (KB) | 5 | 1–500 | egress |
| Instance tier | Micro | Micro/Small/Medium | fixed compute |

### Computed outputs

- Edge function invocations / month = `venues × (60/interval) × hours × days + apiRequests × 30`
- DB storage GB = `trades/day × retention × bytes_per_trade / 1e9` (assume ~250 B/trade incl. indexes; documented inline)
- Egress GB = `apiRequests × 30 × respSize / 1e6`
- Per-line cost = usage × unit price, minus $25 free allowance applied to total Cloud spend
- Final monthly cost in USD with breakdown table

### Result UI

- Big total `$XX.XX / month`
- Breakdown table (line item, usage, unit price, cost)
- Color-coded badge: green ≤ $20, amber ≤ $50, red > $50
- Note explaining that subscription credits (build messages) are separate

## Placement & navigation

- New route `/costs` registered in `src/App.tsx`
- Public, no auth required (matches `/api-docs`, `/faq` pattern)
- Add link in `PublicHeader` and footer / FAQ cross-link

## Files to add / edit

- **add** `src/pages/Costs.tsx` — page component
- **add** `src/lib/cloudPricing.ts` — pricing constants + calc helpers (pure functions, easy to unit-test mentally)
- **edit** `src/App.tsx` — register `/costs` route
- **edit** `src/components/PublicHeader.tsx` — nav link "Costs"
- **edit** `src/pages/FAQ.tsx` — link to /costs from a "How much does it cost to run?" entry

## Out of scope

- No Lovable subscription/credit math (Cloud only, per your answer)
- No persistence of simulator state (pure client-side)
- No live usage pulled from the database (could be a follow-up: "Use my actual last-7-day usage")

## Answer to the $20/month question (preview, will be in the page copy)

With current defaults (6 venues, 5-min interval, 7-day retention, light external API traffic, Micro instance), opentape should land in the **$10–25/month** Cloud usage range — well within $20 if you stay on Micro and the $25 free allowance covers the bulk. The biggest knobs are **fetch interval** (1-min × 6 venues × 9h × 21d ≈ 68k invocations/mo just for ingestion) and **instance tier**. Going to 1-minute intervals or upgrading to Small instance pushes you past $20.
