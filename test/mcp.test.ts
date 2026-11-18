import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createBarboraServer } from "../src/mcp.ts";
import { loadSession } from "../src/password-sign-in.ts";
import { callTool, toolDescriptions } from "../src/tools.ts";

const PASSWORD = "s3cret-password";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

test("the server exposes sign-in, search, and cart tools", () => {
  const server = createBarboraServer({ sessionFile: "/tmp/barbora-mcp-unused.json" });
  const registered = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
  assert.deepEqual(Object.keys(registered).sort(), Object.keys(toolDescriptions).sort());
});

test("password sign-in rejects a password argument and does not call the shop", async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end("{}");
  });
  const port = await listen(server);
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-mcp-"));
  const sessionFile = path.join(dir, "session.json");
  let prompted = false;
  try {
    const result = await callTool(
      "password_sign_in",
      { email: "shopper@example.com", password: PASSWORD, country: "LT" },
      {
        sessionFile,
        origin: `http://127.0.0.1:${port}`,
        promptPassword: async () => {
          prompted = true;
          return PASSWORD;
        },
      },
    );
    assert.equal(result.isError, true);
    assert.equal(result.text.includes(PASSWORD), false);
    assert.equal(result.text, "Do not pass the password. A local prompt will ask the shopper.");
    assert.equal(prompted, false);
    assert.equal(calls, 0);
    await assert.rejects(access(sessionFile));
    assert.equal(JSON.stringify(toolDescriptions).includes(PASSWORD), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("password sign-in uses the local prompt and keeps the password out of the session", async () => {
  let posted = "";
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      posted = Buffer.concat(chunks).toString("utf8");
      assert.equal(req.url, "/proxy/api/v1/auth/login");
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": ".BRBAUTH=shop-session; Path=/; HttpOnly",
      });
      res.end("{}");
    });
  });
  const port = await listen(server);
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-mcp-"));
  const sessionFile = path.join(dir, "session.json");
  try {
    const result = await callTool(
      "password_sign_in",
      { email: "shopper@example.com", country: "LT" },
      { sessionFile, origin: `http://127.0.0.1:${port}`, promptPassword: async () => PASSWORD },
    );
    assert.equal(result.isError, false);
    assert.equal(result.text.includes(PASSWORD), false);
    assert.equal(posted.includes(PASSWORD), true);
    const raw = await readFile(sessionFile, "utf8");
    assert.equal(raw.includes(PASSWORD), false);
    const session = await loadSession(sessionFile);
    assert.equal(session?.country, "LT");
    const status = await callTool("session_status", {}, { sessionFile });
    assert.equal(status.text, "Signed in to Barbora LT.");
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a cancelled password prompt does not call the shop", async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end("{}");
  });
  const port = await listen(server);
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-mcp-"));
  const sessionFile = path.join(dir, "session.json");
  try {
    const result = await callTool(
      "password_sign_in",
      { email: "shopper@example.com", country: "LT" },
      { sessionFile, origin: `http://127.0.0.1:${port}`, promptPassword: async () => null },
    );
    assert.equal(result.isError, true);
    assert.equal(result.text, "Sign-in was cancelled before the password was entered.");
    assert.equal(calls, 0);
    await assert.rejects(access(sessionFile));
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an empty password does not call the shop", async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end("{}");
  });
  const port = await listen(server);
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-mcp-"));
  const sessionFile = path.join(dir, "session.json");
  try {
    const result = await callTool(
      "password_sign_in",
      { email: "shopper@example.com" },
      { sessionFile, origin: `http://127.0.0.1:${port}`, promptPassword: async () => "" },
    );
    assert.equal(result.isError, true);
    assert.equal(result.text, "A password is required.");
    assert.equal(calls, 0);
    await assert.rejects(access(sessionFile));
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a cart tool tells the shopper to sign in and leaves the cart unchanged", async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end("{}");
  });
  const port = await listen(server);
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-mcp-"));
  try {
    const result = await callTool(
      "cart_read",
      {},
      { sessionFile: path.join(dir, "missing.json"), origin: `http://127.0.0.1:${port}` },
    );
    assert.equal(result.isError, true);
    assert.equal(result.text, "Sign in before using the cart.");
    assert.equal(calls, 0);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("search returns a priced product and leaves out UAT titles", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        inventories: [
          {
            id: "000000000000000001",
            title: "UAT pienas",
            url: "uat-pienas",
            price: 0.01,
            unit: { type: "units", min: 1, max: 1, step: 1, initialValue: 1 },
          },
          {
            id: "000000000001335200",
            title: "Pienas",
            url: "pienas",
            price: 1.19,
            unit: { type: "units", min: 1, max: 10, step: 1, initialValue: 1 },
          },
        ],
      }),
    );
  });
  const port = await listen(server);
  try {
    const result = await callTool(
      "search",
      { query: "pienas", country: "EE" },
      { sessionFile: "/tmp/unused-session.json", origin: `http://127.0.0.1:${port}` },
    );
    assert.equal(result.isError, false);
    assert.equal(result.text.includes("UAT"), false);
    assert.equal(result.text.includes("Pienas"), true);
    assert.equal(result.text.includes("1.19"), true);
    assert.equal(result.text.includes("000000000001335200"), true);
  } finally {
    server.close();
  }
});
