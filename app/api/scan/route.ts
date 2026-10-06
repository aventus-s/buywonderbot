// rebuild trigger
import { NextResponse } from "next/server";
import { fetchAllAuctions, ALL_LOCATIONS, AuctionRecord } from "@/lib/buywander";
import { findSoldListings, ebayConfigured, ebayCredsFromEnv, probeEbayCreds } from "@/lib/ebay";
import { buildQuery, matchComps } from "@/lib/match";
import { scoreDeal, rankDeals, scoreConfigFromEnv, Deal } from "@/lib/scoring";
import { scoreRetailDeal } from "@/lib/retail";
import { kvGet, kvSet, kvConfigured } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEALS_KEY = "buywonderbot:deals";
const META_KEY = "buywonderbot:meta";
const COMP_TTL_S = 6 * 3600; // re-check eBay comps every 6h per auction

function locations(): Record<string, string> {
  try {
    const raw = process.env.LOCATIONS;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch { /* fall through to default */ }
  return { Minneapolis: ALL_LOCATIONS.Minneapolis };
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Run `fn` over items with limited concurrency. */
async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Retail-discount test scoring: rank by discount vs Buywander retail.
 *  Used when no eBay key exists AND when eBay auth fails — a broken keyset
 *  must never empty the dashboard. `ebayError` (when present) is shown in
 *  the dashboard's test-mode banner. */
async function runRetailTest(
  auctions: AuctionRecord[],
  locs: Record<string, string>,
  t0: number,
  ebayError?: string,
) {
  const now = Date.now();
  const deals = auctions
    .map((rec) => scoreRetailDeal(rec, now))
    .filter((d): d is Deal => !!d)
    .sort((a, b) => b.profit - a.profit) // biggest dollar savings first
    .slice(0, 150);
  await kvSet(DEALS_KEY, deals, 3600);
  const meta = {
    mode: "retail-test",
    ...(ebayError ? { ebayError } : {}),
    scannedAt: new Date().toISOString(),
    locations: Object.keys(locs),
    auctionsScanned: auctions.length,
    ebayCalls: 0,
    hot: deals.filter((d) => d.tier === "HOT").length,
    watch: deals.filter((d) => d.tier === "WATCH").length,
    elapsedMs: Date.now() - t0,
  };
  await kvSet(META_KEY, meta, 3600);
  return NextResponse.json({ ok: true, ...meta });
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    const msg = process.env.CRON_SECRET
      ? "Unauthorized"
      : "CRON_SECRET is not set — add it in Vercel env vars";
    return NextResponse.json({ ok: false, error: msg },
      { status: process.env.CRON_SECRET ? 401 : 500 });
  }
  if (!kvConfigured()) {
    return NextResponse.json({ ok: false, error: "KV not configured (KV_REST_API_URL / KV_REST_API_TOKEN)" }, { status: 500 });
  }

  const t0 = Date.now();
  const locs = locations();
  const auctions = await fetchAllAuctions(Object.values(locs));

  // ---- TEST MODE (no eBay key, or eBay auth broken): retail discount ----
  // Env vars set does NOT mean the creds work: a bad Cert ID (HTTP 401) or
  // eBay's limited-release gate (HTTP 403) would make every margin lookup
  // fail and empty the dashboard. Pre-flight one OAuth token and fall back
  // to test scoring so the dashboard keeps showing deals.
  if (!ebayConfigured()) {
    return await runRetailTest(auctions, locs, t0);
  }
  const ebayProbe = await probeEbayCreds(ebayCredsFromEnv()!);
  if (!ebayProbe.ok) {
    const err =
      ebayProbe.status === 401
        ? "eBay rejected the keyset (HTTP 401) — the Cert ID (Client Secret) doesn't match the App ID (Client ID). Regenerate the Cert ID at developer.ebay.com and set it in Vercel."
        : ebayProbe.status === 403
          ? "eBay denied access (HTTP 403) — the Marketplace Insights API needs approval. Request access for this app in the eBay developer dashboard."
          : `eBay OAuth failed (HTTP ${ebayProbe.status ?? "n/a"}): ${ebayProbe.message}`;
    return await runRetailTest(auctions, locs, t0, err);
  }

  // ---- MARGIN MODE (eBay sold comps) ----
  const cfg = scoreConfigFromEnv();
  const matchMin = Number(process.env.MATCH_CONFIDENCE_MIN ?? 40);
  const maxLookups = Number(process.env.MAX_EBAY_LOOKUPS_PER_SCAN ?? 120);
  const creds = ebayCredsFromEnv()!;

  // Prefilter: profit>=100 & margin>=50% needs comp>=200; retail<150 almost never qualifies.
  const candidates = auctions
    .filter((a) => a.retail >= 150)
    .sort((a, b) => b.retail - b.bid - (a.retail - a.bid))
    .slice(0, maxLookups);

  let ebayCalls = 0;
  let cacheHits = 0;
  const deals: Deal[] = [];

  await pool(candidates, 5, async (rec) => {
    try {
      const cacheKey = `buywonderbot:comp:${rec.auctionId}`;
      let cached = await kvGet<any>(cacheKey);
      if (!cached) {
        const query = buildQuery(rec);
        const solds = await findSoldListings(creds, query, 50);
        ebayCalls++;
        const match = matchComps(rec, solds, matchMin);
        cached = { match, at: Date.now() };
        await kvSet(cacheKey, cached, COMP_TTL_S);
      } else {
        cacheHits++;
      }
      const deal = scoreDeal(rec, cached.match, cfg);
      if (deal) deals.push(deal);
    } catch (e) {
      console.error(`scan: ${rec.auctionId} failed:`, (e as Error).message);
    }
  });

  // If every eBay lookup failed (e.g. scope not granted), don't leave the
  // dashboard empty — fall back to retail test scoring.
  if (ebayCalls === 0 && candidates.length > 0) {
    return await runRetailTest(
      auctions,
      locs,
      t0,
      "eBay sold-price lookups failed (the app's keyset lacks the Marketplace Insights scope). Showing retail-discount test mode instead.",
    );
  }

  const ranked = rankDeals(deals).slice(0, 200);
  await kvSet(DEALS_KEY, ranked, 3600);
  const meta = {
    mode: "margin",
    scannedAt: new Date().toISOString(),
    locations: Object.keys(locs),
    auctionsScanned: auctions.length,
    candidatesChecked: candidates.length,
    ebayCalls,
    cacheHits,
    hot: ranked.filter((d) => d.tier === "HOT").length,
    watch: ranked.filter((d) => d.tier === "WATCH").length,
    elapsedMs: Date.now() - t0,
  };
  await kvSet(META_KEY, meta, 3600);

  return NextResponse.json({ ok: true, ...meta });
}
