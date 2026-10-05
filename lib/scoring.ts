// Deal scoring: HOT = margin >= 50% AND profit >= $100 AND verified product.

import { AuctionRecord, dealUrl } from "./buywander";
import { MatchResult } from "./match";

export interface Deal extends AuctionRecord {
  compPrice: number;
  profit: number;          // compPrice - bid
  margin: number;          // profit / compPrice  (0..1)
  tier: "HOT" | "WATCH";
  confidence: MatchResult["confidence"];
  ebayQuery: string;
  evidence: MatchResult["evidence"];
  hoursLeft: number | null;
  dealUrl: string;
  scoredAt: string;
  mode: "margin" | "retail";
}

export interface ScoreConfig {
  minProfit: number;
  minMargin: number;
  hotMinMargin: number;
  watchMinMargin: number;
}

export function scoreConfigFromEnv(): ScoreConfig {
  const minProfit = Number(process.env.MIN_PROFIT_USD ?? 100);
  const minMargin = Number(process.env.MIN_MARGIN ?? 0.5);
  return { minProfit, minMargin, hotMinMargin: minMargin, watchMinMargin: 0.35 };
}

export function hoursLeft(endIso: string | null, now = Date.now()): number | null {
  if (!endIso) return null;
  const t = new Date(endIso).getTime();
  if (!Number.isFinite(t)) return null;
  return (t - now) / 3_600_000;
}

/** Returns a Deal, or null when it doesn't clear the bar. */
export function scoreDeal(
  rec: AuctionRecord,
  match: MatchResult,
  cfg: ScoreConfig,
  now = Date.now(),
): Deal | null {
  if (match.compPrice == null || match.compPrice <= 0) return null;
  if (match.confidence === "low") return null; // unverified product: never a deal
  const hrs = hoursLeft(rec.end, now);
  if (hrs != null && hrs <= 0) return null;    // auction over

  const profit = match.compPrice - rec.bid;
  const margin = profit / match.compPrice;
  if (profit < cfg.minProfit) return null;

  let tier: Deal["tier"] | null = null;
  if (margin >= cfg.hotMinMargin) tier = "HOT";
  else if (margin >= cfg.watchMinMargin) tier = "WATCH";
  if (!tier) return null;

  return {
    ...rec,
    compPrice: Math.round(match.compPrice * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    margin: Math.round(margin * 10000) / 10000,
    tier,
    confidence: match.confidence,
    ebayQuery: match.query,
    evidence: match.evidence,
    hoursLeft: hrs == null ? null : Math.round(hrs * 100) / 100,
    dealUrl: dealUrl(rec),
    scoredAt: new Date(now).toISOString(),
    mode: "margin",
  };
}

export function rankDeals(deals: Deal[]): Deal[] {
  const tierRank = (d: Deal) => (d.tier === "HOT" ? 0 : 1);
  return [...deals].sort((a, b) => tierRank(a) - tierRank(b) || b.profit - a.profit);
}
