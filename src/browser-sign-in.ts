import { allowedShopUrl, saveSession, shopOrigin, shopTarget, type Country, type Session, type SessionCookie } from "./password-sign-in.ts";

export type BrowserOpen = {
  loginUrl: string;
  cartUrl: string;
  target: string;
};

export type BrowserSignInStop = "cancelled" | "timed-out";

export type BrowserLauncher = {
  open(input: BrowserOpen): Promise<{ ok: true; cookies: SessionCookie[] } | { ok: false; reason: BrowserSignInStop }>;
};

export async function signInWithBrowser(input: {
  country: Country;
  sessionFile: string;
  launcher: BrowserLauncher;
  origin?: string;
}): Promise<{ ok: true; session: Session } | { ok: false; reason: BrowserSignInStop }> {
  const shop = allowedShopUrl(input.origin ?? shopOrigin(input.country));
  if (!shop) return { ok: false, reason: "cancelled" };
  const opened = await input.launcher.open({
    loginUrl: new URL("/login", shop).toString(),
    cartUrl: new URL("/proxy/api/v1/cart", shop).toString(),
    target: shopTarget(input.country),
  });
  if (!opened.ok) return { ok: false, reason: opened.reason };
  const session: Session = {
    country: input.country,
    cookies: opened.cookies,
    createdAt: new Date().toISOString(),
  };
  await saveSession(input.sessionFile, session);
  return { ok: true, session };
}
