import { allowedShopUrl, shopOrigin, shopTarget, type Country } from "./password-sign-in.ts";

export type ProductUnit = {
  type: string;
  min: number;
  max: number;
  step: number;
  initialValue: number;
};

export type CatalogProduct = {
  id: string;
  title: string;
  price: number;
  unit: ProductUnit;
  slug: string;
};

export type ProductPage = CatalogProduct & {
  description: string;
};

export type CatalogResult =
  | { ok: true; products: CatalogProduct[] }
  | { ok: false; reason: "rejected"; status: number };

export type ProductResult =
  | { ok: true; product: ProductPage }
  | { ok: false; reason: "rejected"; status: number };

const SEARCH_LIMIT = 8;

export async function searchCatalog(input: {
  query: string;
  country: Country;
  origin?: string;
}): Promise<CatalogResult> {
  const shop = allowedShopUrl(input.origin ?? shopOrigin(input.country));
  if (!shop) return { ok: false, reason: "rejected", status: 0 };
  const url = new URL("/proxy/api/v1/search/constructor/search", shop);
  url.searchParams.set("searchText", input.query);
  url.searchParams.set("limit", String(SEARCH_LIMIT));
  const response = await shopGet(url, input.country);
  if (!response.ok) return { ok: false, reason: "rejected", status: response.status };
  const payload = (await response.json()) as { inventories?: ShopProduct[] };
  const products = (payload.inventories ?? []).filter((product) => !product.title.startsWith("UAT")).map(toProduct);
  return { ok: true, products };
}

export async function readProduct(input: {
  slug: string;
  country: Country;
  origin?: string;
}): Promise<ProductResult> {
  const shop = allowedShopUrl(input.origin ?? shopOrigin(input.country));
  if (!shop) return { ok: false, reason: "rejected", status: 0 };
  const url = new URL(`/proxy/api/v1/product/by-url/${encodeURIComponent(input.slug)}`, shop);
  const response = await shopGet(url, input.country);
  if (!response.ok) return { ok: false, reason: "rejected", status: response.status };
  const payload = (await response.json()) as ShopProduct & { description?: string };
  return {
    ok: true,
    product: { ...toProduct(payload), description: payload.description ?? "" },
  };
}

type ShopProduct = {
  id: string;
  title: string;
  url: string;
  price: number;
  unit: ProductUnit;
};

function toProduct(raw: ShopProduct): CatalogProduct {
  return {
    id: raw.id,
    title: raw.title,
    price: raw.price,
    unit: raw.unit,
    slug: raw.url,
  };
}

async function shopGet(url: URL, country: Country): Promise<Response> {
  const target = shopTarget(country);
  return fetch(url, {
    headers: {
      accept: "application/json",
      "x-target": target,
      "x-source": target,
    },
  });
}
