# 🤖 buywonderbot

Live deal radar for [buywander.com](https://buywander.com) auctions. Every scan:

1. Pulls all active auctions from Buywander's API.
2. Looks up **what the item actually sold for on eBay** (sold listings, not asking prices).
3. **Verifies the product matches** (model-number / brand / token scoring) and shows the proof.
4. Flags **HOT** deals: **≥50% profit margin** vs eBay sold price **and ≥$100 profit**.
5. The dashboard screams about anything **closing in under 10 minutes**.

It never bids for you — every card links straight to the Buywander listing.

## What you need (all free)

| Thing | Where | Why |
|---|---|---|
| eBay Client ID + Client Secret | [developer.ebay.com](https://developer.ebay.com) → sign in → create an app keyset → copy **App ID (Client ID)** and **Cert ID (Client Secret)** | Sold-price lookups via the Marketplace Insights API (`EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`). No user OAuth needed — the app mints its own token. |
| Vercel account | [vercel.com](https://vercel.com) | Hosting |
| Upstash Redis | Vercel Dashboard → Storage → Create Database → KV (or [upstash.com](https://upstash.com) free tier) | Stores deals between scans |
| `CRON_SECRET` | any long random string | Keeps strangers from triggering scans |

**Do you need an API or CLI to scrape?** API — no scraping needed, and scraping would get blocked:
- **eBay**: official Marketplace Insights API, free, OAuth client-credentials (your app mints its own token — no user login flow). This is the source of truth for "what it sold for." Note: eBay's old App-ID-only Finding API was shut down on 2025-02-05, so the Client ID + Client Secret pair is required. eBay also lists Marketplace Insights as limited-release — if a scan reports "access denied", request access for it in your developer.ebay.com dashboard and re-run.
- **Buywander**: their own (undocumented) search API, already integrated here.
- **Amazon**: no usable free API and aggressive bot protection — skipped in v1. eBay solds are the better signal anyway.
- **Google Shopping**: no free API (paid SERP APIs only) — optional v2.

## Deploy

```bash
cd buywonderbot
npm install
vercel              # link to your Vercel account, or import the folder in vercel.com
```

Then in Vercel → Project → Settings → Environment Variables, add:
`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `CRON_SECRET`, and optionally
`LOCATIONS` (JSON map of name → id; all 8 warehouses are listed in `lib/buywander.ts`).

Redeploy, then trigger the first scan:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP.vercel.app/api/scan
```

## Scheduling (every 10 min, free)

Vercel's free tier only allows **once-per-day** crons, so scheduling lives in GitHub
Actions (`.github/workflows/scan.yml`, included):

1. Push this folder to a GitHub repo.
2. Repo → Settings → Secrets → Actions → add `APP_URL` and `CRON_SECRET`.
3. Done — scans run every 10 minutes. "Run workflow" triggers one manually.

Heads-up: GitHub pauses scheduled workflows after 60 days with no repo activity —
push any commit (or re-enable the workflow) to resume if scans ever go quiet.

## 10-minute alerts

- **On the dashboard**: anything ending within 10 minutes gets a flashing red section
  with live countdowns. Click "enable alerts" for browser push notifications.
- **In chat**: ask Muse to watch the dashboard and ping you — it can poll
  `/api/deals` and message you the moment a HOT deal enters its final 10 minutes.

## Tuning

Env vars: `MIN_PROFIT_USD` (default 100), `MIN_MARGIN` (default 0.5),
`MATCH_CONFIDENCE_MIN` (default 40 — raise to be stricter about product matches),
`MAX_EBAY_LOOKUPS_PER_SCAN` (default 120). eBay comps are cached 6h per auction.

## How product verification works

Buywander titles are messy, so matching is confidence-scored, never blind:
model-number match (+50) ≫ brand match (+20) + token overlap. Comp price = median
of the 5 best-matching sold listings. Low-confidence matches are **excluded** from
deals, and every deal card has a "verify product" expander showing the exact eBay
sold listings (title, price, date, link) behind its comp price — one glance to confirm.
