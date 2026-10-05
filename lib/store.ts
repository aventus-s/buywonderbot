// Upstash Redis (Vercel KV) via REST. Works with Vercel KV credentials too.

function cfg() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function kvConfigured(): boolean {
  return cfg() !== null;
}

async function kvFetch(path: string, init?: RequestInit): Promise<Response> {
  const c = cfg();
  if (!c) throw new Error("KV not configured (KV_REST_API_URL / KV_REST_API_TOKEN)");
  return fetch(`${c.url}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${c.token}`, ...(init?.headers ?? {}) },
  });
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const res = await kvFetch(`/get/${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`KV GET failed: ${res.status}`);
  const data = await res.json();
  const val = data.result;
  if (val == null) return null;
  try {
    return JSON.parse(val) as T;
  } catch {
    return val as T;
  }
}

export async function kvSet(key: string, value: unknown, exSeconds?: number): Promise<void> {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  // NOTE: this Upstash endpoint only accepts command args in the URL path —
  // a POST JSON-array body is stored verbatim instead of being parsed.
  const parts = [encodeURIComponent(key), encodeURIComponent(raw)];
  if (exSeconds) parts.push("EX", String(Math.floor(exSeconds)));
  const res = await kvFetch(`/set/${parts.join("/")}`, { method: "POST" });
  if (!res.ok) throw new Error(`KV SET failed: ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data || data.result !== "OK") throw new Error(`KV SET unexpected response: ${JSON.stringify(data)?.slice(0, 120)}`);
}
