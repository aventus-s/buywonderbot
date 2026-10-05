import { NextResponse } from "next/server";
import { kvSet, kvGet } from "@/lib/store";

export const dynamic = "force-dynamic";

// TEMPORARY: DEL-then-SET test on the stubborn keys. Delete after diagnosing.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = (process.env.KV_REST_API_URL ?? "").replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN ?? "";
  const H = { Authorization: `Bearer ${token}` };
  const out: Record<string, unknown> = {};

  for (const k of ["buywonderbot:meta", "buywonderbot:deals"]) {
    try {
      const del = await fetch(`${url}/del/${encodeURIComponent(k)}`, { headers: H });
      out[`del_${k.split(":")[1]}`] = `${del.status} ${(await del.text()).slice(0, 60)}`;
    } catch (e) {
      out[`del_${k.split(":")[1]}_err`] = (e as Error).message?.slice(0, 100);
    }
  }
  // now set fresh via the real kvSet
  try {
    await kvSet("buywonderbot:meta", { mode: "deltest", at: new Date().toISOString() }, 86400);
    out.set_meta = "ok";
    out.got_meta = await kvGet("buywonderbot:meta");
  } catch (e) {
    out.set_meta_err = (e as Error).message?.slice(0, 200);
  }
  return NextResponse.json(out);
}
