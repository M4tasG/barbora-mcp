import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Country = "LT" | "EE" | "LV";

export type SessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
};

export type Session = {
  country: Country;
  cookies: SessionCookie[];
  createdAt: string;
};

const SHOP_TARGET: Record<Country, string> = {
  LT: "LT_MAIN_WEB",
  EE: "EE_MAIN_WEB",
  LV: "LV_MAIN_WEB",
};

const SHOP_ORIGIN: Record<Country, string> = {
  LT: "https://barbora.lt",
  EE: "https://barbora.ee",
  LV: "https://barbora.lv",
};

export function shopOrigin(country: Country): string {
  return SHOP_ORIGIN[country];
}

export function shopTarget(country: Country): string {
  return SHOP_TARGET[country];
}

const SHOP_HOSTS = new Set(["barbora.lt", "barbora.ee", "barbora.lv"]);

export function allowedShopUrl(origin: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return undefined;
  }
  if (url.username !== "" || url.password !== "") return undefined;
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (loopback) return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  if (url.protocol !== "https:" || !SHOP_HOSTS.has(host)) return undefined;
  return url;
}

export type SignInResult =
  | { ok: true; session: Session }
  | { ok: false; reason: "invalid-credentials" | "rejected"; status: number };

export async function signInWithPassword(input: {
  email: string;
  password: string;
  country: Country;
  rememberMe?: boolean;
  sessionFile: string;
  origin?: string;
}): Promise<SignInResult> {
  const origin = input.origin ?? shopOrigin(input.country);
  const shop = allowedShopUrl(origin);
  if (!shop) return { ok: false, reason: "rejected", status: 0 };
  const rememberMe = input.rememberMe ?? true;
  const response = await fetch(new URL("/proxy/api/v1/auth/login", shop), {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-target": shopTarget(input.country),
      origin: shop.origin,
      referer: new URL("/login", shop).toString(),
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      rememberMe,
    }),
  });

  if (!response.ok) {
    const code = await errorCode(response);
    if (response.status === 400 && code === "invalidCredentials") {
      return { ok: false, reason: "invalid-credentials", status: response.status };
    }
    return { ok: false, reason: "rejected", status: response.status };
  }

  const cookies = response.headers.getSetCookie().flatMap((raw) => {
    const cookie = parseSetCookie(raw, shop.hostname);
    return cookie ? [cookie] : [];
  });
  if (cookies.length === 0) return { ok: false, reason: "rejected", status: response.status };
  const session: Session = {
    country: input.country,
    cookies,
    createdAt: new Date().toISOString(),
  };
  await saveSession(input.sessionFile, session);
  return { ok: true, session };
}

export async function saveSession(sessionFile: string, session: Session): Promise<void> {
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, JSON.stringify(session, null, 2), { mode: 0o600 });
  await chmod(sessionFile, 0o600);
}

export async function loadSession(sessionFile: string): Promise<Session | null> {
  try {
    return JSON.parse(await readFile(sessionFile, "utf8")) as Session;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function errorCode(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { code?: string };
    return payload.code ?? "";
  } catch {
    return "";
  }
}

function parseSetCookie(raw: string, host: string): SessionCookie | undefined {
  const [pair, ...attributes] = raw.split(";").map((part) => part.trim());
  if (!pair) return undefined;
  const splitAt = pair.indexOf("=");
  if (splitAt <= 0) return undefined;
  const name = pair.slice(0, splitAt);
  const value = pair.slice(splitAt + 1);
  let domain = host;
  let cookiePath = "/";
  for (const attribute of attributes) {
    const [key, attributeValue] = attribute.split("=");
    if (key.toLowerCase() === "domain" && attributeValue) domain = attributeValue.replace(/^\./, "");
    if (key.toLowerCase() === "path" && attributeValue) cookiePath = attributeValue;
  }
  if (domain.toLowerCase() !== host.toLowerCase()) return undefined;
  return { name, value, domain: host.toLowerCase(), path: cookiePath };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
