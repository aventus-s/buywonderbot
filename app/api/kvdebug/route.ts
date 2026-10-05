import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TEMPORARY debug: raw Upstash REST roundtrip. Delete after diagnosing.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = (process.env.KV_REST_API_URL ?? "").replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN ?? "";
  const out: Record<string, unknown> = {
    urlHost: url ? new URL(url).host : null,
    urlLen: url.length,
    tokenLen: token.length,
    tokenPrefix: token.slice(0, 6),
  };
  const key = "buywonderbot:kvdebug";
  const val = JSON.stringify({ t: Date.now(), hello: "world" });
  try {
    const setRes = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([val, "EX", 120]),
    });
    out.setStatus = setRes.status;
    out.setBody = (await setRes.text()).slice(0, 500);
  } catch (e) {
    out.setError = (e as Error).message;
  }
  try {
    const getRes = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    out.getStatus = getRes.status;
    out.getBody = (await getRes.text()).slice(0, 500);
  } catch (e) {
    out.getError = (e as Error).message;
  }
  return NextResponse.json(out);
}
