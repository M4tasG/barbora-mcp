import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { allowedShopUrl, loadSession, signInWithPassword } from "../src/password-sign-in.ts";

const PASSWORD = "s3cret-password";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

test("password sign-in saves the shop session and leaves the password out", async () => {
  let body = "";
  let target = "";
  const server = createServer((req, res) => {
    target = req.headers["x-target"]?.toString() ?? "";
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      body = Buffer.concat(chunks).toString("utf8");
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/proxy/api/v1/auth/login");
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": ".BRBAUTH=shop-session; Path=/; HttpOnly",
      });
      res.end("{}");
    });
  });
  const port = await listen(server);
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-session-"));
  const sessionFile = path.join(dir, "session.json");
  try {
    const result = await signInWithPassword({
      email: "shopper@example.com",
      password: PASSWORD,
      country: "LT",
      rememberMe: true,
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
    });
    assert.deepEqual(JSON.parse(body), {
      email: "shopper@example.com",
      password: PASSWORD,
      rememberMe: true,
    });
    assert.equal(target, "LT_MAIN_WEB");
    assert.equal(result.ok, true);
    const raw = await readFile(sessionFile, "utf8");
    assert.equal(raw.includes(PASSWORD), false);
    const mode = (await stat(sessionFile)).mode & 0o777;
    assert.equal(mode, 0o600);
    const session = await loadSession(sessionFile);
    assert.equal(session?.country, "LT");
    assert.deepEqual(session?.cookies, [
      { name: ".BRBAUTH", value: "shop-session", domain: "127.0.0.1", path: "/" },
    ]);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a rejected password does not write a session", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "invalidCredentials" }));
  });
  const port = await listen(server);
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-session-"));
  const sessionFile = path.join(dir, "session.json");
  try {
    const result = await signInWithPassword({
      email: "shopper@example.com",
      password: PASSWORD,
      country: "EE",
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
    });
    assert.deepEqual(result, { ok: false, reason: "invalid-credentials", status: 400 });
    await assert.rejects(access(sessionFile));
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a foreign shop address is not contacted and stores nothing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-session-"));
  const sessionFile = path.join(dir, "session.json");
  try {
    assert.equal(allowedShopUrl("https://barbora.lt")?.hostname, "barbora.lt");
    assert.equal(allowedShopUrl("http://barbora.lt"), undefined);
    assert.equal(allowedShopUrl("https://barbora.lt@evil.example"), undefined);
    assert.equal(allowedShopUrl("https://evil.barbora.lt"), undefined);
    const result = await signInWithPassword({
      email: "shopper@example.com",
      password: PASSWORD,
      country: "LT",
      sessionFile,
      origin: "https://barbora.lt@evil.example",
    });
    assert.deepEqual(result, { ok: false, reason: "rejected", status: 0 });
    await assert.rejects(access(sessionFile));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a cookie for another domain is not stored", async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls += 1;
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": ".BRBAUTH=shop-session; Domain=lt; Path=/",
      });
      res.end("{}");
    });
  });
  const port = await listen(server);
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-session-"));
  const sessionFile = path.join(dir, "session.json");
  try {
    const result = await signInWithPassword({
      email: "shopper@example.com",
      password: PASSWORD,
      country: "LT",
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
    await assert.rejects(access(sessionFile));
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
