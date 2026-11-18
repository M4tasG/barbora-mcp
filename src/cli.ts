import { stdin, stdout } from "node:process";
import { homedir } from "node:os";
import path from "node:path";
import { signInWithBrowser } from "./browser-sign-in.ts";
import { addToCart, changeQuantity, readCart, removeLine, type CartResult, type CartUnit } from "./cart.ts";
import { readProduct, searchCatalog } from "./catalog.ts";
import { formatPreview, previewCheckout } from "./checkout.ts";
import { bookSlot, formatBook, formatSlots, listSlots } from "./slots.ts";
import { promptToPlace } from "./confirm-prompt.ts";
import { formatPlace, placeOrder } from "./place.ts";
import { chromeLauncher } from "./chrome-launcher.ts";
import { signInWithPassword, type Country } from "./password-sign-in.ts";

const COUNTRIES = new Set<Country>(["LT", "EE", "LV"]);

function sessionFile(): string {
  return path.join(homedir(), ".config", "barbora", "session.json");
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function usage(): void {
  stdout.write("Usage: login --email you@example.com --country LT|EE|LV\n");
  stdout.write("       login --browser --country LT|EE|LV\n");
  stdout.write("       search --query pienas --country LT|EE|LV\n");
  stdout.write("       product --slug <slug> --country LT|EE|LV\n");
  stdout.write("       cart\n");
  stdout.write("       cart add --id <id> --quantity <n> --min <n> --max <n> --step <n>\n");
  stdout.write("       cart set --id <id> --quantity <n> --min <n> --max <n> --step <n>\n");
  stdout.write("       cart remove --id <id>\n");
  stdout.write("       checkout\n");
  stdout.write("       checkout slots\n");
  stdout.write("       checkout slot --day <day> --id <id>\n");
  stdout.write("       checkout place --total <n> --address <address> --slot <slot> --line <id>:<quantity>\n");
}

function readCountry(): Country | undefined {
  const country = argument("--country") ?? "LT";
  if (!COUNTRIES.has(country as Country)) {
    usage();
    return undefined;
  }
  return country as Country;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim()));
    stdin.on("error", reject);
  });
}

function readHiddenPassword(): Promise<string> {
  stdout.write("Barbora password: ");
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve) => {
    let password = "";
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text === "\u0003") {
        stdin.setRawMode(false);
        stdin.off("data", onData);
        process.exit(1);
      }
      if (text === "\n" || text === "\r" || text === "\u0004") {
        stdin.setRawMode(false);
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(password);
        return;
      }
      if (text === "\u007f" || text === "\b") {
        password = password.slice(0, -1);
        return;
      }
      password += text;
    };
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  if (process.argv.includes("--password-stdin") || !stdin.isTTY) return readStdin();
  return readHiddenPassword();
}

