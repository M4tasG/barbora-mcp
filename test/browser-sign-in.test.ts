import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cookiesForShop, signInWithBrowser, type BrowserLauncher } from "../src/browser-sign-in.ts";
import { isShopCart } from "../src/chrome-launcher.ts";
import { loadSession } from "../src/password-sign-in.ts";

test("browser sign-in writes the session after the shop accepts the shopper", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-browser-"));
  const sessionFile = path.join(dir, "session.json");
  let loginUrl = "";
  const launcher: BrowserLauncher = {
    async open(input) {
      loginUrl = input.loginUrl;
      assert.equal(input.cartUrl, "https://barbora.lv/proxy/api/v1/cart");
      assert.equal(input.target, "LV_MAIN_WEB");
      return {
        ok: true,
        cookies: [{ name: ".BRBAUTH", value: "from-browser", domain: "barbora.lv", path: "/" }],
      };
    },
  };
  try {
    const result = await signInWithBrowser({ country: "LV", sessionFile, launcher });
    assert.equal(loginUrl, "https://barbora.lv/login");
    assert.equal(result.ok, true);
    const session = await loadSession(sessionFile);
    assert.equal(session?.country, "LV");
    assert.deepEqual(session?.cookies, [
      { name: ".BRBAUTH", value: "from-browser", domain: "barbora.lv", path: "/" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("browser sign-in does not open a foreign shop address", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-browser-"));
  const sessionFile = path.join(dir, "session.json");
  const launcher: BrowserLauncher = {
    async open() {
      throw new Error("launcher should not run");
    },
  };
  try {
    const result = await signInWithBrowser({
      country: "LT",
      sessionFile,
      launcher,
      origin: "https://barbora.lt@evil.example",
    });
    assert.deepEqual(result, { ok: false, reason: "cancelled" });
    await assert.rejects(access(sessionFile));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("browser sign-in stores the shop cookies and drops the others", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-browser-"));
  const sessionFile = path.join(dir, "session.json");
  const launcher: BrowserLauncher = {
    async open() {
      return {
        ok: true,
        cookies: [
          { name: ".BRBAUTH", value: "from-browser", domain: ".barbora.lt", path: "/" },
          { name: "SID", value: "google-session", domain: ".google.com", path: "/" },
          { name: "wide", value: "suffix", domain: "lt", path: "/" },
        ],
      };
    },
  };
  try {
    const result = await signInWithBrowser({ country: "LT", sessionFile, launcher });
    assert.equal(result.ok, true);
    const session = await loadSession(sessionFile);
    assert.deepEqual(session?.cookies, [
      { name: ".BRBAUTH", value: "from-browser", domain: "barbora.lt", path: "/" },
    ]);
    assert.equal(JSON.stringify(session).includes("google-session"), false);
    assert.equal(cookiesForShop(session?.cookies ?? [], "barbora.lt").length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a browser sign-in with no shop cookie writes nothing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-browser-"));
  const sessionFile = path.join(dir, "session.json");
  const launcher: BrowserLauncher = {
    async open() {
      return {
        ok: true,
        cookies: [{ name: "SID", value: "google-session", domain: "google.com", path: "/" }],
      };
    },
  };
  try {
    const result = await signInWithBrowser({ country: "LT", sessionFile, launcher });
    assert.deepEqual(result, { ok: false, reason: "cancelled" });
    await assert.rejects(access(sessionFile));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a cart page without a total is not a signed-in shop cart", () => {
  assert.equal(isShopCart(200, { summary: { prices: { totalPrice: 0 } } }), true);
  assert.equal(isShopCart(200, { summary: { prices: {} } }), false);
  assert.equal(isShopCart(200, "<html>guest</html>"), false);
  assert.equal(isShopCart(401, { summary: { prices: { totalPrice: 1 } } }), false);
});

test("closing the window before sign-in writes nothing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-browser-"));
  const sessionFile = path.join(dir, "session.json");
  const launcher: BrowserLauncher = {
    async open() {
      return { ok: false, reason: "cancelled" };
    },
  };
  try {
    const result = await signInWithBrowser({ country: "LT", sessionFile, launcher });
    assert.deepEqual(result, { ok: false, reason: "cancelled" });
    await assert.rejects(access(sessionFile));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a timed-out browser sign-in writes nothing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-browser-"));
  const sessionFile = path.join(dir, "session.json");
  const launcher: BrowserLauncher = {
    async open() {
      return { ok: false, reason: "timed-out" };
    },
  };
  try {
    const result = await signInWithBrowser({ country: "EE", sessionFile, launcher });
    assert.deepEqual(result, { ok: false, reason: "timed-out" });
    await assert.rejects(access(sessionFile));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
