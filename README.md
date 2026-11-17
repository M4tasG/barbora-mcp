# Barbora agent

Sign a shopper in to [Barbora](https://barbora.lt) and shop with their session. Built for agents such as Grok and Hermes.

The shopper signs in once, either by typing their email and password into a masked prompt, or by logging in inside a browser window the tool opens. The tool stores the session. It does not store the password. Paying still happens with the shopper.

Work is tracked as GitHub issues. The glossary is in `CONTEXT.md`.

## Sign in

Password sign-in asks for a masked password and stores the session at `~/.config/barbora/session.json`. The password is not stored.

```bash
node --experimental-strip-types src/cli.ts login --email you@example.com --country LT
```

`LT`, `EE`, and `LV` are the three shops. `--password-stdin` reads the password from stdin instead of a prompt.

Browser sign-in opens the shop's own login page in Chrome. Google, Facebook, and Apple work there. It needs Playwright and Chrome:

```bash
npm install playwright
node --experimental-strip-types src/cli.ts login --browser --country LT
```

## Catalog

Search the catalog with no session. Titles that start with `UAT` are left out.

```bash
node --experimental-strip-types src/cli.ts search --query pienas --country LT
node --experimental-strip-types src/cli.ts product --slug juoda-rugine-raikyta-mociutes-duona-450-g --country LT
```

## Cart

The cart uses the saved session. Totals are the totals the shop returned.

```bash
node --experimental-strip-types src/cli.ts cart
node --experimental-strip-types src/cli.ts cart add --id 000000000001335200 --quantity 1 --min 1 --max 10 --step 1
node --experimental-strip-types src/cli.ts cart set --id 000000000001335200 --quantity 2 --min 1 --max 10 --step 1
node --experimental-strip-types src/cli.ts cart remove --id 000000000001335200
```

## Checkout

`checkout` shows the lines, address, slot, and the total the shop calculated. It does not place an order. A missing slot is called out for the shopper to choose.

`checkout slots` lists the open hours. `checkout slot` reserves the hour the shopper names. Reserving a slot does not place an order. Delivery can change the total, so read `checkout` again after a reservation.

`checkout place` places the order when `--total`, `--address`, and `--slot` match that checkout. A bank or card step is printed for the shopper to finish.

```bash
node --experimental-strip-types src/cli.ts checkout
node --experimental-strip-types src/cli.ts checkout slots
node --experimental-strip-types src/cli.ts checkout slot --day 2026-11-04 --id <hour-id>
node --experimental-strip-types src/cli.ts checkout place --total 9.99 --address "Gedimino pr. 1-5, Vilnius" --slot "2026-11-04T08:00:00"
```

## MCP

An agent on this machine can call the same sign-in, search, cart, slot, checkout preview, and place-order actions. The password is a tool argument for that call and is not stored. Placing an order needs a confirm of the latest total, address, and slot. A bank or card step is returned to the shopper.

```json
{
  "mcpServers": {
    "barbora": {
      "command": "node",
      "args": ["--experimental-strip-types", "src/mcp.ts"],
      "cwd": "/absolute/path/to/barbora-agent"
    }
  }
}
```

```bash
npm test
```

## Status

Password sign-in, browser sign-in, catalog search, the cart, the local MCP server, slot reservation, checkout preview, and placing an order after a matching confirm work. A bank or card step is handed back to the shopper. The shopping skill is `.agents/skills/barbora/SKILL.md`.
