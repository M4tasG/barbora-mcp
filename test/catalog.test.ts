import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { readProduct, searchCatalog } from "../src/catalog.ts";

const MILK_UNIT = { type: "units", min: 1, max: 10, step: 1, initialValue: 1 };
const BREAD_UNIT = { type: "units", min: 1, max: 5, step: 1, initialValue: 1 };

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

test("search returns priced products and leaves out UAT titles", async () => {
  let target = "";
  let cookie = "";
  let url = "";
  const server = createServer((req, res) => {
    target = req.headers["x-target"]?.toString() ?? "";
    cookie = req.headers.cookie?.toString() ?? "";
    url = req.url ?? "";
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
            title: "ROKIŠKIO NAMINIS pienas, 2,5 % rieb., 1 l",
            url: "rokiskio-naminis-pienas-2-5-proc-rieb-1-l",
            price: 1.19,
            shopCode: "X500",
            unit: MILK_UNIT,
          },
        ],
        count: 2,
        source: "constructor",
      }),
    );
  });
  const port = await listen(server);
  try {
    const result = await searchCatalog({ query: "pienas", country: "LT", origin: `http://127.0.0.1:${port}` });
    assert.equal(url, "/proxy/api/v1/search/constructor/search?searchText=pienas&limit=8");
    assert.equal(target, "LT_MAIN_WEB");
    assert.equal(cookie, "");
    assert.deepEqual(result, {
      ok: true,
      products: [
        {
          id: "000000000001335200",
          title: "ROKIŠKIO NAMINIS pienas, 2,5 % rieb., 1 l",
          price: 1.19,
          unit: MILK_UNIT,
          slug: "rokiskio-naminis-pienas-2-5-proc-rieb-1-l",
        },
      ],
    });
  } finally {
    server.close();
  }
});

test("a product lookup returns the shop description and price", async () => {
  let target = "";
  let url = "";
  const server = createServer((req, res) => {
    target = req.headers["x-target"]?.toString() ?? "";
    url = req.url ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "000000000000783998",
        title: "Juoda ruginė raikyta MOČIUTĖS AUTENTIŠKA duona, 450 g",
        url: "juoda-rugine-raikyta-mociutes-duona-450-g",
        price: 1.59,
        description: "Laiko patikrinta duona.",
        unit: BREAD_UNIT,
      }),
    );
  });
  const port = await listen(server);
  try {
    const result = await readProduct({
      slug: "juoda-rugine-raikyta-mociutes-duona-450-g",
      country: "EE",
      origin: `http://127.0.0.1:${port}`,
    });
    assert.equal(url, "/proxy/api/v1/product/by-url/juoda-rugine-raikyta-mociutes-duona-450-g");
    assert.equal(target, "EE_MAIN_WEB");
    assert.deepEqual(result, {
      ok: true,
      product: {
        id: "000000000000783998",
        title: "Juoda ruginė raikyta MOČIUTĖS AUTENTIŠKA duona, 450 g",
        price: 1.59,
        unit: BREAD_UNIT,
        slug: "juoda-rugine-raikyta-mociutes-duona-450-g",
        description: "Laiko patikrinta duona.",
      },
    });
  } finally {
    server.close();
  }
});

test("search does not call a foreign shop address", async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end("{}");
  });
  const port = await listen(server);
  try {
    const result = await searchCatalog({ query: "pienas", country: "LT", origin: "https://evil.example" });
    assert.deepEqual(result, { ok: false, reason: "rejected", status: 0 });
    assert.equal(calls, 0);
    assert.equal(port > 0, true);
  } finally {
    server.close();
  }
});
