// Buywander auction API client (ported from the Python scalper).
// Reverse-engineered from the buywander.com Nuxt frontend.

export const API_BASE = "https://api.buywander.com";
const SEARCH_PATH = "/api/site/v1/Auctions/search";

export const ALL_LOCATIONS: Record<string, string> = {
  Chicago: "11741000-0000-0000-0000-000000000101",
  Denver: "11741000-0000-0000-0000-000000000102",
  Minneapolis: "b543264e-f93b-4692-a6b0-8b0cb5ce8da2",
  Portland: "7dbb5ba8-ac09-4a07-8c0e-36181c7e0e9f",
  Sacramento: "1a15ff63-9479-4804-a9ad-730ec64bd428",
  "Salt Lake City": "08dde114-da37-1ddb-6c02-e090d6310000",
  "Seattle (Kent)": "08dd87d1-4832-8fa4-00d8-6156d6200000",
  Spokane: "08dd87d1-4832-58a3-00d8-6156d6200000",
};

export interface AuctionRecord {
  auctionId: string;
  bwsku: string | null;
  title: string;
  condition: string | null;
  category: string | null;
  itemType: string | null;
  quantity: number;
  retail: number;
  bid: number;
  hasBid: boolean;
  start: string | null;
  end: string | null;
  location: string | null;
  locationId: string | null;
  image: string | null;
}

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
  Origin: "https://buywander.com",
  Referer: "https://buywander.com/auctions",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

async function postJson(path: string, body: unknown, retries = 4): Promise<any> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // polite delay
      await new Promise((r) => setTimeout(r, 350 + Math.random() * 150));
      const res = await fetch(API_BASE + path, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if ([429, 500, 502, 503, 504].includes(res.status)) {
          lastErr = new Error(`HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        throw new Error(`Buywander API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

function flatten(raw: any): AuctionRecord {
  const item = raw.item ?? {};
  const wb = raw.winningBid ?? {};
  const loc = raw.storeLocation ?? {};
  const images: string[] = item.images ?? [];
  return {
    auctionId: raw.id,
    bwsku: item.bwsku ?? null,
    title: (item.title ?? "").trim(),
    condition: item.condition ?? null,
    category: item.categoryName ?? null,
    itemType: item.type ?? null,
    quantity: item.quantity ?? 1,
    retail: Number(item.price ?? 0),
    bid: wb && wb.amount != null ? Number(wb.amount) : 0,
    hasBid: !!(wb && wb.amount != null),
    start: raw.startDate ?? null,
    end: raw.endDate ?? null,
    location: loc.name ?? null,
    locationId: loc.id ?? null,
    image: images[0] ?? null,
  };
}

/** Fetch ALL active auctions for the given location ids (follows searchAfter cursors). */
export async function fetchAllAuctions(locationIds: string[]): Promise<AuctionRecord[]> {
  const out: AuctionRecord[] = [];
  const seen = new Set<string>();
  let searchAfter: unknown = null;
  for (;;) {
    const page = await postJson(SEARCH_PATH, {
      pageNumber: 1,
      pageSize: 100,
      isPaginated: false,
      searchAfter,
      conditions: null,
      itemTypes: null,
      categories: null,
      subcategories: null,
      storeLocationIds: locationIds,
      search: null,
      minRetailPrice: null,
      maxRetailPrice: null,
      sortBy: "EndingSoonest",
      myAuctions: null,
      winning: null,
      losing: null,
      watching: null,
      additionalCategories: null,
      filter: null,
      isFallback: null,
    });
    const items: any[] = page.items ?? [];
    let fresh = 0;
    for (const it of items) {
      if (it?.id && !seen.has(it.id)) {
        seen.add(it.id);
        out.push(flatten(it));
        fresh++;
      }
    }
    if (!page.hasNextPage || items.length === 0 || fresh === 0 || !page.nextSearchAfter) break;
    searchAfter = page.nextSearchAfter;
  }
  return out;
}

export function dealUrl(rec: AuctionRecord): string {
  return rec.bwsku
    ? `https://buywander.com/auctions?search=${encodeURIComponent(rec.bwsku)}`
    : "https://buywander.com/auctions";
}
