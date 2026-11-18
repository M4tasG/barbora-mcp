import { shopExchange } from "./cart.ts";
import { previewCheckout, type CheckoutPreview } from "./checkout.ts";

export type ConfirmLine = {
  id: string;
  quantity: number;
};

export type OrderConfirm = {
  total: number;
  address: string;
  slot: string;
  lines: ConfirmLine[];
};

export type PlaceResult =
  | { ok: true; orderId: string | null }
  | { ok: false; reason: "signed-out" }
  | { ok: false; reason: "rejected"; status: number }
  | { ok: false; reason: "incomplete" }
  | { ok: false; reason: "mismatch" }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "payment"; url: string }
  | { ok: false; reason: "payment-rejected" };

export async function placeOrder(input: {
  sessionFile: string;
  origin?: string;
  confirm: OrderConfirm;
  accept: (message: string) => Promise<boolean>;
}): Promise<PlaceResult> {
  const preview = await previewCheckout({ sessionFile: input.sessionFile, origin: input.origin });
  if (!preview.ok) return preview;
  const checkout = preview.preview;
  if (checkout.address === null || checkout.slot === null || checkout.ageCheck !== null) {
    return { ok: false, reason: "incomplete" };
  }
  if (
    input.confirm.total !== checkout.total ||
    input.confirm.address !== checkout.address ||
    input.confirm.slot !== checkout.slot ||
    !sameLines(input.confirm.lines, checkout.lines)
  ) {
    return { ok: false, reason: "mismatch" };
  }
  const accepted = await input.accept(formatConfirm(checkout));
  if (!accepted) return { ok: false, reason: "cancelled" };
  const sent = await shopExchange({
    sessionFile: input.sessionFile,
    origin: input.origin,
    method: "POST",
    path: "/proxy/api/v1/cart/submit",
    // The shop client posts JSON. The saved source does not name these fields, so the body stays empty.
    body: {},
  });
  if (!sent.ok) return sent;
  const step = paymentStep(sent.body, sent.location);
  if (step === "rejected") return { ok: false, reason: "payment-rejected" };
  if (typeof step === "object") return { ok: false, reason: "payment", url: step.url };
  return { ok: true, orderId: orderIdOf(sent.body) };
}

export function formatPlace(result: PlaceResult): string {
  if (result.ok) {
    return result.orderId ? `The shop accepted the order.\n${result.orderId}` : "The shop accepted the order.";
  }
  if (result.reason === "signed-out") return "Sign in before placing the order.";
  if (result.reason === "incomplete") return "An address, a slot, or the age check is still open. The order was not placed.";
  if (result.reason === "mismatch") return "That confirm does not match the latest checkout. The order was not placed.";
  if (result.reason === "cancelled") return "The shopper did not confirm. The order was not placed.";
  if (result.reason === "payment") return `The shopper still has to finish this payment step.\n${result.url}`;
  if (result.reason === "payment-rejected") {
    return "The shop accepted the submit. The payment step was withheld. Finish payment on the shop site.";
  }
  return `Barbora rejected the order (${result.status}).`;
}

export function formatConfirm(preview: CheckoutPreview & { address: string; slot: string }): string {
  const lines = preview.lines.map((line) => `${line.title} — ${line.quantity} — ${line.id}`);
  if (lines.length === 0) lines.push("The cart is empty.");
  lines.push(`Total — ${preview.total}`);
  lines.push(`Address — ${preview.address}`);
  lines.push(`Slot — ${preview.slot}`);
  return lines.join("\n");
}

function sameLines(confirm: ConfirmLine[], checkout: CheckoutPreview["lines"]): boolean {
  if (confirm.length !== checkout.length) return false;
  const wanted = new Map<string, number>();
  for (const line of confirm) {
    if (wanted.has(line.id)) return false;
    wanted.set(line.id, line.quantity);
  }
  return checkout.every((line) => wanted.get(line.id) === line.quantity);
}

const SHOP_HOSTS = new Set(["barbora.lt", "barbora.ee", "barbora.lv"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
// Payment hosts stay empty until one is confirmed from the shop.
const PAYMENT_HOSTS = new Set<string>();

function paymentStep(body: unknown, location: string | null): "none" | "rejected" | { url: string } {
  const payment = field(body, "payment");
  const candidates = [
    location,
    field(body, "url"),
    field(body, "redirectUrl"),
    field(payment, "url"),
    field(payment, "redirectUrl"),
  ];
  let url: string | undefined;
  for (const value of candidates) {
    if (typeof value !== "string" || value.trim() === "") continue;
    if (!allowedPaymentUrl(value)) return "rejected";
    url ??= value;
  }
  return url === undefined ? "none" : { url };
}

function allowedPaymentUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(host)) return url.protocol === "http:" || url.protocol === "https:";
  if (SHOP_HOSTS.has(host) || PAYMENT_HOSTS.has(host)) return url.protocol === "https:";
  return false;
}

function orderIdOf(body: unknown): string | null {
  const id = field(body, "id") ?? field(body, "orderId");
  return typeof id === "string" && id.length > 0 ? id : null;
}

function field(body: unknown, key: string): unknown {
  if (!body || typeof body !== "object") return undefined;
  return (body as Record<string, unknown>)[key];
}
