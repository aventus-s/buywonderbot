import { NextResponse } from "next/server";
import { kvSet, kvGet } from "@/lib/store";

export const dynamic = "force-dynamic";

// TEMPORARY: roundtrip through the real kvSet/kvGet. Delete after diagnosing.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const out: Record<string, unknown> = {};
  const key = "buywonderbot:meta";
  const val = { mode: "rttest", scannedAt: new Date().toISOString(), probe: true };
  try {
    await kvSet(key, val, 120);
    out.set = "ok";
  } catch (e) {
    out.setError = (e as Error).message;
  }
  try {
    out.got = await kvGet(key);
  } catch (e) {
    out.getError = (e as Error).message;
  }
  return NextResponse.json(out);
}
