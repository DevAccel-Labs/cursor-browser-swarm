import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  AssignmentStrategy,
  ContextPacket,
  RouteConfig,
  RunMode,
  SwarmCliOptions,
  SwarmSecret,
  SwarmSeverityFocus,
} from "./types.js";

const severityFocusSchema = z.enum([
  "console",
  "network",
  "visual",
  "accessibility",
  "performance",
]);

const routeScenarioSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("/") || URL.canParse(value), {
      message: "Route path must start with / or be an absolute URL.",
    }),
  goal: z.string().min(1),
  hints: z.array(z.string()).default([]),
  severityFocus: z.array(severityFocusSchema).default(["console", "network", "visual"]),
});

const routeConfigSchema = z.object({
  appName: z.string().min(1).default("Browser App"),
  baseUrl: z.string().url().optional(),
  routes: z.array(routeScenarioSchema).min(1),
});

const bboxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const contextPacketSchema = z.object({
  version: z.string().min(1),
  route: z.string().min(1),
  componentStack: z.array(z.string()).default([]),
  sourceFiles: z.array(z.string()).default([]),
  dom: z.string().optional(),
  bbox: bboxSchema.optional(),
  screenshotPath: z.string().optional(),
  notes: z.string().optional(),
});

const runModeSchema = z.enum(["dry-run", "cursor-cli", "cursor-sdk", "cloud-api"]);

const chromeModeSchema = z.enum(["playwright", "devtools-mcp", "axi"]);

const assignmentStrategySchema = z.enum(["split", "replicate"]);

export async function loadRouteConfig(routePath: string): Promise<RouteConfig> {
  const raw = await readFile(routePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const config = routeConfigSchema.parse(parsed);
  const result: RouteConfig = {
    appName: config.appName,
    routes: config.routes.map((route) => ({
      ...route,
      severityFocus: route.severityFocus as SwarmSeverityFocus[],
    })),
  };
  if (config.baseUrl) {
    result.baseUrl = config.baseUrl;
  }
  return result;
}

export async function loadContextPacket(packetPath: string): Promise<ContextPacket> {
  const raw = await readFile(packetPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return contextPacketSchema.parse(parsed) as ContextPacket;
}

export function parseRunMode(value: string): RunMode {
  return runModeSchema.parse(value);
}

export function parseAgents(value: string): number {
  const agents = Number.parseInt(value, 10);
  if (!Number.isInteger(agents) || agents < 1 || agents > 1000) {
    throw new Error("--agents must be an integer between 1 and 1000.");
  }
  return agents;
}

export function parseAgentConcurrency(value: string, agents: number): number {
  const concurrency = Number.parseInt(value, 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > agents) {
    throw new Error("--agent-concurrency must be an integer between 1 and --agents.");
  }
  return concurrency;
}

export function parseAxiPortBase(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1024 || port > 64535) {
    throw new Error("--axi-port-base must be an integer between 1024 and 64535.");
  }
  return port;
}

export function parseRouteSteps(value: string): number {
  const steps = Number.parseInt(value, 10);
  if (!Number.isInteger(steps) || steps < 1 || steps > 100) {
    throw new Error("--max-route-steps must be an integer between 1 and 100.");
  }
  return steps;
}

export function parseAssignmentStrategy(value: string): AssignmentStrategy {
  return assignmentStrategySchema.parse(value);
}

export function parseSecret(value: string): SwarmSecret {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error(`Invalid secret "${value}". Expected KEY=VALUE.`);
  }

  const key = value.slice(0, separatorIndex).trim();
  const secretValue = value.slice(separatorIndex + 1);
  if (!/^[A-Z0-9_]+$/i.test(key)) {
    throw new Error(`Invalid secret key "${key}". Use letters, numbers, and underscores only.`);
  }

  return { key, value: secretValue };
}

export function parseCliOptions(options: Record<string, unknown>): SwarmCliOptions {
  const mode = parseRunMode(String(options.mode ?? "dry-run"));
  const chromeMode = chromeModeSchema.parse(String(options.chromeMode ?? defaultChromeMode(mode)));
  const agents = parseAgents(String(options.agents ?? "4"));
  const maxRouteSteps = parseRouteSteps(String(options.maxRouteSteps ?? "12"));
  const agentConcurrency =
    typeof options.agentConcurrency === "number"
      ? parseAgentConcurrency(String(options.agentConcurrency), agents)
      : parseAgentConcurrency(String(options.agentConcurrency ?? String(agents)), agents);
  const rawSecret = options.secret;
  const secretValues = Array.isArray(rawSecret)
    ? rawSecret.map((value) => parseSecret(String(value)))
    : rawSecret
      ? [parseSecret(String(rawSecret))]
      : [];
  const repo = path.resolve(String(options.repo ?? "."));
  const routes = options.routes
    ? path.resolve(String(options.routes))
    : path.join(repo, "swarm.routes.json");

  if (options.dev && options.noDevServer) {
    throw new Error("Use either --dev or --no-dev-server, not both.");
  }

  return {
    repo,
    devCommand: options.dev ? String(options.dev) : undefined,
    noDevServer: Boolean(options.noDevServer),
    baseUrl: String(options.baseUrl ?? ""),
    routesPath: routes,
    instructionsPath: options.instructions ? path.resolve(String(options.instructions)) : undefined,
    secrets: secretValues,
    secretEnv: {},
    secretsEnvPrefix: String(options.secretsEnvPrefix ?? "SWARM_SECRET_"),
    interactiveSecrets: Boolean(options.interactiveSecrets),
    agents,
    agentConcurrency,
    assignmentStrategy: parseAssignmentStrategy(String(options.assignmentStrategy ?? "split")),
    mode,
    runId: options.runId ? String(options.runId) : undefined,
    outDir: options.outDir ? path.resolve(String(options.outDir)) : undefined,
    cursorCommand: String(options.cursorCommand ?? "agent"),
    model: options.model ? String(options.model) : undefined,
    chromeMode,
    axiPortBase: options.axiPortBase ? parseAxiPortBase(String(options.axiPortBase)) : undefined,
    maxRouteSteps,
    contextPacketPath: options.contextPacket
      ? path.resolve(String(options.contextPacket))
      : undefined,
  };
}

export function defaultChromeMode(mode: RunMode): "playwright" | "devtools-mcp" | "axi" {
  switch (mode) {
    case "dry-run":
      return "playwright";
    case "cursor-cli":
      return "axi";
    case "cursor-sdk":
    case "cloud-api":
      return "playwright";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function mergeBaseUrl(config: RouteConfig, cliBaseUrl: string): RouteConfig {
  const baseUrl = cliBaseUrl || config.baseUrl;
  if (!baseUrl) {
    throw new Error("--base-url is required when routes config does not include baseUrl.");
  }

  return {
    ...config,
    baseUrl,
    routes: config.routes.map((route) => ({
      ...route,
      hints: route.hints ?? [],
      severityFocus: (route.severityFocus ?? [
        "console",
        "network",
        "visual",
      ]) as SwarmSeverityFocus[],
    })),
  };
}

export async function readOptionalText(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }

  return readFile(filePath, "utf8");
}

export const schemas = {
  routeConfigSchema,
  contextPacketSchema,
};
