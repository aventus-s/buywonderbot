import { NextResponse } from "next/server";
import { kvGet, kvConfigured } from "@/lib/store";
import { ebayConfigured } from "@/lib/ebay";

export const dynamic = "force-dynamic";

export async function GET() {
  const meta = kvConfigured() ? await kvGet<any>("buywonderbot:meta") : null;
  return NextResponse.json({
    ok: true,
    service: "buywonderbot",
    kv: kvConfigured(),
    ebay: ebayConfigured(),
    cronSecret: !!process.env.CRON_SECRET,
    lastScan: meta?.scannedAt ?? null,
    lastScanMeta: meta ?? null,
  });
}
