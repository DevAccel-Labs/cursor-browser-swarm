import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { PlaywrightSession } from "./playwrightSession.js";

export const swarmMcpToolNames = [
  "observe_page",
  "click_text",
  "click_role",
  "type_into",
  "get_console_errors",
  "get_failed_requests",
  "take_screenshot",
  "save_trace",
] as const;

export type SwarmMcpToolName = (typeof swarmMcpToolNames)[number];

export const swarmMcpToolDefinitions: Tool[] = [
  {
    name: "observe_page",
    description: "Return page state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "click_text",
    description: "Click by visible text.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "click_role",
    description: "Click by ARIA role/name.",
    inputSchema: {
      type: "object",
      properties: { role: { type: "string" }, name: { type: "string" } },
      required: ["role", "name"],
    },
  },
  {
    name: "type_into",
    description: "Fill by label.",
    inputSchema: {
      type: "object",
      properties: { label: { type: "string" }, value: { type: "string" } },
      required: ["label", "value"],
    },
  },
  {
    name: "get_console_errors",
    description: "Return console errors.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_failed_requests",
    description: "Return failed requests.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "take_screenshot",
    description: "Save screenshot.",
    inputSchema: { type: "object", properties: { label: { type: "string" } }, required: ["label"] },
  },
  {
    name: "save_trace",
    description: "Save trace.",
    inputSchema: { type: "object", properties: {} },
  },
];

export interface ToolHandlers {
  observe_page: () => Promise<unknown>;
  click_text: (input: { text: string }) => Promise<unknown>;
  click_role: (input: { role: string; name: string }) => Promise<unknown>;
  type_into: (input: { label: string; value: string }) => Promise<unknown>;
  get_console_errors: () => Promise<unknown>;
  get_failed_requests: () => Promise<unknown>;
  take_screenshot: (input: { label: string }) => Promise<unknown>;
  save_trace: () => Promise<unknown>;
}

export function createToolHandlers(session: PlaywrightSession): ToolHandlers {
  return {
    observe_page: () => session.observe(),
    click_text: (input) => session.clickText(input.text),
    click_role: (input) =>
      session.clickRole(input.role as Parameters<PlaywrightSession["clickRole"]>[0], input.name),
    type_into: (input) => session.typeInto(input.label, input.value),
    get_console_errors: () => Promise.resolve(session.getConsoleErrors()),
    get_failed_requests: () => Promise.resolve(session.getFailedRequests()),
    take_screenshot: (input) => session.screenshot(input.label),
    save_trace: () => session.saveTrace(),
  };
}
