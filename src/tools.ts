import { signInWithBrowser, type BrowserLauncher } from "./browser-sign-in.ts";
import { formatPreview, previewCheckout } from "./checkout.ts";
import { formatPlace, placeOrder } from "./place.ts";
import { bookSlot, formatBook, formatSlots, listSlots } from "./slots.ts";
import { readProduct, searchCatalog } from "./catalog.ts";
import { addToCart, changeQuantity, clearCart, readCart, removeLine, type Cart, type CartResult, type CartUnit } from "./cart.ts";
import { chromeLauncher } from "./chrome-launcher.ts";
import { promptForPassword } from "./password-prompt.ts";
import { loadSession, signInWithPassword, type Country } from "./password-sign-in.ts";

export type ToolContext = {
  sessionFile: string;
  origin?: string;
  launcher?: BrowserLauncher;
  promptPassword?: () => Promise<string | null>;
};

export type ToolResult = {
  text: string;
  isError: boolean;
};

export const toolDescriptions = {
  password_sign_in:
    "Sign in with an email. A local prompt asks the shopper for the password. Do not pass the password. It is not stored.",
  browser_sign_in: "Open the shop login page in Chrome. Google, Facebook, and Apple work there.",
  session_status: "Say whether a shopper is signed in, and to which shop.",
  search: "Search the catalog. Titles that start with UAT are left out.",
  product: "Read one product by its slug, including the shop description and price.",
  cart_read: "Read the cart and the total the shop calculated.",
  cart_add: "Add a product to the cart. Pass min, max, and step together when the shop unit is known.",
  cart_update: "Change the quantity of a product already in the cart.",
  cart_remove: "Remove a product from the cart.",
  cart_clear: "Remove every line from the cart. An empty cart stays empty.",
  list_slots: "List open delivery slots. Each line has the day, the hour, the delivery price, and the hour id.",
  reserve_slot: "Reserve one slot for the shopper. Pass the day id and the hour id from list_slots. This does not place an order.",
  checkout_preview: "Show the cart lines, address, slot, and the shop total. This does not place an order.",
  place_order:
    "Place the order when the confirm matches the latest checkout total, address, and slot. A bank or card step is returned to the shopper.",
} as const;

export type ToolName = keyof typeof toolDescriptions;

const COUNTRIES = new Set<Country>(["LT", "EE", "LV"]);

export async function callTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  switch (name) {
    case "password_sign_in":
      return passwordSignIn(args, context);
    case "browser_sign_in":
      return browserSignIn(args, context);
    case "session_status":
      return sessionStatus(context);
    case "search":
      return search(args, context);
    case "product":
      return product(args, context);
    case "cart_read":
      return cartText(await readCart(context));
    case "cart_add":
      return changeCart(args, context, "add");
    case "cart_update":
      return changeCart(args, context, "update");
    case "cart_remove":
      return remove(args, context);
    case "cart_clear":
      return clear(context);
    case "list_slots":
      return listSlotsTool(context);
    case "reserve_slot":
      return reserveSlot(args, context);
    case "checkout_preview":
      return checkoutPreview(context);
    case "place_order":
      return place(args, context);
    default:
      return fail(`Unknown tool ${name}.`);
  }
}

async function passwordSignIn(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  if ("password" in args) return fail("Do not pass the password. A local prompt will ask the shopper.");
  const country = countryOf(args.country);
  const email = stringOf(args.email);
  if (!country) return fail("Country must be LT, EE, or LV.");
  if (!email) return fail("Email is required.");
  const password = await (context.promptPassword ?? promptForPassword)();
  if (password === null) return fail("Sign-in was cancelled before the password was entered.");
  if (password.length === 0) return fail("A password is required.");
  const result = await signInWithPassword({
    email,
    password,
    country,
    rememberMe: true,
    sessionFile: context.sessionFile,
    origin: context.origin,
  });
  if (!result.ok) {
    return fail(
      result.reason === "invalid-credentials"
        ? "Barbora rejected that email or password."
        : `Barbora rejected sign-in (${result.status}).`,
    );
  }
  return ok(`Signed in to Barbora ${result.session.country}.`);
}

