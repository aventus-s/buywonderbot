import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TEMPORARY debug: which Upstash REST SET form works. Delete after diagnosing.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = (process.env.KV_REST_API_URL ?? "").replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN ?? "";
  const H = { Authorization: `Bearer ${token}` };
  const out: Record<string, unknown> = {};
  const rnd = Math.floor(Math.random() * 1e6);

  async function get(k: string) {
    const r = await fetch(`${url}/get/${encodeURIComponent(k)}`, { headers: H });
    return (await r.text()).slice(0, 200);
  }

  // Variant A: POST JSON-array body (documented form)
  const ka = `dbg:a:${rnd}`;
  let r = await fetch(`${url}/set/${encodeURIComponent(ka)}`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify(["valueA"]),
  });
  out.a_set = `${r.status} ${(await r.text()).slice(0, 80)}`;
  out.a_get = await get(ka);

  // Variant B: args in URL path, no body
  const kb = `dbg:b:${rnd}`;
  r = await fetch(`${url}/set/${encodeURIComponent(kb)}/${encodeURIComponent("valueB")}`, {
    method: "POST",
    headers: H,
  });
  out.b_set = `${r.status} ${(await r.text()).slice(0, 80)}`;
  out.b_get = await get(kb);

  // Variant C: path args with EX
  const kc = `dbg:c:${rnd}`;
  r = await fetch(`${url}/set/${encodeURIComponent(kc)}/${encodeURIComponent("valueC")}/EX/120`, {
    method: "POST",
    headers: H,
  });
  out.c_set = `${r.status} ${(await r.text()).slice(0, 80)}`;
  out.c_get = await get(kc);

  return NextResponse.json(out);
}
