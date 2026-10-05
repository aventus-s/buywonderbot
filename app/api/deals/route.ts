import { NextResponse } from "next/server";
import { kvGet, kvConfigured } from "@/lib/store";
import { ebayConfigured } from "@/lib/ebay";
import { Deal, hoursLeft } from "@/lib/scoring";

export const dynamic = "force-dynamic";

const CLOSING_SOON_MIN = 10;

export async function GET() {
  const setup = {
    kv: kvConfigured(),
    ebay: ebayConfigured(),
    cronSecret: !!process.env.CRON_SECRET,
  };
  if (!setup.kv) {
    return NextResponse.json({ ok: false, setup, deals: [], closingSoon: [], meta: null });
  }
  const deals = (await kvGet<Deal[]>("buywonderbot:deals")) ?? [];
  const meta = await kvGet<any>("buywonderbot:meta");
  const now = Date.now();
  const live = deals.filter((d) => {
    const h = hoursLeft(d.end, now);
    return h != null && h > 0;
  });
  const closingSoon = live.filter((d) => {
    const h = hoursLeft(d.end, now)!;
    return h * 60 <= CLOSING_SOON_MIN;
  });
  return NextResponse.json({
    ok: true,
    setup,
    meta,
    deals: live,
    closingSoon,
    counts: {
      hot: live.filter((d) => d.tier === "HOT").length,
      watch: live.filter((d) => d.tier === "WATCH").length,
      closingSoon: closingSoon.length,
    },
  });
}
