import { allowedShopUrl, loadSession, shopOrigin, shopTarget, type Session } from "./password-sign-in.ts";

export type CartUnit = {
  min: number;
  max: number;
  step: number;
};

export type CartLine = {
  id: string;
  title: string;
  quantity: number;
  price: number;
};

export type Cart = {
  lines: CartLine[];
  total: number;
};

export type CartResult =
  | { ok: true; cart: Cart }
  | { ok: false; reason: "signed-out" | "quantity" }
  | { ok: false; reason: "rejected"; status: number };

export async function readCart(input: { sessionFile: string; origin?: string }): Promise<CartResult> {
  const opened = await openSession(input.sessionFile, input.origin);
  if (!opened.ok) return opened;
  const response = await shopRequest(opened, "GET", "/proxy/api/v1/cart");
  return parseCart(response);
}

export async function addToCart(input: {
  sessionFile: string;
  productId: string;
  quantity: number;
  unit?: CartUnit;
  origin?: string;
}): Promise<CartResult> {
  return writeCart({
    ...input,
    method: "POST",
    path: "/proxy/api/v1/cart/item",
    body: { id: input.productId, quantity: input.quantity },
  });
}

export async function changeQuantity(input: {
  sessionFile: string;
  productId: string;
  quantity: number;
  unit?: CartUnit;
  origin?: string;
}): Promise<CartResult> {
  return writeCart({
    ...input,
    method: "PATCH",
    path: `/proxy/api/v1/cart/item/${encodeURIComponent(input.productId)}`,
    body: { quantity: input.quantity },
  });
}

export async function clearCart(input: {
  sessionFile: string;
  origin?: string;
}): Promise<CartResult & { removed?: number }> {
  const current = await readCart(input);
  if (!current.ok) return current;
  const ids = [...new Set(current.cart.lines.map((line) => line.id))];
  let cart = current.cart;
  for (const productId of ids) {
    const removed = await removeLine({ sessionFile: input.sessionFile, origin: input.origin, productId });
    if (!removed.ok) return removed;
    cart = removed.cart;
  }
  return { ok: true, cart, removed: ids.length };
}

export async function removeLine(input: {
  sessionFile: string;
  productId: string;
  origin?: string;
}): Promise<CartResult> {
  return writeCart({
    ...input,
    method: "DELETE",
    path: `/proxy/api/v1/cart/item/${encodeURIComponent(input.productId)}`,
  });
}

async function writeCart(input: {
  sessionFile: string;
  origin?: string;
  method: string;
  path: string;
  body?: unknown;
  quantity?: number;
  unit?: CartUnit;
}): Promise<CartResult> {
  if (input.unit && input.quantity !== undefined && !acceptsQuantity(input.quantity, input.unit)) {
    return { ok: false, reason: "quantity" };
  }
  const opened = await openSession(input.sessionFile, input.origin);
  if (!opened.ok) return opened;
  const response = await shopRequest(opened, input.method, input.path, input.body);
  const failed = failure(response);
  if (failed) return failed;
  return readCart({ sessionFile: input.sessionFile, origin: input.origin });
}

export async function shopJson(input: {
  sessionFile: string;
  origin?: string;
  path: string;
}): Promise<{ ok: true; body: unknown } | { ok: false; reason: "signed-out" } | { ok: false; reason: "rejected"; status: number }> {
  const opened = await openSession(input.sessionFile, input.origin);
  if (!opened.ok) return opened;
  const response = await shopRequest(opened, "GET", input.path);
  if (response.status === 401) return { ok: false, reason: "signed-out" };
  if (!response.ok) return { ok: false, reason: "rejected", status: response.status };
  return { ok: true, body: await response.json() };
}

export async function shopExchange(input: {
  sessionFile: string;
  origin?: string;
  method: string;
  path: string;
  body?: unknown;
}): Promise<
  | { ok: true; status: number; body: unknown; location: string | null }
  | { ok: false; reason: "signed-out" }
  | { ok: false; reason: "rejected"; status: number; body: unknown }
> {
  const opened = await openSession(input.sessionFile, input.origin);
  if (!opened.ok) return opened;
  const response = await shopRequest(opened, input.method, input.path, input.body);
  if (response.status === 401) return { ok: false, reason: "signed-out" };
  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400) {
    return { ok: true, status: response.status, body: null, location };
  }
  if (!response.ok) return { ok: false, reason: "rejected", status: response.status, body: await errorBody(response) };
  const text = await response.text();
  if (text.length === 0) return { ok: true, status: response.status, body: null, location };
  try {
    return { ok: true, status: response.status, body: JSON.parse(text) as unknown, location };
  } catch {
    return { ok: false, reason: "rejected", status: response.status };
  }
}

type OpenSession = { ok: true; session: Session; origin: string; cookie: string };

async function openSession(sessionFile: string, origin: string | undefined): Promise<OpenSession | { ok: false; reason: "signed-out" }> {
  const session = await loadSession(sessionFile);
  if (!session) return { ok: false, reason: "signed-out" };
  const shop = allowedShopUrl(origin ?? shopOrigin(session.country));
  if (!shop) return { ok: false, reason: "signed-out" };
  const hostname = shop.hostname.toLowerCase();
  const cookie = session.cookies
    .filter((cookie) => cookie.domain.toLowerCase() === hostname)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  if (!cookie) return { ok: false, reason: "signed-out" };
  return { ok: true, session, origin: shop.origin, cookie };
}

async function shopRequest(opened: OpenSession, method: string, path: string, body?: unknown): Promise<Response> {
  const target = shopTarget(opened.session.country);
  return fetch(new URL(path, opened.origin), {
    method,
    redirect: "manual",
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-target": target,
      "x-source": target,
      cookie: opened.cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function errorBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function failure(response: Response): CartResult | undefined {
  if (response.status === 401) return { ok: false, reason: "signed-out" };
  if (!response.ok) return { ok: false, reason: "rejected", status: response.status };
  return undefined;
}

async function parseCart(response: Response): Promise<CartResult> {
  const failed = failure(response);
  if (failed) return failed;
  const payload = (await response.json()) as {
    items?: unknown[];
    summary?: { prices?: { totalPrice?: number } };
  };
  const total = payload.summary?.prices?.totalPrice;
  if (typeof total !== "number") return { ok: false, reason: "rejected", status: response.status };
  return { ok: true, cart: { lines: linesFrom(payload.items ?? []), total } };
}

function linesFrom(items: unknown[]): CartLine[] {
  const lines: CartLine[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { items?: unknown[]; id?: unknown; title?: unknown; quantity?: unknown; price?: unknown };
    if (Array.isArray(record.items)) {
      lines.push(...linesFrom(record.items));
      continue;
    }
    if (typeof record.id !== "string") continue;
    lines.push({
      id: record.id,
      title: typeof record.title === "string" ? record.title : "",
      quantity: typeof record.quantity === "number" ? record.quantity : 0,
      price: typeof record.price === "number" ? record.price : 0,
    });
  }
  return lines;
}

function acceptsQuantity(quantity: number, unit: CartUnit): boolean {
  if (!Number.isFinite(quantity) || quantity < unit.min || quantity > unit.max) return false;
  const steps = (quantity - unit.min) / unit.step;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}
