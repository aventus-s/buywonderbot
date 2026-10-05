import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TEMPORARY: large-value SET/GET test. Delete after diagnosing.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = (process.env.KV_REST_API_URL ?? "").replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN ?? "";
  const H = { Authorization: `Bearer ${token}` };
  const out: Record<string, unknown> = {};

  // build a ~171KB JSON payload like the deals array
  const big = JSON.stringify(Array.from({ length: 150 }, (_, i) => ({
    id: `auction-${i}`, title: `Test product title number ${i} with some descriptive words to add bulk`,
    retail: 500 + i, bid: 42 + i, profit: 458, margin: 0.91, tier: "HOT",
    extra: "x".repeat(800),
  })));
  out.bigLen = big.length;

  const key = "buywonderbot:bigtest";
  const setUrl = `${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(big)}/EX/120`;
  out.setUrlLen = setUrl.length;
  try {
    const r = await fetch(setUrl, { method: "POST", headers: H });
    out.setStatus = r.status;
    out.setBody = (await r.text()).slice(0, 120);
  } catch (e) {
    out.setError = (e as Error).message?.slice(0, 200);
  }
  try {
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers: H });
    const t = await r.text();
    out.getStatus = r.status;
    out.getLen = t.length;
    out.getHead = t.slice(0, 120);
  } catch (e) {
    out.getError = (e as Error).message?.slice(0, 200);
  }
  try {
    const r = await fetch(`${url}/exists/${encodeURIComponent(key)}`, { headers: H });
    out.exists = (await r.text()).slice(0, 60);
  } catch (e) {
    out.existsError = (e as Error).message?.slice(0, 100);
  }
  return NextResponse.json(out);
}
