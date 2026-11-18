import { cookiesForShop, type BrowserLauncher } from "./browser-sign-in.ts";
import type { SessionCookie } from "./password-sign-in.ts";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function chromeLauncher(): BrowserLauncher {
  return {
    async open(input) {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ channel: "chrome", headless: false });
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(input.loginUrl);
        const deadline = Date.now() + FIVE_MINUTES_MS;
        while (Date.now() < deadline) {
          if (page.isClosed()) return { ok: false, reason: "cancelled" };
          const response = await context.request.get(input.cartUrl, {
            failOnStatusCode: false,
            maxRedirects: 0,
            headers: { accept: "application/json", "x-target": input.target },
          });
          const body = await response.json().catch(() => null);
          if (isShopCart(response.status(), body)) {
            const cookies = cookiesForShop(
              (await context.cookies()).map(toSessionCookie),
              new URL(input.loginUrl).hostname,
            );
            if (cookies.length > 0) return { ok: true, cookies };
          }
          await page.waitForTimeout(1000);
        }
        return { ok: false, reason: "timed-out" };
      } catch (error) {
        if (isClosedTarget(error)) return { ok: false, reason: "cancelled" };
        throw error;
      } finally {
        await browser.close();
      }
    },
  };
}

export function isShopCart(status: number, body: unknown): boolean {
  if (status !== 200 || !body || typeof body !== "object") return false;
  const total = (body as { summary?: { prices?: { totalPrice?: unknown } } }).summary?.prices?.totalPrice;
  return typeof total === "number";
}

function isClosedTarget(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("has been closed") || message.includes("Target closed");
}

function toSessionCookie(cookie: { name: string; value: string; domain: string; path: string }): SessionCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain.replace(/^\./, ""),
    path: cookie.path || "/",
  };
}
