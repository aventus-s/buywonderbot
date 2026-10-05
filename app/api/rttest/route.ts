import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TEMPORARY: raw KV inspection. Delete after diagnosing.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = (process.env.KV_REST_API_URL ?? "").replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN ?? "";
  const H = { Authorization: `Bearer ${token}` };
  const out: Record<string, unknown> = {};

  async function rawGet(k: string) {
    const r = await fetch(`${url}/get/${encodeURIComponent(k)}`, { headers: H });
    const t = await r.text();
    return { status: r.status, len: t.length, head: t.slice(0, 300) };
  }

  out.meta = await rawGet("buywonderbot:meta");
  out.deals = await rawGet("buywonderbot:deals");
  out.rt = await rawGet("buywonderbot:rt");

  // check key existence/type via EXISTS
  for (const k of ["buywonderbot:meta", "buywonderbot:deals"]) {
    const r = await fetch(`${url}/exists/${encodeURIComponent(k)}`, { headers: H });
    out[`exists_${k.split(":")[1]}`] = (await r.text()).slice(0, 100);
  }
  // TTLs
  for (const k of ["buywonderbot:meta", "buywonderbot:deals"]) {
    const r = await fetch(`${url}/ttl/${encodeURIComponent(k)}`, { headers: H });
    out[`ttl_${k.split(":")[1]}`] = (await r.text()).slice(0, 100);
  }
  return NextResponse.json(out);
}
