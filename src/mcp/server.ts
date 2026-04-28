#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PlaywrightSession } from "./playwrightSession.js";
import { createToolHandlers, swarmMcpToolDefinitions, type SwarmMcpToolName } from "./tools.js";

const tools = swarmMcpToolDefinitions;

async function main(): Promise<void> {
  const artifactDir = process.env.SWARM_ARTIFACT_DIR ?? ".swarm/mcp";
  const session = new PlaywrightSession(
    process.env.SWARM_BASE_URL ?? "http://localhost:3000",
    artifactDir,
  );
  const handlers = createToolHandlers(session);
  const server = new Server(
    { name: "cursor-browser-swarm", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name as SwarmMcpToolName;
    const handler = handlers[toolName];
    if (!handler) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const result = await handler(args as never);
    return {
      content: [
        {
          type: "text",
          text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  await server.connect(new StdioServerTransport());
}

await main();
