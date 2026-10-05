"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Evidence {
  title: string; price: number; currency: string; soldDate: string | null;
  url: string; image: string | null; condition: string | null; matchScore: number;
}
interface Deal {
  auctionId: string; bwsku: string | null; title: string; condition: string | null;
  category: string | null; retail: number; bid: number; hasBid: boolean;
  end: string | null; location: string | null; image: string | null;
  compPrice: number; profit: number; margin: number; tier: "HOT" | "WATCH";
  confidence: "high" | "medium" | "low"; ebayQuery: string;
  evidence: Evidence[]; hoursLeft: number | null; dealUrl: string;
}
interface ApiResp {
  ok: boolean;
  setup: { kv: boolean; ebay: boolean; cronSecret: boolean };
  meta: { scannedAt: string; locations: string[]; auctionsScanned: number; ebayCalls: number } | null;
  deals: Deal[]; closingSoon: Deal[];
  counts: { hot: number; watch: number; closingSoon: number };
}

function fmtCountdown(end: string | null, now: number): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - now;
  if (ms <= 0) return "ended";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}
const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export default function Dashboard() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState("");
  const [showVerify, setShowVerify] = useState<string | null>(null);
  const [notifOn, setNotifOn] = useState(false);
  const seenClosing = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/deals", { cache: "no-store" });
      setData(await r.json());
    } catch { /* keep old data */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [load]);

  // 10-minute push notifications (browser)
  useEffect(() => {
    if (!notifOn || !data?.closingSoon?.length || !("Notification" in window)) return;
    for (const d of data.closingSoon) {
      if (seenClosing.current.has(d.auctionId)) continue;
      seenClosing.current.add(d.auctionId);
      new Notification(`⚡ Closing soon: ${d.title.slice(0, 60)}`, {
        body: `Bid ${money(d.bid)} · eBay comp ${money(d.compPrice)} · profit ${money(d.profit)} (${Math.round(d.margin * 100)}% margin)`,
      });
    }
  }, [notifOn, data]);

  const enableNotif = async () => {
    if (!("Notification" in window)) return alert("Notifications not supported in this browser");
    const p = await Notification.requestPermission();
    setNotifOn(p === "granted");
  };

  const deals = (data?.deals ?? []).filter(
    (d) => !filter || d.title.toLowerCase().includes(filter.toLowerCase()),
  );
  const hot = deals.filter((d) => d.tier === "HOT");
  const watch = deals.filter((d) => d.tier === "WATCH");

  return (
    <main style={S.main}>
      <header style={S.header}>
        <div>
          <h1 style={S.h1}>🤖 buywonderbot</h1>
          <div style={S.sub}>
            {data?.meta
              ? <>Last scan {new Date(data.meta.scannedAt).toLocaleString()} · {data.meta.auctionsScanned.toLocaleString()} auctions · {data.meta.ebayCalls} eBay lookups · {data.meta.locations.join(", ")}</>
              : "Connecting…"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter deals…"
            style={S.input} />
          <button onClick={enableNotif} style={S.btn}>
            {notifOn ? "🔔 alerts on" : "🔕 enable alerts"}
          </button>
        </div>
      </header>

      {data && (!data.setup.kv || !data.setup.ebay) && (
        <div style={S.setup}>
          <b>Setup needed:</b>
          {!data.setup.kv && <> add <code>KV_REST_API_URL</code> + <code>KV_REST_API_TOKEN</code></>}
          {!data.setup.kv && !data.setup.ebay && <> and </>}
          {!data.setup.ebay && <> add <code>EBAY_CLIENT_ID</code> + <code>EBAY_CLIENT_SECRET</code> (free at developer.ebay.com)</>}
          . See README for steps, then trigger a scan.
        </div>
      )}

      {(data?.closingSoon?.length ?? 0) > 0 && (
        <section style={S.closing}>
          <h2 style={S.h2}>⚡ CLOSING IN UNDER 10 MINUTES</h2>
          <div style={S.grid}>
            {data!.closingSoon.map((d) => <Card key={d.auctionId} d={d} now={now} closing
              verify={showVerify === d.auctionId} onVerify={() => setShowVerify(showVerify === d.auctionId ? null : d.auctionId)} />)}
          </div>
        </section>
      )}

      <section>
        <h2 style={S.h2}>🔥 HOT deals <span style={S.count}>{hot.length}</span></h2>
        <div style={S.note}>Margin ≥ 50% vs eBay sold price · profit ≥ $100 · product verified</div>
        <div style={S.grid}>{hot.map((d) => <Card key={d.auctionId} d={d} now={now}
          verify={showVerify === d.auctionId} onVerify={() => setShowVerify(showVerify === d.auctionId ? null : d.auctionId)} />)}</div>
        {hot.length === 0 && <div style={S.empty}>No HOT deals right now. The radar is watching.</div>}
      </section>

      <section>
        <h2 style={S.h2}>👀 Watch <span style={S.count}>{watch.length}</span></h2>
        <div style={S.note}>Margin 35–50% · profit ≥ $100 · product verified</div>
        <div style={S.grid}>{watch.map((d) => <Card key={d.auctionId} d={d} now={now}
          verify={showVerify === d.auctionId} onVerify={() => setShowVerify(showVerify === d.auctionId ? null : d.auctionId)} />)}</div>
      </section>
    </main>
  );
}

