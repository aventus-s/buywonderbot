// Product verification: match a Buywander listing to the correct eBay sold
// listings, so the "market price" comp is for the RIGHT product.
//
// Strategy:
//  1. Extract strong identifiers (model numbers like S6366M, dimensions).
//  2. Query eBay with brand + model (or distinctive keywords as fallback).
//  3. Score each sold listing: model match >> brand match > token overlap.
//  4. Comp price = median of the best-scoring sold listings.
//  5. Confidence high/medium/low — only high/medium can become HOT deals,
//     and every deal shows its matched listings so a human can verify.

import { SoldComp } from "./ebay";
import { AuctionRecord } from "./buywander";

export interface MatchResult {
  compPrice: number | null;      // median sold price of matched listings
  confidence: "high" | "medium" | "low";
  query: string;                 // eBay query used
  evidence: (SoldComp & { matchScore: number })[];
}

const STOPWORDS = new Set(
  "for with and the new inch in of a an to by w set pack piece pc pcs piece -".split(" "),
);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Uppercase alphanumeric tokens containing both letters and digits, e.g. S6366M. */
function modelTokens(title: string): string[] {
  const found = new Set<string>();
  for (const m of title.toUpperCase().matchAll(/\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*[0-9])[A-Z0-9-]{4,}\b/g)) {
    const t = m[0].replace(/-/g, "");
    if (!/^\d+$/.test(t) && t.length >= 4 && t.length <= 16) found.add(t);
  }
  return [...found];
}

function guessBrand(title: string): string | null {
  const first = title.trim().split(/\s+/)[0] ?? "";
  if (/^[A-Za-z][A-Za-z0-9&'.-]{2,}$/.test(first) && !/^\d/.test(first)) {
    const low = first.toLowerCase();
    if (!STOPWORDS.has(low)) return first.replace(/[.'-]$/, "");
  }
  return null;
}

/** Build the eBay search query: brand + model when we have one, else keywords. */
export function buildQuery(rec: AuctionRecord): string {
  const models = modelTokens(rec.title);
  const brand = guessBrand(rec.title);
  if (models.length > 0) {
    return [brand, models[0]].filter(Boolean).join(" ");
  }
  const toks = tokens(rec.title);
  // prefer longer / digit-containing tokens (more distinctive)
  toks.sort((a, b) => {
    const score = (t: string) => (/\d/.test(t) ? 10 : 0) + Math.min(t.length, 12);
    return score(b) - score(a);
  });
  return toks.slice(0, 6).join(" ");
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / Math.max(1, sa.size + sb.size - inter);
}

function scoreListing(rec: AuctionRecord, sold: SoldComp): number {
  const recModels = new Set(modelTokens(rec.title));
  const soldModels = new Set(modelTokens(sold.title));
  let score = 0;
  let modelHit = false;
  for (const m of recModels) {
    if (soldModels.has(m) || sold.title.toUpperCase().includes(m)) {
      score += 50;
      modelHit = true;
      break;
    }
  }
  const brand = guessBrand(rec.title);
  if (brand && sold.title.toLowerCase().includes(brand.toLowerCase())) score += 20;
  score += Math.round(jaccard(tokens(rec.title), tokens(sold.title)) * 30);
  if (!modelHit && recModels.size > 0) score -= 15; // model known but not matched: suspicious
  return score;
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function matchComps(
  rec: AuctionRecord,
  solds: SoldComp[],
  minScore: number,
): MatchResult {
  const query = buildQuery(rec);
  const scored = solds
    .map((s) => ({ ...s, matchScore: scoreListing(rec, s) }))
    .filter((s) => s.matchScore >= minScore)
    .sort((a, b) => b.matchScore - a.matchScore);
  const top = scored.slice(0, 5);
  const compPrice = median(top.map((s) => s.price));
  const best = top[0]?.matchScore ?? 0;
  const confidence: MatchResult["confidence"] =
    best >= 70 ? "high" : best >= minScore ? "medium" : "low";
  return { compPrice, confidence, query, evidence: top };
}