async function browserLogin(country: Country): Promise<number> {
  stdout.write("A Chrome window will open. Sign in there, then leave it open until this command finishes.\n");
  try {
    const result = await signInWithBrowser({
      country,
      sessionFile: argument("--session-file") ?? sessionFile(),
      origin: argument("--origin"),
      launcher: chromeLauncher(),
    });
    if (!result.ok) {
      const message =
        result.reason === "timed-out"
          ? "Sign-in timed out before Barbora accepted it.\n"
          : "Sign-in was cancelled before Barbora accepted it.\n";
      stdout.write(message);
      return 1;
    }
    stdout.write(`Signed in to Barbora ${result.session.country}.\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser sign-in failed.";
    stdout.write(`${message}\n`);
    if (message.includes("playwright")) {
      stdout.write("Install it with: npm install playwright\n");
    }
    return 1;
  }
}

async function searchCommand(): Promise<number> {
  const country = readCountry();
  if (!country) return 1;
  const query = argument("--query");
  if (!query) {
    usage();
    return 1;
  }
  const result = await searchCatalog({ query, country, origin: argument("--origin") });
  if (!result.ok) {
    stdout.write(`Barbora rejected the search (${result.status}).\n`);
    return 1;
  }
  if (result.products.length === 0) {
    stdout.write("No products matched.\n");
    return 0;
  }
  for (const product of result.products) {
    const unit = product.unit;
    stdout.write(
      `${product.title} — ${product.price} — ${product.slug} — ${product.id} — ${unit.type} ${unit.min}-${unit.max} step ${unit.step}\n`,
    );
  }
  return 0;
}

async function productCommand(): Promise<number> {
  const country = readCountry();
  if (!country) return 1;
  const slug = argument("--slug");
  if (!slug) {
    usage();
    return 1;
  }
  const result = await readProduct({ slug, country, origin: argument("--origin") });
  if (!result.ok) {
    stdout.write(`Barbora rejected the product lookup (${result.status}).\n`);
    return 1;
  }
  const product = result.product;
  stdout.write(`${product.title} — ${product.price}\n${product.description}\n`);
  return 0;
}

async function login(): Promise<number> {
  const country = readCountry();
  if (!country) return 1;
  if (process.argv.includes("--browser")) return browserLogin(country);
  const email = argument("--email");
  if (!email) {
    usage();
    return 1;
  }
  const password = await readPassword();
  const result = await signInWithPassword({
    email,
    password,
    country,
    rememberMe: true,
    sessionFile: argument("--session-file") ?? sessionFile(),
    origin: argument("--origin"),
  });
  if (!result.ok) {
    const message =
      result.reason === "invalid-credentials"
        ? "Barbora rejected that email or password."
        : `Barbora rejected sign-in (${result.status}).`;
    stdout.write(`${message}\n`);
    return 1;
  }
  stdout.write(`Signed in to Barbora ${result.session.country}.\n`);
  return 0;
}

function printCart(result: CartResult): number {
  if (!result.ok) {
    const message =
      result.reason === "signed-out"
        ? "Sign in before using the cart.\n"
        : result.reason === "quantity"
          ? "That quantity is outside the unit the shop sells.\n"
          : `Barbora rejected the cart (${result.status}).\n`;
    stdout.write(message);
    return 1;
  }
  if (result.cart.lines.length === 0) stdout.write("The cart is empty.\n");
  for (const line of result.cart.lines) {
    stdout.write(`${line.title} — ${line.quantity} — ${line.price}\n`);
  }
  stdout.write(`Total — ${result.cart.total}\n`);
  return 0;
}

async function cartCommand(): Promise<number> {
  const file = argument("--session-file") ?? sessionFile();
  const origin = argument("--origin");
  const action = process.argv[3];
  if (!action || action.startsWith("--")) return printCart(await readCart({ sessionFile: file, origin }));
  const productId = argument("--id");
  if (!productId || !["add", "set", "remove"].includes(action)) {
    usage();
    return 1;
  }
  if (action === "remove") return printCart(await removeLine({ sessionFile: file, origin, productId }));
  const quantity = Number(argument("--quantity"));
  if (!Number.isFinite(quantity)) {
    usage();
    return 1;
  }
  const unit = readUnit();
  if (unit === "incomplete") {
    usage();
    return 1;
  }
  if (action === "add") return printCart(await addToCart({ sessionFile: file, origin, productId, quantity, unit }));
  return printCart(await changeQuantity({ sessionFile: file, origin, productId, quantity, unit }));
}

function linesFromArgs(): { id: string; quantity: number }[] | undefined {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== "--line") continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) return undefined;
    values.push(value);
  }
  if (values.length === 0) return undefined;
  const lines: { id: string; quantity: number }[] = [];
  for (const value of values) {
    const splitAt = value.lastIndexOf(":");
    if (splitAt <= 0) return undefined;
    const id = value.slice(0, splitAt);
    const quantity = Number(value.slice(splitAt + 1));
    if (!id || !Number.isFinite(quantity)) return undefined;
    lines.push({ id, quantity });
  }
  return lines;
}

function readUnit(): CartUnit | undefined | "incomplete" {
  const min = argument("--min");
  const max = argument("--max");
  const step = argument("--step");
  if (min === undefined && max === undefined && step === undefined) return undefined;
  if (min === undefined || max === undefined || step === undefined) return "incomplete";
  const unit = { min: Number(min), max: Number(max), step: Number(step) };
  if (!Number.isFinite(unit.min) || !Number.isFinite(unit.max) || !Number.isFinite(unit.step) || unit.step <= 0) {
    return "incomplete";
  }
  return unit;
}

async function checkoutCommand(): Promise<number> {
  if (process.argv[3] === "place") return placeCommand();
  if (process.argv[3] === "slots") return slotsCommand();
  if (process.argv[3] === "slot") return slotCommand();
  if (process.argv[3] && !process.argv[3].startsWith("--")) {
    usage();
    return 1;
  }
  const result = await previewCheckout({
    sessionFile: argument("--session-file") ?? sessionFile(),
    origin: argument("--origin"),
  });
  if (!result.ok) {
    const message =
      result.reason === "signed-out"
        ? "Sign in before checkout.\n"
        : `Barbora rejected the checkout preview (${result.status}).\n`;
    stdout.write(message);
    return 1;
  }
  stdout.write(`${formatPreview(result.preview)}\n`);
  return 0;
}

async function slotsCommand(): Promise<number> {
  const result = await listSlots({
    sessionFile: argument("--session-file") ?? sessionFile(),
    origin: argument("--origin"),
  });
  stdout.write(`${formatSlots(result)}\n`);
  return result.ok ? 0 : 1;
}

async function slotCommand(): Promise<number> {
  const dayId = argument("--day");
  const timeslotId = argument("--id");
  if (!dayId || !timeslotId) {
    usage();
    return 1;
  }
  const result = await bookSlot({
    sessionFile: argument("--session-file") ?? sessionFile(),
    origin: argument("--origin"),
    dayId,
    timeslotId,
  });
  stdout.write(`${formatBook(result)}\n`);
  return result.ok ? 0 : 1;
}

async function placeCommand(): Promise<number> {
  const totalText = argument("--total");
  const address = argument("--address");
  const slot = argument("--slot");
  const lines = linesFromArgs();
  const total = totalText === undefined ? Number.NaN : Number(totalText);
  if (!address || !slot || !Number.isFinite(total) || !lines) {
    usage();
    return 1;
  }
  const result = await placeOrder({
    sessionFile: argument("--session-file") ?? sessionFile(),
    origin: argument("--origin"),
    confirm: { total, address, slot, lines },
    accept: promptToPlace,
  });
  stdout.write(`${formatPlace(result)}\n`);
  if (result.ok) return 0;
  if (result.reason === "payment") return 0;
  return 1;
}

const command = process.argv[2];
if (command === "login") process.exitCode = await login();
else if (command === "search") process.exitCode = await searchCommand();
else if (command === "product") process.exitCode = await productCommand();
else if (command === "cart") process.exitCode = await cartCommand();
else if (command === "checkout") process.exitCode = await checkoutCommand();
else {
  usage();
  process.exitCode = 1;
}
