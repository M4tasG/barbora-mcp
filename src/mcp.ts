import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { callTool, toolDescriptions, type ToolContext, type ToolName } from "./tools.ts";

const country = z.enum(["LT", "EE", "LV"]).optional();
const unitBounds = {
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
};

const inputSchemas: Record<ToolName, z.ZodType> = {
  password_sign_in: z.strictObject({
    email: z.string(),
    country,
  }),
  browser_sign_in: z.object({ country }),
  session_status: z.object({}),
  search: z.object({ query: z.string(), country }),
  product: z.object({ slug: z.string(), country }),
  cart_read: z.object({}),
  cart_add: z.object({ productId: z.string(), quantity: z.number(), ...unitBounds }),
  cart_update: z.object({ productId: z.string(), quantity: z.number(), ...unitBounds }),
  cart_remove: z.object({ productId: z.string() }),
  cart_clear: z.object({}),
  list_slots: z.object({}),
  reserve_slot: z.object({
    dayId: z.string(),
    timeslotId: z.string(),
  }),
  checkout_preview: z.object({}),
  place_order: z.strictObject({
    total: z.number(),
    address: z.string(),
    slot: z.string(),
    lines: z.array(z.object({ id: z.string(), quantity: z.number() })),
  }),
};

export function createBarboraServer(context: ToolContext): McpServer {
  const server = new McpServer({ name: "barbora", version: "0.1.0" });
  for (const name of Object.keys(toolDescriptions) as ToolName[]) {
    server.registerTool(name, { description: toolDescriptions[name], inputSchema: inputSchemas[name] }, async (args) => {
      const result = await callTool(name, args as Record<string, unknown>, context);
      return { content: [{ type: "text" as const, text: result.text }], isError: result.isError };
    });
  }
  return server;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const sessionFile = path.join(homedir(), ".config", "barbora", "session.json");
  const server = createBarboraServer({ sessionFile });
  await server.connect(new StdioServerTransport());
}