async function browserSignIn(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const country = countryOf(args.country);
  if (!country) return fail("Country must be LT, EE, or LV.");
  try {
    const result = await signInWithBrowser({
      country,
      sessionFile: context.sessionFile,
      origin: context.origin,
      launcher: context.launcher ?? chromeLauncher(),
    });
    if (!result.ok) {
      return fail(
        result.reason === "timed-out"
          ? "Sign-in timed out before Barbora accepted it."
          : "Sign-in was cancelled before Barbora accepted it.",
      );
    }
    return ok(`Signed in to Barbora ${result.session.country}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser sign-in failed.";
    return fail(message.includes("playwright") ? `${message}\nInstall it with: npm install playwright` : message);
  }
}

async function listSlotsTool(context: ToolContext): Promise<ToolResult> {
  const result = await listSlots({ sessionFile: context.sessionFile, origin: context.origin });
  const text = formatSlots(result);
  return result.ok ? ok(text) : fail(text);
}

async function reserveSlot(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const dayId = stringOf(args.dayId);
  const timeslotId = stringOf(args.timeslotId);
  if (!dayId || !timeslotId) return fail("A slot needs a day and an hour id.");
  const result = await bookSlot({
    sessionFile: context.sessionFile,
    origin: context.origin,
    dayId,
    timeslotId,
  });
  const text = formatBook(result);
  return result.ok ? ok(text) : fail(text);
}

async function place(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const total = numberOf(args.total);
  const address = stringOf(args.address);
  const slot = stringOf(args.slot);
  if (total === undefined || !address || !slot) return fail("A confirm needs a total, an address, and a slot.");
  const result = await placeOrder({
    sessionFile: context.sessionFile,
    origin: context.origin,
    confirm: { total, address, slot },
  });
  const text = formatPlace(result);
  return result.ok ? ok(text) : fail(text);
}

async function checkoutPreview(context: ToolContext): Promise<ToolResult> {
  const result = await previewCheckout(context);
  if (!result.ok) {
    if (result.reason === "signed-out") return fail("Sign in before checkout.");
    return fail(`Barbora rejected the checkout preview (${result.status}).`);
  }
  return ok(formatPreview(result.preview));
}

async function sessionStatus(context: ToolContext): Promise<ToolResult> {
  const session = await loadSession(context.sessionFile);
  if (!session) return ok("Signed out.");
  return ok(`Signed in to Barbora ${session.country}.`);
}

async function search(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const country = countryOf(args.country);
  const query = stringOf(args.query);
  if (!country) return fail("Country must be LT, EE, or LV.");
  if (!query) return fail("A search query is required.");
  const result = await searchCatalog({ query, country, origin: context.origin });
  if (!result.ok) return fail(`Barbora rejected the search (${result.status}).`);
  if (result.products.length === 0) return ok("No products matched.");
  const lines = result.products.map((product) => {
    const unit = product.unit;
    return `${product.title} — ${product.price} — ${product.slug} — ${product.id} — ${unit.type} ${unit.min}-${unit.max} step ${unit.step}`;
  });
  return ok(lines.join("\n"));
}

async function product(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const country = countryOf(args.country);
  const slug = stringOf(args.slug);
  if (!country) return fail("Country must be LT, EE, or LV.");
  if (!slug) return fail("A product slug is required.");
  const result = await readProduct({ slug, country, origin: context.origin });
  if (!result.ok) return fail(`Barbora rejected the product lookup (${result.status}).`);
  return ok(`${result.product.title} — ${result.product.price}\n${result.product.description}`);
}

async function changeCart(args: Record<string, unknown>, context: ToolContext, action: "add" | "update"): Promise<ToolResult> {
  const productId = stringOf(args.productId);
  const quantity = numberOf(args.quantity);
  if (!productId || quantity === undefined) return fail("A product id and a quantity are required.");
  const unit = unitOf(args);
  if (unit === "incomplete") return fail("Pass min, max, and step together.");
  const input = { sessionFile: context.sessionFile, origin: context.origin, productId, quantity, unit };
  const result = action === "add" ? await addToCart(input) : await changeQuantity(input);
  return cartText(result);
}

async function clear(context: ToolContext): Promise<ToolResult> {
  const result = await clearCart(context);
  if (!result.ok) return cartText(result);
  const text = formatCart(result.cart);
  return ok(result.removed ? `Cleared the previous cart.\n${text}` : text);
}

async function remove(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const productId = stringOf(args.productId);
  if (!productId) return fail("A product id is required.");
  return cartText(await removeLine({ sessionFile: context.sessionFile, origin: context.origin, productId }));
}

function cartText(result: CartResult): ToolResult {
  if (!result.ok) {
    if (result.reason === "signed-out") return fail("Sign in before using the cart.");
    if (result.reason === "quantity") return fail("That quantity is outside the unit the shop sells.");
    return fail(`Barbora rejected the cart (${result.status}).`);
  }
  return ok(formatCart(result.cart));
}

function formatCart(cart: Cart): string {
  const lines = cart.lines.map((line) => `${line.title} — ${line.quantity} — ${line.price}`);
  if (lines.length === 0) lines.push("The cart is empty.");
  lines.push(`Total — ${cart.total}`);
  return lines.join("\n");
}

function countryOf(value: unknown): Country | undefined {
  if (value === undefined) return "LT";
  if (typeof value === "string" && COUNTRIES.has(value as Country)) return value as Country;
  return undefined;
}

function stringOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

function numberOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function unitOf(args: Record<string, unknown>): CartUnit | undefined | "incomplete" {
  const min = args.min;
  const max = args.max;
  const step = args.step;
  if (min === undefined && max === undefined && step === undefined) return undefined;
  if (typeof min !== "number" || typeof max !== "number" || typeof step !== "number" || step <= 0) return "incomplete";
  return { min, max, step };
}

function ok(text: string): ToolResult {
  return { text, isError: false };
}

function fail(text: string): ToolResult {
  return { text, isError: true };
}
