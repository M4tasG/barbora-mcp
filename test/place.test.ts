import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { formatPlace, placeOrder } from "../src/place.ts";
import { callTool } from "../src/tools.ts";

const ADDRESS = "Gedimino pr. 1-5, Vilnius";
const SLOT = "Tue 10:00-12:00";
const LINES = [{ id: "000000000001335200", quantity: 1 }];
const accept = async () => true;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function fixtureSession(): Promise<{ dir: string; sessionFile: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-place-"));
  const sessionFile = path.join(dir, "session.json");
  await writeFile(
    sessionFile,
    JSON.stringify({
      country: "LT",
      createdAt: "2026-11-03T00:00:00.000Z",
      cookies: [{ name: ".BRBAUTH", value: "shop-session", domain: "127.0.0.1", path: "/" }],
    }),
  );
  return { dir, sessionFile };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

test("a confirm that does not match the checkout does not place the order", async () => {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    await readBody(req);
    writeCheckout(req, res);
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await placeOrder({
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
      confirm: { total: 1, address: ADDRESS, slot: SLOT, lines: LINES },
      accept: async () => {
        throw new Error("prompt should not run");
      },
    });
    assert.deepEqual(result, { ok: false, reason: "mismatch" });
    assert.deepEqual(seen.sort(), [
      "GET /proxy/api/v1/address",
      "GET /proxy/api/v1/cart",
      "GET /proxy/api/v1/timeslot/summary",
    ]);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing slot does not place the order", async () => {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    await readBody(req);
    writeCheckout(req, res, { slot: null });
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await placeOrder({
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
      confirm: { total: 9.99, address: ADDRESS, slot: SLOT, lines: LINES },
      accept,
    });
    assert.deepEqual(result, { ok: false, reason: "incomplete" });
    assert.equal(seen.some((call) => call.includes("submit") || call.includes("payments")), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a matching confirm returns the payment step and does not follow it", async () => {
  const seen: string[] = [];
  const bodies: string[] = [];
  let port = 0;
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push(`${req.method} ${req.url}`);
    if (req.method === "POST" && req.url === "/proxy/api/v1/cart/submit") {
      bodies.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ url: `http://127.0.0.1:${port}/payments/adyen/initiate` }));
      return;
    }
    writeCheckout(req, res);
  });
  port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  const paymentUrl = `http://127.0.0.1:${port}/payments/adyen/initiate`;
  try {
    const result = await placeOrder({
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
      confirm: { total: 9.99, address: ADDRESS, slot: SLOT, lines: LINES },
      accept,
    });
    assert.deepEqual(result, { ok: false, reason: "payment", url: paymentUrl });
    assert.deepEqual(bodies, ["{}"]);
    assert.deepEqual(seen, [
      "GET /proxy/api/v1/cart",
      "GET /proxy/api/v1/timeslot/summary",
      "GET /proxy/api/v1/address",
      "POST /proxy/api/v1/cart/submit",
    ]);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a matching confirm reports the order id and does not call the order paid", async () => {
  const server = createServer(async (req, res) => {
    await readBody(req);
    if (req.method === "POST" && req.url === "/proxy/api/v1/cart/submit") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ orderId: "B-100" }));
      return;
    }
    writeCheckout(req, res);
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await placeOrder({
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
      confirm: { total: 9.99, address: ADDRESS, slot: SLOT, lines: LINES },
      accept,
    });
    assert.deepEqual(result, { ok: true, orderId: "B-100" });
    const text = formatPlace(result);
    assert.equal(text, "The shop accepted the order.\nB-100");
    assert.equal(text.toLowerCase().includes("paid"), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a bank redirect is returned to the shopper and is not followed", async () => {
  const seen: string[] = [];
  let port = 0;
  const server = createServer(async (req, res) => {
    await readBody(req);
    seen.push(`${req.method} ${req.url}`);
    if (req.method === "POST" && req.url === "/proxy/api/v1/cart/submit") {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/payments/everypay/initiate` });
      res.end();
      return;
    }
    writeCheckout(req, res);
  });
  port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await placeOrder({
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
      confirm: { total: 9.99, address: ADDRESS, slot: SLOT, lines: LINES },
      accept,
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "payment",
      url: `http://127.0.0.1:${port}/payments/everypay/initiate`,
    });
    assert.equal(seen.some((call) => call.includes("everypay")), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the place order tool returns the payment step and does not call the order paid", async () => {
  const seen: string[] = [];
  let port = 0;
  const server = createServer(async (req, res) => {
    await readBody(req);
    seen.push(`${req.method} ${req.url}`);
    if (req.method === "POST" && req.url === "/proxy/api/v1/cart/submit") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ payment: { redirectUrl: `http://127.0.0.1:${port}/payments/neopay/initiate` } }));
      return;
    }
    writeCheckout(req, res);
  });
  port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  const paymentUrl = `http://127.0.0.1:${port}/payments/neopay/initiate`;
  try {
    const result = await callTool(
      "place_order",
      { total: 9.99, address: ADDRESS, slot: SLOT, lines: LINES },
      { sessionFile, origin: `http://127.0.0.1:${port}`, confirmPlace: accept },
    );
    assert.equal(result.isError, true);
    assert.equal(result.text, `The shopper still has to finish this payment step.\n${paymentUrl}`);
    assert.equal(result.text.toLowerCase().includes("paid"), false);
    assert.equal(seen.some((call) => call.includes("neopay")), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an open age check does not place the order", async () => {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    await readBody(req);
    writeCheckout(req, res, { ageStatus: "requiresVerification" });
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await placeOrder({
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
      confirm: { total: 9.99, address: ADDRESS, slot: SLOT, lines: LINES },
      accept,
    });
    assert.deepEqual(result, { ok: false, reason: "incomplete" });
    assert.equal(seen.some((call) => call.includes("submit") || call.includes("payments")), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the same total with different lines does not place the order", async () => {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    await readBody(req);
    writeCheckout(req, res);
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await placeOrder({
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
      confirm: { total: 9.99, address: ADDRESS, slot: SLOT, lines: [{ id: "000000000001335200", quantity: 2 }] },
      accept: async () => {
        throw new Error("prompt should not run");
      },
    });
    assert.deepEqual(result, { ok: false, reason: "mismatch" });
    assert.equal(seen.some((call) => call.includes("submit")), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a cancelled prompt does not place the order", async () => {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    await readBody(req);
    writeCheckout(req, res);
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await placeOrder({
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
      confirm: { total: 9.99, address: ADDRESS, slot: SLOT, lines: LINES },
      accept: async (message) => {
        assert.equal(message.includes("000000000001335200"), true);
        assert.equal(message.includes("9.99"), true);
        assert.equal(message.includes(ADDRESS), true);
        assert.equal(message.includes(SLOT), true);
        return false;
      },
    });
    assert.deepEqual(result, { ok: false, reason: "cancelled" });
    assert.equal(formatPlace(result), "The shopper did not confirm. The order was not placed.");
    assert.equal(seen.some((call) => call.includes("submit")), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a tool argument cannot skip the place prompt", async () => {
  const seen: string[] = [];
  let prompted = false;
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    await readBody(req);
    writeCheckout(req, res);
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await callTool(
      "place_order",
      { total: 9.99, address: ADDRESS, slot: SLOT, lines: LINES, accepted: true },
      {
        sessionFile,
        origin: `http://127.0.0.1:${port}`,
        confirmPlace: async () => {
          prompted = true;
          return false;
        },
      },
    );
    assert.equal(prompted, true);
    assert.equal(result.isError, true);
    assert.equal(result.text, "The shopper did not confirm. The order was not placed.");
    assert.equal(seen.some((call) => call.includes("submit")), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

function writeCheckout(
  req: IncomingMessage,
  res: ServerResponse,
  options?: { ageStatus?: string; slot?: string | null; address?: string | null },
): void {
  res.writeHead(200, { "content-type": "application/json" });
  if (req.url === "/proxy/api/v1/cart") {
    res.end(
      JSON.stringify({
        items: [{ type: "Product", id: "000000000001335200", title: "Pienas", quantity: 1, price: 1.19, isAlcohol: false }],
        summary: { prices: { totalPrice: 9.99 } },
        ageRestriction: { status: options?.ageStatus ?? "clear", minimumAge: 0 },
      }),
    );
    return;
  }
  if (req.url === "/proxy/api/v1/timeslot/summary") {
    const slot = options && "slot" in options ? options.slot : SLOT;
    res.end(JSON.stringify({ selected: slot ? { deliveryTime: slot, price: 0 } : null }));
    return;
  }
  if (req.url === "/proxy/api/v1/address") {
    const address = options && "address" in options ? options.address : ADDRESS;
    const addresses = address ? [{ isSelectedForCart: true, addressWithFlat: address }] : [];
    res.end(JSON.stringify({ addresses }));
    return;
  }
  res.writeHead(500);
  res.end("{}");
}
