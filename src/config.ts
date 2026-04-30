import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  AssignmentStrategy,
  AgentDirective,
  AgentConcurrency,
  ContextPacket,
  RouteConfig,
  RunMode,
  SwarmCliOptions,
  SwarmSecret,
  SwarmSeverityFocus,
} from "./types.js";
import { parseCustomAgentDirective } from "./runner/agentDirectives.js";

const severityFocusSchema = z.enum([
  "console",
  "network",
  "visual",
  "accessibility",
  "performance",
]);

const fixtureFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const minimumFixtureSchema = z.object({
  description: z.string().min(1).optional(),
  rows: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        label: z.string().min(1),
        fields: z.record(z.string(), fixtureFieldValueSchema),
      }),
    )
    .default([]),
  relationships: z.array(z.string()).default([]),
  requiredCounts: z.record(z.string(), z.number()).optional(),
});

const telemetryExpectationsSchema = z.object({
  websocket: z.enum(["expected", "silent", "optional"]).optional(),
  network: z.enum(["expected", "silent", "optional"]).optional(),
  notes: z.array(z.string()).default([]),
});

const routeScenarioSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  path: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("/") || URL.canParse(value), {
      message: "Route path must start with / or be an absolute URL.",
    }),
  goal: z.string().min(1),
  hints: z.array(z.string()).default([]),
  severityFocus: z.array(severityFocusSchema).default(["console", "network", "visual"]),
  seedRequirements: z.array(z.string()).default([]),
  baselineAssertions: z.array(z.string()).default([]),
  passCriteria: z.array(z.string()).default([]),
  expectedOutOfScope: z.array(z.string()).default([]),
  telemetryExpectations: telemetryExpectationsSchema.optional(),
  minimumFixture: minimumFixtureSchema.optional(),
});

const agentDirectiveSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  instructions: z.string().min(1),
  allowDestructiveActions: z.boolean().default(false),
});

const routeConfigSchema = z.object({
  appName: z.string().min(1).default("Browser App"),
  baseUrl: z.string().url().optional(),
  routes: z.array(routeScenarioSchema).min(1),
  agentDirectives: z.array(agentDirectiveSchema).optional(),
});

const bboxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const contextPacketTargetSchema = z.object({
  role: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  testId: z.string().min(1).optional(),
});

const contextPacketArtifactSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["screenshot", "console", "network", "trace", "report", "other"]).optional(),
  note: z.string().optional(),
});

const contextPacketSchema = z.object({
  version: z.literal("0.1"),
  route: z.string().min(1),
  intent: z.string().min(1).optional(),
  componentStack: z.array(z.string()).default([]),
  sourceFiles: z.array(z.string()).default([]),
  target: contextPacketTargetSchema.optional(),
  dom: z.string().optional(),
  accessibilitySnapshot: z.string().optional(),
  nearbyText: z.array(z.string()).default([]),
  bbox: bboxSchema.optional(),
  screenshotPath: z.string().optional(),
  relatedArtifacts: z.array(contextPacketArtifactSchema).default([]),
  preconditions: z.array(z.string()).default([]),
  observations: z.array(z.string()).default([]),
  debugHints: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

const runModeSchema = z.enum(["cursor-cli", "copilot-cli", "custom-cli"]);

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
  if (config.agentDirectives) {
    result.agentDirectives = config.agentDirectives.map((directive) => ({
      id: directive.id,
      label: directive.label ?? directive.id,
      instructions: directive.instructions,
      allowDestructiveActions: directive.allowDestructiveActions,
    }));
  }
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

function defaultAgentCommand(mode: RunMode): string {
  switch (mode) {
    case "cursor-cli":
      return "agent";
    case "copilot-cli":
      return "copilot";
    case "custom-cli":
      return "agent";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function parseAgents(value: string): number {
  const agents = Number.parseInt(value, 10);
  if (!Number.isInteger(agents) || agents < 1 || agents > 1000) {
    throw new Error("--agents must be an integer between 1 and 1000.");
  }
  return agents;
}

export function parseAgentConcurrency(value: string, agents: number): AgentConcurrency {
  if (value.trim().toLowerCase() === "auto") {
    return "auto";
  }
  const concurrency = Number.parseInt(value, 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > agents) {
    throw new Error("--agent-concurrency must be auto or an integer between 1 and --agents.");
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

function parseCustomAgentDirectives(value: unknown): AgentDirective[] {
  if (!value) {
    return [];
  }
  const rawValues = Array.isArray(value) ? value : [value];
  return rawValues.map((item) => parseCustomAgentDirective(String(item)));
}

export function parseCliOptions(options: Record<string, unknown>): SwarmCliOptions {
  const mode = parseRunMode(String(options.mode ?? "cursor-cli"));
  const chromeMode = chromeModeSchema.parse(String(options.chromeMode ?? defaultChromeMode(mode)));
  const agents = parseAgents(String(options.agents ?? "4"));
  const maxRouteSteps = parseRouteSteps(String(options.maxRouteSteps ?? "12"));
  const agentConcurrency =
    typeof options.agentConcurrency === "number"
      ? parseAgentConcurrency(String(options.agentConcurrency), agents)
      : parseAgentConcurrency(String(options.agentConcurrency ?? "auto"), agents);
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
    assignmentStrategy: parseAssignmentStrategy(String(options.assignmentStrategy ?? "replicate")),
    agentDirectives: parseCustomAgentDirectives(options.agentDirective),
    mode,
    runId: options.runId ? String(options.runId) : undefined,
    outDir: options.outDir ? path.resolve(String(options.outDir)) : undefined,
    agentCommand: String(
      options.agentCommand ?? options.cursorCommand ?? defaultAgentCommand(mode),
    ),
    cursorCommand: options.cursorCommand ? String(options.cursorCommand) : undefined,
    model: options.model ? String(options.model) : undefined,
    chromeMode,
    axiPortBase: options.axiPortBase ? parseAxiPortBase(String(options.axiPortBase)) : undefined,
    maxRouteSteps,
    agentPersonas: options.agentPersonas ? String(options.agentPersonas) : undefined,
    contextPacketPath: options.contextPacket
      ? path.resolve(String(options.contextPacket))
      : undefined,
  };
}

export function defaultChromeMode(mode: RunMode): "playwright" | "devtools-mcp" | "axi" {
  switch (mode) {
    case "cursor-cli":
    case "copilot-cli":
    case "custom-cli":
      return "axi";
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
    agentDirectives: config.agentDirectives,
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