function Card({ d, now, closing, verify, onVerify }: {
  d: Deal; now: number; closing?: boolean; verify: boolean; onVerify: () => void;
}) {
  const pct = Math.round(d.margin * 100);
  return (
    <div style={{ ...S.card, ...(closing ? S.cardClosing : d.tier === "HOT" ? S.cardHot : {}) }}>
      {closing && <div style={S.urgent}>⏳ {fmtCountdown(d.end, now)} LEFT</div>}
      <div style={S.thumb}>
        {d.image ? <img src={d.image} alt="" loading="lazy" style={S.img} /> : <span style={S.noimg}>no photo</span>}
        <div style={S.tier}>{d.tier}</div>
      </div>
      <div style={S.body}>
        <div style={S.title}>{d.title}</div>
        <div style={S.meta}>{d.location} · {d.condition} · conf: {d.confidence}</div>
        <div style={S.prow}>
          <span>bid <b style={S.bid}>{money(d.bid)}</b></span>
          <span>eBay <b>{money(d.compPrice)}</b></span>
          <span style={S.profit}>+{money(d.profit)}</span>
        </div>
        <div style={S.barWrap}><div style={{ ...S.bar, width: `${Math.min(100, pct)}%` }} /></div>
        <div style={S.sub2}>{pct}% margin · ends in {fmtCountdown(d.end, now)}</div>
        <div style={S.actions}>
          <a href={d.dealUrl} target="_blank" rel="noreferrer" style={S.bidBtn}>Bid on Buywander →</a>
          <button onClick={onVerify} style={S.vbtn}>{verify ? "hide proof" : "verify product"}</button>
        </div>
        {verify && (
          <div style={S.ev}>
            <div style={S.evHead}>eBay query: <code>{d.ebayQuery}</code></div>
            {d.evidence.map((e, i) => (
              <a key={i} href={e.url} target="_blank" rel="noreferrer" style={S.evRow}>
                {e.image && <img src={e.image} alt="" style={S.evImg} />}
                <div>
                  <div style={S.evTitle}>{e.title}</div>
                  <div style={S.evMeta}>sold {money(e.price)} {e.currency}{e.soldDate ? " · " + new Date(e.soldDate).toLocaleDateString() : ""} · match {e.matchScore}</div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  main: { maxWidth: 1200, margin: "0 auto", padding: "20px 16px 60px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 },
  h1: { margin: 0, fontSize: "1.6rem" },
  sub: { color: "#9aa0b0", fontSize: ".8rem", marginTop: 4 },
  input: { background: "#171b22", border: "1px solid #262c38", color: "#fff", borderRadius: 8, padding: "8px 12px" },
  btn: { background: "#1d2532", border: "1px solid #2c3a52", color: "#cfe0ff", borderRadius: 8, padding: "8px 12px", cursor: "pointer" },
  setup: { background: "#2a1f10", border: "1px solid #7a4a1e", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: ".9rem" },
  closing: { background: "linear-gradient(180deg,#2b1210,#160b0b)", border: "2px solid #ff5a48", borderRadius: 14, padding: 16, marginBottom: 24, animation: "pulse 2s infinite" },
  h2: { margin: "18px 0 4px", fontSize: "1.15rem" },
  count: { background: "#222b3d", borderRadius: 12, padding: "2px 10px", fontSize: ".8rem", color: "#9fb6dd" },
  note: { color: "#9aa0b0", fontSize: ".8rem", marginBottom: 10 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 },
  empty: { color: "#9aa0b0", padding: "18px 0" },
  card: { background: "#141821", border: "1px solid #262c38", borderRadius: 12, overflow: "hidden" },
  cardHot: { borderColor: "#7a4a1e" },
  cardClosing: { borderColor: "#ff5a48", boxShadow: "0 0 18px #ff5a4833" },
  urgent: { background: "#ff5a48", color: "#1a0505", fontWeight: 800, textAlign: "center", padding: 6, fontSize: ".85rem", letterSpacing: ".04em" },
  thumb: { position: "relative", height: 170, background: "#0c0e12", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  img: { width: "100%", height: "100%", objectFit: "cover" },
  noimg: { color: "#555", fontSize: ".8rem" },
  tier: { position: "absolute", top: 10, left: 10, background: "#ff9f43", color: "#201304", fontWeight: 800, fontSize: ".7rem", padding: "3px 10px", borderRadius: 20 },
  body: { padding: "12px 14px" },
  title: { fontWeight: 600, fontSize: ".92rem", lineHeight: 1.35, minHeight: "2.5em" },
  meta: { color: "#9aa0b0", fontSize: ".75rem", margin: "6px 0" },
  prow: { display: "flex", gap: 14, alignItems: "baseline", margin: "6px 0", fontSize: ".9rem" },
  bid: { fontSize: "1.3rem", color: "#fff" },
  profit: { color: "#3ddc84", fontWeight: 800, marginLeft: "auto" },
  barWrap: { background: "#222836", borderRadius: 6, height: 8, overflow: "hidden", margin: "8px 0 4px" },
  bar: { background: "linear-gradient(90deg,#3ddc84,#ff9f43)", height: "100%" },
  sub2: { fontSize: ".78rem", color: "#c8cdd8" },
  actions: { display: "flex", gap: 8, marginTop: 10 },
  bidBtn: { background: "#8052ff", color: "#fff", borderRadius: 8, padding: "8px 12px", textDecoration: "none", fontWeight: 700, fontSize: ".85rem" },
  vbtn: { background: "transparent", border: "1px solid #2c3a52", color: "#9fb6dd", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: ".85rem" },
  ev: { marginTop: 10, borderTop: "1px solid #262c38", paddingTop: 8 },
  evHead: { fontSize: ".75rem", color: "#9aa0b0", marginBottom: 6 },
  evRow: { display: "flex", gap: 8, padding: "6px 0", textDecoration: "none", borderBottom: "1px solid #1a1f2a" },
  evImg: { width: 48, height: 48, objectFit: "cover", borderRadius: 6 },
  evTitle: { fontSize: ".78rem", lineHeight: 1.3 },
  evMeta: { fontSize: ".72rem", color: "#9aa0b0" },
};
