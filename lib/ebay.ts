// eBay "what did it actually sell for" via the Marketplace Insights API.
//
// The old Finding API (findCompletedItems, App-ID-only) was decommissioned by
// eBay on 2025-02-05, so sold comps now come from the official replacement:
//   GET /buy/marketplace_insights/v1_beta/item_sales/search
// Auth: OAuth client-credentials (application token, no user consent).
// Needs Client ID + Client Secret from developer.ebay.com (one app keyset;
// the dashboard labels them "App ID (Client ID)" and "Cert ID (Client Secret)").
//
// Two quirks handled here:
//  1. item_sales/search REQUIRES category_ids, so we resolve the best category
//     per query via the Taxonomy API (cached 7 days), falling back to broad
//     default categories when that lookup fails.
//  2. eBay lists Marketplace Insights as limited-release / restricted: a fresh
//     app keyset may get HTTP 403 until eBay approves it. That surfaces as a
//     clear error instead of silently empty comps.

import { kvGet, kvSet } from "./store";

export interface SoldComp {
  title: string;
  price: number;
  currency: string;
  soldDate: string | null;
  url: string;
  image: string | null;
  condition: string | null;
  listingType: string | null;
}

export interface EbayCreds {
  clientId: string;
  clientSecret: string;
}

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const INSIGHTS_URL =
  "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
const TAXONOMY_SUGGEST_URL =
  "https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions";
const INSIGHTS_SCOPE =
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";
const MARKETPLACE = "EBAY_US";
const CAT_CACHE_TTL_S = 7 * 24 * 3600;

// Broad eBay-US L1 categories covering typical Buywander general merchandise:
// 293 Consumer Electronics, 11700 Home & Garden,
// 11450 Clothing/Shoes/Accessories, 220 Toys & Hobbies.
const DEFAULT_CATEGORY_IDS =
  process.env.EBAY_DEFAULT_CATEGORY_IDS ?? "293,11700,11450,220";

let tokenCache: { token: string; exp: number } | null = null;

/** OAuth application token (client-credentials grant, 2h lifetime). */
async function appToken(creds: EbayCreds): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(INSIGHTS_SCOPE)}`,
  });
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 300);
    throw new Error(
      `eBay OAuth token request failed (HTTP ${res.status}): ${txt}. ` +
        `Check EBAY_CLIENT_ID / EBAY_CLIENT_SECRET at developer.ebay.com.`,
    );
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("eBay OAuth: no access_token in response");
  tokenCache = {
    token: data.access_token,
    exp: Date.now() + (Number(data.expires_in) || 7200) * 1000,
  };
  return tokenCache.token;
}

/** Best eBay category for these keywords (cached 7d), or broad defaults. */
async function resolveCategoryIds(token: string, query: string): Promise<string> {
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  const cacheKey = `buywonderbot:ebay:cat:${slug}`;
  try {
    const cached = await kvGet<string>(cacheKey);
    if (cached) return cached;
  } catch {
    /* KV unavailable (local dev) — fall through to live lookup */
  }
  try {
    const res = await fetch(
      `${TAXONOMY_SUGGEST_URL}?q=${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
        },
      },
    );
    if (!res.ok) throw new Error(`taxonomy HTTP ${res.status}`);
    const data = await res.json();
    const catId = data?.categorySuggestions?.[0]?.category?.categoryId;
    if (catId) {
      const id = String(catId);
      try {
        await kvSet(cacheKey, id, CAT_CACHE_TTL_S);
      } catch {
        /* cache write best-effort */
      }
      return id;
    }
  } catch (e) {
    console.warn(
      "eBay category suggestion failed, using default categories:",
      (e as Error).message,
    );
  }
  return DEFAULT_CATEGORY_IDS;
}

/** Recently sold listings on eBay matching the keywords (best match first). */
export async function findSoldListings(
  creds: EbayCreds,
  keywords: string,
  limit = 50,
): Promise<SoldComp[]> {
  const token = await appToken(creds);
  const categoryIds = await resolveCategoryIds(token, keywords);
  const params = new URLSearchParams({
    q: keywords,
    category_ids: categoryIds,
    limit: String(Math.min(Math.max(limit, 1), 200)),
    fieldgroups: "FULL",
  });
  const res = await fetch(`${INSIGHTS_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
    },
  });
  if (res.status === 403) {
    throw new Error(
      "eBay Marketplace Insights API: access denied for this app keyset. " +
        "eBay lists this API as limited-release — request access for the " +
        "Marketplace Insights API in your developer.ebay.com dashboard, " +
        "then re-run the scan.",
    );
  }
  if (!res.ok) {
    throw new Error(
      `eBay Insights API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  const data = await res.json();
  const sales: any[] = Array.isArray(data.itemSales) ? data.itemSales : [];
  const out: SoldComp[] = [];
  for (const s of sales) {
    const price = Number(s?.lastSoldPrice?.value);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      title: String(s?.title ?? ""),
      price,
      currency: String(s?.lastSoldPrice?.currency ?? "USD"),
      soldDate: s?.lastSoldDate ?? null,
      url: String(
        s?.itemWebUrl ?? (s?.itemId ? `https://www.ebay.com/itm/${s.itemId}` : ""),
      ),
      image: s?.image?.imageUrl ?? null,
      condition: s?.condition ?? null,
      listingType: Array.isArray(s?.buyingOptions) ? s.buyingOptions.join("/") : null,
    });
  }
  return out;
}

export function ebayCredsFromEnv(): EbayCreds | null {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function ebayConfigured(): boolean {
  return ebayCredsFromEnv() !== null;
}
