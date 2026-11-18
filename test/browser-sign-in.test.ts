import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { signInWithBrowser, type BrowserLauncher } from "../src/browser-sign-in.ts";
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
