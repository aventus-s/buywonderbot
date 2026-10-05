// Retail-discount scoring — TEST MODE only (no eBay key needed).
// Lets you verify the full pipeline (Buywander -> Vercel -> KV -> dashboard)
// before the eBay App ID arrives. Margin scoring takes over once it's set.

import { AuctionRecord, dealUrl } from "./buywander";
import { Deal, hoursLeft } from "./scoring";

export function scoreRetailDeal(rec: AuctionRecord, now = Date.now()): Deal | null {
  if (rec.retail < 25) return null;
  const hrs = hoursLeft(rec.end, now);
  if (hrs != null && hrs <= 0) return null; // auction over
  const discount = rec.retail > 0 ? Math.max(0, (rec.retail - rec.bid) / rec.retail) : 0;
  const profit = rec.retail - rec.bid;
  let tier: Deal["tier"] | null = null;
  if (discount >= 0.9 && rec.retail >= 50) tier = "HOT";
  else if (discount >= 0.75 && rec.retail >= 30) tier = "WATCH";
  if (!tier) return null;
  return {
    ...rec,
    compPrice: rec.retail,
    profit: Math.round(profit * 100) / 100,
    margin: Math.round(discount * 10000) / 10000,
    tier,
    confidence: "medium",
    ebayQuery: "",
    evidence: [],
    hoursLeft: hrs == null ? null : Math.round(hrs * 100) / 100,
    dealUrl: dealUrl(rec),
    scoredAt: new Date(now).toISOString(),
    mode: "retail",
  };
}
