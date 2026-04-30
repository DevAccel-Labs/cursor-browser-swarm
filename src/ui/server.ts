import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { execa } from "execa";
import {
  defaultChromeMode,
  parseAgentConcurrency,
  parseAgents,
  parseAxiPortBase,
  parseRouteSteps,
} from "../config.js";
import { loadEnvFile } from "../env.js";
import { defaultAgentDirectives, parseCustomAgentDirective } from "../runner/agentDirectives.js";
import { defaultOutDir, runSwarmWithSignal } from "../runner/runSwarm.js";
import type {
  AssignmentStrategy,
  ChromeMode,
  RouteConfig,
  RunMode,
  SwarmCliOptions,
  SwarmSecret,
  SwarmSeverityFocus,
} from "../types.js";

interface UiServerOptions {
  host: string;
  port: number;
}

interface StartedUiServer {
  url: string;
  close: () => Promise<void>;
}

interface UiRouteInput {
  path: string;
  goal: string;
  hints?: string[] | undefined;
  severityFocus?: SwarmSeverityFocus[] | undefined;
}

interface UiSecretInput {
  key: string;
  value: string;
}

interface UiRunRequest {
  appName: string;
  baseUrl: string;
  routes: UiRouteInput[];
  instructions?: string | undefined;
  secrets?: UiSecretInput[] | undefined;
  secretsEnvPrefix?: string | undefined;
  agents?: number | string | undefined;
  agentConcurrency?: number | string | undefined;
  agentPersonas?: string | undefined;
  agentDirectives?: string | undefined;
  mode?: string | undefined;
  chromeMode?: string | undefined;
  model?: string | undefined;
  agentCommand?: string | undefined;
  noDevServer?: boolean | undefined;
  devCommand?: string | undefined;
  cursorCommand?: string | undefined;
  maxRouteSteps?: number | string | undefined;
  assignmentStrategy?: string | undefined;
  axiPortBase?: number | string | undefined;
}

interface UiRunState {
  id: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  endedAt?: string | undefined;
  baseUrl: string;
  outDir: string;
  routesPath: string;
  eventsPath: string;
  instructionsPath?: string | undefined;
  envPath?: string | undefined;
  finalReportPath?: string | undefined;
  metricsPath?: string | undefined;
  benchmarkJsonPath?: string | undefined;
  benchmarkCsvPath?: string | undefined;
  error?: string | undefined;
  controller?: AbortController | undefined;
}

interface UiRunListItem {
  id: string;
  status: UiRunState["status"] | "unknown";
  startedAt?: string | undefined;
  endedAt?: string | undefined;
  appName?: string | undefined;
  baseUrl?: string | undefined;
  outDir: string;
  agents?: number | undefined;
  issuesFound?: number | undefined;
}

const uiRuns = new Map<string, UiRunState>();
const runsRoot = path.join(homedir(), ".cursor-browser-swarm", "runs");

const cursorFallbackModels = [
  { id: "auto", name: "Auto" },
  { id: "composer-2-fast", name: "Composer 2 Fast" },
  { id: "composer-2", name: "Composer 2" },
  { id: "composer-1.5", name: "Composer 1.5" },
  { id: "gpt-5.3-codex", name: "Codex 5.3" },
  { id: "gpt-5.3-codex-high", name: "Codex 5.3 High" },
  { id: "gpt-5.2", name: "GPT-5.2" },
];

const copilotFallbackModels = [
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
  { id: "auto", name: "Auto" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
  { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
  { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
  { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { id: "gpt-4.1", name: "GPT-4.1" },
  { id: "gpt-5-mini", name: "GPT-5 mini" },
  { id: "gpt-5.2", name: "GPT-5.2" },
  { id: "gpt-5.2-codex", name: "GPT-5.2-Codex" },
  { id: "gpt-5.3-codex", name: "GPT-5.3-Codex" },
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 mini" },
  { id: "gpt-5.5", name: "GPT-5.5" },
];

const genericFallbackModels = [{ id: "auto", name: "Auto" }];

function fallbackModelsForMode(mode: string): { id: string; name: string }[] {
  switch (mode) {
    case "cursor-cli":
      return cursorFallbackModels;
    case "copilot-cli":
      return copilotFallbackModels;
    case "custom-cli":
    default:
      return genericFallbackModels;
  }
}

function makeRunId(now = new Date()): string {
  return `ui-${now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")}`;
}

/** Milliseconds from IDs produced by {@link makeRunId} (`ui-YYYYMMDDTHHmmss`). */
function timestampFromUiStyleRunId(id: string): number | undefined {
  const match = /^ui-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(id);
  if (!match) {
    return undefined;
  }
  const [, y, mo, d, h, mi, s] = match;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isFinite(ms) ? ms : undefined;
}

/** Chronological ordering for sidebar: prefer summary `startedAt`, else parse `ui-*` run id — not string compares (ISO vs ui-* sorts wrong). */
function runListSortTimeMs(run: { id: string; startedAt?: string | undefined }): number {
  if (run.startedAt) {
    const fromIso = Date.parse(run.startedAt);
    if (!Number.isNaN(fromIso)) {
      return fromIso;
    }
  }
  return timestampFromUiStyleRunId(run.id) ?? 0;
}

function parseChromeMode(value: string | undefined, mode: RunMode): ChromeMode {
  const raw = value ?? defaultChromeMode(mode);
  switch (raw) {
    case "playwright":
    case "devtools-mcp":
    case "axi":
      return raw;
    default:
      throw new Error("--chrome-mode must be playwright, devtools-mcp, or axi.");
  }
}

function parseUiRunMode(value: string | undefined): RunMode {
  const mode = value ?? "cursor-cli";
  switch (mode) {
    case "cursor-cli":
    case "copilot-cli":
    case "custom-cli":
      return mode;
    default:
      throw new Error("UI mode must be cursor-cli, copilot-cli, or custom-cli.");
  }
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

function toStringArray(value: string[] | undefined): string[] {
  return value?.map((item) => item.trim()).filter(Boolean) ?? [];
}

function cleanRoutes(routes: UiRouteInput[]): RouteConfig["routes"] {
  return routes.map((route) => ({
    path: route.path.trim(),
    goal: route.goal.trim(),
    hints: toStringArray(route.hints),
    severityFocus: route.severityFocus?.length
      ? route.severityFocus
      : (["console", "network", "visual"] satisfies SwarmSeverityFocus[]),
  }));
}

function cleanSecrets(secrets: UiSecretInput[] | undefined): SwarmSecret[] {
  return (
    secrets
      ?.map((secret) => ({ key: secret.key.trim(), value: secret.value }))
      .filter((secret) => secret.key && secret.value) ?? []
  );
}

function parseUiAgentDirectives(value: string | undefined) {
  const text = textOrUndefined(value);
  if (!text) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseCustomAgentDirective(line));
}

function textOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseAssignmentStrategyInput(value: string | undefined): AssignmentStrategy {
  const strategy = value ?? "replicate";
  switch (strategy) {
    case "split":
    case "replicate":
      return strategy;
    default:
      throw new Error("--assignment-strategy must be split or replicate.");
  }
}

function parseModelOutput(output: string): { id: string; name: string }[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = /^([a-zA-Z0-9_.-]+)\s+-\s+(.+)$/.exec(line);
      return match?.[1] && match[2] ? { id: match[1], name: match[2] } : undefined;
    })
    .filter((model): model is { id: string; name: string } => Boolean(model));
}

function chooseDefaultModel(models: { id: string; name: string }[]): string {
  return (
    models.find((model) => /\(default\)/i.test(model.name))?.id ??
    models[0]?.id ??
      "auto"
  );
}

async function listAgentModels(mode: string, agentCommand: string): Promise<{
  models: { id: string; name: string }[];
  source: "agent-cli" | "cursor-cli" | "fallback";
  error?: string | undefined;
}> {
  const fallbackModels = fallbackModelsForMode(mode);
  if (mode === "copilot-cli") {
    return {
      models: fallbackModels,
      source: "fallback",
      error: "Copilot CLI does not expose a model listing command; showing Copilot-safe defaults.",
    };
  }
  try {
    const result = await execa(agentCommand, ["--list-models"], {
      reject: false,
      timeout: 10_000,
      all: true,
    });
    const models = parseModelOutput(result.all ?? "");
    if (result.exitCode === 0 && models.length > 0) {
      return { models, source: "agent-cli" };
    }
    return {
      models: fallbackModels,
      source: "fallback",
      error: result.all || `${agentCommand} --list-models exited with code ${result.exitCode}.`,
    };
  } catch (error) {
    return {
      models: fallbackModels,
      source: "fallback",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  payload: string,
): void {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

function publicRunState(state: UiRunState): Omit<UiRunState, "controller"> {
  const { controller: _controller, ...publicState } = state;
  return publicState;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function pathsForRunDir(
  runDir: string,
): Pick<
  UiRunState,
  | "routesPath"
  | "eventsPath"
  | "instructionsPath"
  | "finalReportPath"
  | "metricsPath"
  | "benchmarkJsonPath"
  | "benchmarkCsvPath"
> {
  return {
    routesPath: path.join(runDir, "config", "swarm.routes.json"),
    eventsPath: path.join(runDir, "events.jsonl"),
    instructionsPath: path.join(runDir, "config", "swarm.instructions.md"),
    finalReportPath: path.join(runDir, "final-report.md"),
    metricsPath: path.join(runDir, "metrics.json"),
    benchmarkJsonPath: path.join(runDir, "benchmark.json"),
    benchmarkCsvPath: path.join(runDir, "benchmark.csv"),
  };
}

async function stateFromRunDir(runDir: string, runId: string): Promise<UiRunState | undefined> {
  const summary = await readJsonFile<{
    startedAt?: string;
    completedAt?: string;
    appName?: string;
    agentReports?: unknown[];
  }>(path.join(runDir, "summary.json"));
  const routeConfig = await readJsonFile<{ baseUrl?: string }>(
    path.join(runDir, "config", "swarm.routes.json"),
  );
  const finalReportExists = await fileExists(path.join(runDir, "final-report.md"));
  const eventsPath = path.join(runDir, "events.jsonl");
  const eventsExist = await fileExists(eventsPath);
  if (!summary && !eventsExist && !finalReportExists) {
    return undefined;
  }
  return {
    id: runId,
    status: finalReportExists ? "succeeded" : "failed",
    startedAt: summary?.startedAt ?? runId,
    ...(summary?.completedAt ? { endedAt: summary.completedAt } : {}),
    baseUrl: routeConfig?.baseUrl ?? "",
    outDir: runDir,
    ...pathsForRunDir(runDir),
  };
}

async function findRunOnDisk(runId: string): Promise<UiRunState | undefined> {
  try {
    const apps = await readdir(runsRoot, { withFileTypes: true });
    for (const app of apps) {
      if (!app.isDirectory()) {
        continue;
      }
      const runDir = path.join(runsRoot, app.name, runId);
      if (await fileExists(runDir)) {
        return stateFromRunDir(runDir, runId);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function getRunState(runId: string): Promise<UiRunState | undefined> {
  return uiRuns.get(runId) ?? findRunOnDisk(runId);
}

async function listDiskRuns(): Promise<UiRunListItem[]> {
  const items: UiRunListItem[] = [];
  try {
    const apps = await readdir(runsRoot, { withFileTypes: true });
    for (const app of apps) {
      if (!app.isDirectory()) {
        continue;
      }
      const appDir = path.join(runsRoot, app.name);
      const runs = await readdir(appDir, { withFileTypes: true });
      for (const run of runs) {
        if (!run.isDirectory()) {
          continue;
        }
        const runDir = path.join(appDir, run.name);
        const summary = await readJsonFile<{
          appName?: string;
          startedAt?: string;
          completedAt?: string;
          agents?: number;
          issuesFound?: number;
        }>(path.join(runDir, "summary.json"));
        const routeConfig = await readJsonFile<{ baseUrl?: string }>(
          path.join(runDir, "config", "swarm.routes.json"),
        );
        const finalReportExists = await fileExists(path.join(runDir, "final-report.md"));
        items.push({
          id: run.name,
          status: finalReportExists ? "succeeded" : "unknown",
          startedAt: summary?.startedAt,
          endedAt: summary?.completedAt,
          appName: summary?.appName ?? app.name,
          baseUrl: routeConfig?.baseUrl,
          outDir: runDir,
          agents: summary?.agents,
          issuesFound: summary?.issuesFound,
        });
      }
    }
  } catch {
    return items;
  }
  return items;
}

async function listRuns(): Promise<UiRunListItem[]> {
  const diskRuns = await listDiskRuns();
  const byId = new Map(diskRuns.map((run) => [run.id, run]));
  for (const state of uiRuns.values()) {
    byId.set(state.id, {
      id: state.id,
      status: state.status,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      baseUrl: state.baseUrl,
      outDir: state.outDir,
    });
  }
  return [...byId.values()].sort((left, right) => {
    const diff = runListSortTimeMs(right) - runListSortTimeMs(left);
    if (diff !== 0) {
      return diff;
    }
    return right.id.localeCompare(left.id);
  });
}

function isUiRunRequest(value: unknown): value is UiRunRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const input = value as Partial<UiRunRequest>;
  return (
    typeof input.appName === "string" &&
    typeof input.baseUrl === "string" &&
    Array.isArray(input.routes)
  );
}

async function createRunFromRequest(input: UiRunRequest): Promise<UiRunState> {
  const repo = process.cwd();
  const envPath = await loadEnvFile(repo);
  const mode = parseUiRunMode(input.mode);
  const chromeMode = parseChromeMode(input.chromeMode, mode);
  const assignmentStrategy = parseAssignmentStrategyInput(input.assignmentStrategy);
  const runId = makeRunId();
  const outDir = defaultOutDir(input.appName.trim() || "Browser App", runId);
  const uiDir = path.join(outDir, "config");
  const routesPath = path.join(uiDir, "swarm.routes.json");
  const instructions = textOrUndefined(input.instructions);
  const instructionsPath = instructions ? path.join(uiDir, "swarm.instructions.md") : undefined;
  const eventsPath = path.join(outDir, "events.jsonl");
  const noDevServer = input.noDevServer ?? true;
  const agents = parseAgents(String(input.agents ?? "4"));
  const agentPersonas = textOrUndefined(input.agentPersonas);
  const agentDirectives = parseUiAgentDirectives(input.agentDirectives);
  const agentConcurrency = parseAgentConcurrency(
    String(input.agentConcurrency ?? String(agents)),
    agents,
  );
  const axiPortBaseInput = textOrUndefined(
    input.axiPortBase === undefined ? undefined : String(input.axiPortBase),
  );
  const routeConfig: RouteConfig = {
    appName: input.appName.trim() || "Browser App",
    baseUrl: input.baseUrl.trim(),
    routes: cleanRoutes(input.routes),
  };
  if (agentDirectives.length > 0) {
    routeConfig.agentDirectives = agentDirectives;
  }

  await mkdir(uiDir, { recursive: true });
  await writeFile(routesPath, `${JSON.stringify(routeConfig, null, 2)}\n`);
  if (instructions && instructionsPath) {
    await writeFile(instructionsPath, `${instructions}\n`);
  }

  const cliOptions: SwarmCliOptions = {
    repo,
    noDevServer,
    baseUrl: input.baseUrl.trim(),
    routesPath,
    secrets: cleanSecrets(input.secrets),
    secretEnv: {},
    secretsEnvPrefix: textOrUndefined(input.secretsEnvPrefix) ?? "SWARM_SECRET_",
    interactiveSecrets: false,
    agents,
    agentConcurrency,
    assignmentStrategy,
    agentDirectives,
    mode,
    runId,
    outDir,
    agentCommand:
      textOrUndefined(input.agentCommand) ??
      textOrUndefined(input.cursorCommand) ??
      defaultAgentCommand(mode),
    cursorCommand: textOrUndefined(input.cursorCommand),
    chromeMode,
    ...(axiPortBaseInput ? { axiPortBase: parseAxiPortBase(axiPortBaseInput) } : {}),
    maxRouteSteps: parseRouteSteps(String(input.maxRouteSteps ?? "12")),
  };
  if (agentPersonas) {
    cliOptions.agentPersonas = agentPersonas;
  }
  const model = textOrUndefined(input.model);
  const devCommand = textOrUndefined(input.devCommand);
  if (instructionsPath) {
    cliOptions.instructionsPath = instructionsPath;
  }
  if (model) {
    cliOptions.model = model;
  }
  if (!noDevServer && devCommand) {
    cliOptions.devCommand = devCommand;
  }

  const controller = new AbortController();
  const state: UiRunState = {
    id: runId,
    status: "running",
    startedAt: new Date().toISOString(),
    baseUrl: input.baseUrl.trim(),
    outDir,
    routesPath,
    eventsPath,
    controller,
  };
  if (instructionsPath) {
    state.instructionsPath = instructionsPath;
  }
  if (envPath) {
    state.envPath = envPath;
  }
  uiRuns.set(runId, state);

  void runSwarmWithSignal(cliOptions, controller.signal)
    .then((result) => {
      if (controller.signal.aborted) {
        state.status = "cancelled";
        state.endedAt = new Date().toISOString();
        return;
      }
      state.status = "succeeded";
      state.endedAt = new Date().toISOString();
      state.finalReportPath = result.finalReportPath;
      state.metricsPath = result.metricsPath;
      state.benchmarkJsonPath = result.benchmarkJsonPath;
      state.benchmarkCsvPath = result.benchmarkCsvPath;
    })
    .catch((error: unknown) => {
      state.status = controller.signal.aborted ? "cancelled" : "failed";
      state.endedAt = new Date().toISOString();
      state.error = controller.signal.aborted
        ? "Run cancelled by user."
        : error instanceof Error
          ? error.message
          : String(error);
    });

  return state;
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/defaults") {
    const agentCommand =
      url.searchParams.get("agentCommand") ?? url.searchParams.get("cursorCommand") ?? "agent";
    const mode = url.searchParams.get("mode") ?? "cursor-cli";
    const modelResult = await listAgentModels(mode, agentCommand);
    sendJson(response, 200, {
      baseUrl: "http://localhost:3000",
      appName: "My App",
      agents: 4,
      agentConcurrency: "auto",
      assignmentStrategy: "replicate",
      agentPersonas: defaultAgentDirectives.map((directive) => directive.id).join(","),
      agentPersonaOptions: defaultAgentDirectives.map((directive) => ({
        id: directive.id,
        label: directive.label,
        instructions: directive.instructions,
        allowDestructiveActions: directive.allowDestructiveActions,
      })),
      agentDirectives: "",
      mode,
      chromeMode: "axi",
      model: chooseDefaultModel(modelResult.models),
      models: modelResult.models,
      modelSource: modelResult.source,
      modelError: modelResult.error,
      agentCommand,
      cursorCommand: agentCommand,
      maxRouteSteps: 12,
      axiPortBase: "",
      secretsEnvPrefix: "SWARM_SECRET_",
      debugEnabled: ["1", "true", "yes", "debug"].includes(
        (process.env.SWARM_DEBUG ?? process.env.CURSOR_BROWSER_SWARM_DEBUG ?? "").toLowerCase(),
      ),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/runs") {
    const body = await readRequestJson(request);
    if (!isUiRunRequest(body)) {
      sendJson(response, 400, { error: "Invalid run request." });
      return;
    }
    const state = await createRunFromRequest(body);
    sendJson(response, 202, publicRunState(state));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/runs") {
    sendJson(response, 200, { runs: await listRuns() });
    return;
  }

  if (url.pathname.startsWith("/api/runs/")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const runId = parts[2];
    const state = runId ? await getRunState(runId) : undefined;
    if (!state) {
      sendJson(response, 404, { error: "Run not found." });
      return;
    }
    if (request.method === "POST" && parts[3] === "cancel") {
      if (state.status !== "running") {
        sendJson(response, 409, { error: `Run is already ${state.status}.` });
        return;
      }
      state.status = "cancelled";
      state.endedAt = new Date().toISOString();
      state.error = "Run cancelled by user.";
      state.controller?.abort();
      sendJson(response, 202, publicRunState(state));
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    if (parts[3] === "report") {
      if (!state.finalReportPath) {
        sendJson(response, 404, { error: "Final report is not ready yet." });
        return;
      }
      sendText(
        response,
        200,
        "text/markdown; charset=utf-8",
        await readFile(state.finalReportPath, "utf8"),
      );
      return;
    }
    if (parts[3] === "events") {
      try {
        sendText(
          response,
          200,
          "application/x-ndjson; charset=utf-8",
          await readFile(state.eventsPath, "utf8"),
        );
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          sendText(response, 200, "application/x-ndjson; charset=utf-8", "");
          return;
        }
        throw error;
      }
      return;
    }
    sendJson(response, 200, publicRunState(state));
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

function createRequestHandler() {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const url = new URL(request.url ?? "/", "http://localhost");
    void (async () => {
      try {
        if (url.pathname.startsWith("/api/")) {
          await handleApiRequest(request, response, url);
          return;
        }
        if (url.pathname === "/app.js") {
          sendText(response, 200, "text/javascript; charset=utf-8", clientScript);
          return;
        }
        if (url.pathname === "/styles.css") {
          sendText(response, 200, "text/css; charset=utf-8", stylesheet);
          return;
        }
        sendText(response, 200, "text/html; charset=utf-8", html);
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  };
}

export async function startUiServer(options: UiServerOptions): Promise<StartedUiServer> {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("--port must be a valid TCP port.");
  }
  const server = createServer(createRequestHandler());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    url: `http://${options.host}:${options.port}`,
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cursor Browser Swarm</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main>
      <header>
        <div class="header-row">
          <div>
            <p class="eyebrow">Cursor Browser Swarm</p>
            <h1>Launch browser-validation agents</h1>
          </div>
          <div class="view-toggle">
            <button type="button" id="view-config" class="view-btn active">Config</button>
            <button type="button" id="view-activity" class="view-btn">Activity Log</button>
          </div>
        </div>
        <p class="lede">Point at a running app, describe the routes, choose the model, and let CLI-backed agents validate with AXI browser tooling.</p>
      </header>
      <div class="app-shell">
        <aside class="runs-sidebar">
          <div class="section-heading">
            <h2>Runs</h2>
            <button type="button" id="refreshRuns">Refresh</button>
          </div>
          <div id="runsList" class="runs-list">Loading runs...</div>
        </aside>
        <section class="workspace">
          <div id="activity-view" class="activity-view hidden">
            <div class="activity-controls">
              <label class="activity-filter"><input type="checkbox" id="filter-shell" checked /> Shell</label>
              <label class="activity-filter"><input type="checkbox" id="filter-read" checked /> Read</label>
              <label class="activity-filter"><input type="checkbox" id="filter-write" checked /> Write</label>
              <label class="activity-filter"><input type="checkbox" id="filter-other" checked /> Other</label>
              <button type="button" id="clear-activity" class="danger">Clear</button>
              <label class="activity-filter"><input type="checkbox" id="auto-scroll" checked /> Auto-scroll</label>
            </div>
            <div id="activity-log" class="activity-log"></div>
          </div>
          <div id="config-view">
          <form id="run-form">
        <section class="panel">
          <h2>Target</h2>
          <div class="row">
            <label>Base URL <input id="baseUrl" name="baseUrl" required /></label>
            <label>App name <input id="appName" name="appName" required /></label>
          </div>
        </section>
        <section class="panel">
          <div class="section-heading">
            <h2>Scenarios</h2>
            <button type="button" id="add-route">Add route</button>
          </div>
          <div id="routes"></div>
        </section>
        <section class="panel">
          <h2>Instructions</h2>
          <textarea id="instructions" rows="6">Use the test account credentials from env vars.
Avoid destructive actions like delete/archive/billing.
Focus on console errors, failed network requests, visual breakage, and repro steps.</textarea>
        </section>
        <section class="panel">
          <div class="section-heading">
            <h2>Credentials</h2>
            <button type="button" id="add-secret">Add secret</button>
          </div>
          <p class="muted">Values are passed to agent processes and redacted from captured output where feasible.</p>
          <div id="secrets"></div>
        </section>
        <section class="panel">
          <h2>Run controls</h2>
          <div class="grid">
            <label>Agents <input id="agents" type="number" min="1" max="1000" /></label>
            <label>Agent concurrency <input id="agentConcurrency" placeholder="auto or 1-1000" /></label>
            <label>Assignment
              <select id="assignmentStrategy">
                <option value="replicate">replicate routes per agent</option>
                <option value="split">split routes across agents</option>
              </select>
            </label>
            <div class="persona-field">
              <span class="field-label">Agent personas</span>
              <button type="button" id="agentPersonasToggle" class="persona-toggle">Select personas</button>
              <div id="agentPersonasMenu" class="persona-menu hidden"></div>
              <p class="muted small">Selected personas are assigned round-robin across agents.</p>
            </div>
            <label>Mode
              <select id="mode">
                <option value="cursor-cli">Cursor CLI + AXI</option>
                <option value="copilot-cli">Copilot CLI + AXI</option>
                <option value="custom-cli">Custom CLI</option>
              </select>
            </label>
            <label>Chrome mode
              <select id="chromeMode">
                <option value="axi">axi</option>
                <option value="devtools-mcp">devtools-mcp</option>
              </select>
            </label>
            <label>Model
              <select id="model"></select>
            </label>
            <label>Agent command <input id="agentCommand" /></label>
            <label>Max route steps <input id="maxRouteSteps" type="number" min="1" max="100" /></label>
            <label>AXI port base <input id="axiPortBase" placeholder="auto" /></label>
          </div>
          <div id="runPreview" class="run-preview"></div>
          <label>Custom directives
            <textarea id="agentDirectives" rows="4" placeholder="vuln=Probe auth bypasses and ID tampering&#10;dates=Stress date edges, reloads, and persistence"></textarea>
          </label>
          <p class="muted">Built-in personas are assigned round-robin. Custom directives use one ID=INSTRUCTIONS per line and are appended to the persona list.</p>
          <div class="checks">
            <label><input id="noDevServer" type="checkbox" checked /> I already started the dev server</label>
          </div>
        </section>
        <div class="run-actions">
          <button type="submit" class="primary">Start swarm run</button>
          <button type="button" id="cancelRun" class="danger" disabled>Cancel running swarm</button>
        </div>
      </form>
      <section class="panel" id="status-panel">
        <h2>Run status</h2>
        <pre id="status">No run started.</pre>
        <h3>Agent timeline</h3>
        <div id="timeline" class="timeline">Agent activity will appear here.</div>
        <details>
          <summary>Raw events</summary>
          <pre id="events">Run events will stream here. Set SWARM_DEBUG=true in .env for verbose server logs.</pre>
        </details>
        <h3>Final report</h3>
        <pre id="report">Report will appear after the run completes.</pre>
      </section>
          </div>
        </section>
      </div>
    </main>
    <script src="/app.js"></script>
  </body>
</html>`;

const stylesheet = `*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f172a;color:#e2e8f0}main{width:min(1320px,100%);margin:0 auto;padding:32px 20px 64px}.eyebrow{margin:0 0 8px;color:#38bdf8;text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700}h1{margin:0;font-size:42px;line-height:1.05}h2{margin:0 0 16px;font-size:18px}h3{margin:20px 0 8px}.lede{max-width:760px;color:#94a3b8;font-size:18px}.app-shell{display:grid;grid-template-columns:300px minmax(0,1fr);gap:18px;align-items:start}.runs-sidebar{position:sticky;top:20px;margin-top:18px;padding:16px;border:1px solid #334155;border-radius:16px;background:#111827;max-height:calc(100vh - 40px);overflow:auto}.runs-list{display:grid;gap:8px}.runs-section-head{color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:10px 0 4px}.runs-section-head:first-child{margin-top:0}.run-row{display:flex;gap:8px;align-items:stretch;width:100%}.pin-btn{flex-shrink:0;display:flex;align-items:center;justify-content:center;width:40px;padding:6px 4px;font-size:15px;font-weight:700;border:1px solid #334155;border-radius:10px;background:#020617;color:#64748b;line-height:1}.pin-btn:hover{border-color:#38bdf8;color:#e2e8f0;background:#0f172a}.pin-btn.is-pinned{color:#fcd34d;border-color:#92400e;background:#451a03}.pin-btn.is-pinned:hover{border-color:#fbbf24}.empty-runs{color:#94a3b8;font-size:13px}.run-item{display:grid;gap:4px;flex:1;min-width:0;text-align:left;border-color:#334155;background:#020617;color:#e2e8f0}.run-item:hover,.run-item.selected{border-color:#38bdf8;background:#082f49}.run-title{font-weight:800}.run-meta{color:#94a3b8;font-size:12px;line-height:1.35}.workspace{min-width:0}.panel{margin-top:18px;padding:20px;border:1px solid #334155;border-radius:16px;background:#111827;box-shadow:0 16px 40px rgba(2,6,23,.24)}label{display:flex;flex-direction:column;gap:7px;color:#cbd5e1;font-size:13px;font-weight:600}input,textarea,select{width:100%;border:1px solid #475569;border-radius:10px;background:#020617;color:#e2e8f0;padding:10px 12px;font:inherit}textarea{resize:vertical}.row,.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.route,.secret{display:grid;grid-template-columns:1fr 1.4fr auto;gap:12px;align-items:end;margin-top:12px}.secret{grid-template-columns:1fr 1.4fr auto}.checks{display:flex;flex-wrap:wrap;gap:16px;margin-top:16px}.checks label{flex-direction:row;align-items:center}.checks input{width:auto}button{border:1px solid #38bdf8;border-radius:10px;background:#082f49;color:#e0f2fe;padding:10px 14px;font-weight:700;cursor:pointer}button:hover{background:#0c4a6e}button:disabled{cursor:not-allowed;opacity:.55}button.pin-btn{padding:6px 4px;border-color:#334155;background:#020617;color:#64748b}button.pin-btn:hover{background:#0f172a;color:#e2e8f0;border-color:#38bdf8}button.pin-btn.is-pinned{color:#fcd34d;border-color:#92400e;background:#451a03}button.pin-btn.is-pinned:hover{border-color:#fbbf24}.run-actions{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}.primary{width:100%;margin-top:18px;padding:14px 16px;font-size:16px;background:#0284c7}.run-actions .danger{margin-top:18px}.danger{border-color:#64748b;background:#1e293b;color:#cbd5e1}.muted{margin:0 0 12px;color:#94a3b8}.small{font-size:12px}.run-preview{grid-column:1/-1;margin-top:14px;padding:12px 14px;border:1px solid #0e7490;border-radius:12px;background:#082f49;color:#bae6fd;font-size:13px;font-weight:700}.run-preview.warning{border-color:#f59e0b;background:#451a03;color:#fde68a}.field-label{display:block;margin-bottom:7px;color:#cbd5e1;font-size:13px;font-weight:600}.persona-field{position:relative}.persona-toggle{width:100%;min-height:42px;text-align:left;background:#020617;border-color:#475569;color:#e2e8f0;font-weight:600}.persona-toggle:after{content:"";float:right;margin-top:8px;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #94a3b8}.persona-menu{position:absolute;z-index:20;top:72px;left:0;right:0;display:grid;gap:8px;max-height:360px;overflow:auto;padding:10px;border:1px solid #475569;border-radius:12px;background:#020617;box-shadow:0 18px 40px rgba(2,6,23,.5)}.persona-option{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;padding:10px;border:1px solid #1e293b;border-radius:10px;background:#0f172a;cursor:pointer}.persona-option:hover{border-color:#38bdf8}.persona-option input{width:auto;margin-top:3px}.persona-copy{display:grid;gap:3px}.persona-name{color:#e2e8f0;font-weight:800}.persona-description{color:#94a3b8;font-size:12px;line-height:1.35}.timeline{display:grid;gap:10px;border:1px solid #334155;border-radius:12px;background:#020617;padding:14px}.agent-heading{margin-top:8px;color:#bae6fd;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.event{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start}.dot{width:10px;height:10px;margin-top:6px;border-radius:999px;background:#38bdf8}.event-message{font-weight:700}.event-meta{color:#94a3b8;font-size:12px}details{margin-top:12px}summary{cursor:pointer;color:#bae6fd;font-weight:700}pre{overflow:auto;white-space:pre-wrap;border:1px solid #334155;border-radius:12px;background:#020617;padding:14px;color:#dbeafe}.header-row{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap}.view-toggle{display:flex;gap:4px;background:#1e293b;border-radius:12px;padding:4px}.view-btn{border:none;background:transparent;color:#94a3b8;padding:8px 16px;font-size:13px;border-radius:8px}.view-btn:hover{background:#334155;color:#e2e8f0}.view-btn.active{background:#0284c7;color:#fff}.hidden{display:none!important}.activity-view{margin-top:18px}.activity-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:12px;padding:12px 16px;background:#1e293b;border-radius:12px}.activity-filter{flex-direction:row;align-items:center;gap:6px;font-size:12px;color:#94a3b8}.activity-filter input{width:auto}.activity-log{height:calc(100vh - 320px);min-height:400px;overflow-y:auto;background:#020617;border:1px solid #334155;border-radius:12px;padding:0;font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.5}.activity-line{display:flex;gap:0;border-bottom:1px solid #1e293b;padding:2px 0}.activity-line:hover{background:#0f172a}.activity-time{flex-shrink:0;width:70px;padding:2px 8px;color:#64748b;text-align:right}.activity-worker{flex-shrink:0;width:100px;padding:2px 8px;font-weight:600}.activity-worker.worker-shell{color:#f472b6}.activity-worker.worker-read{color:#4ade80}.activity-worker.worker-write{color:#facc15}.activity-worker.worker-other{color:#38bdf8}.activity-content{flex:1;padding:2px 8px;color:#cbd5e1;white-space:pre-wrap;word-break:break-all}.activity-exit{padding:2px 8px;color:#64748b;font-size:11px}.activity-exit.exit-ok{color:#4ade80}.activity-exit.exit-err{color:#f87171}.activity-empty{padding:40px;text-align:center;color:#64748b}@media(max-width:900px){.app-shell{grid-template-columns:1fr}.runs-sidebar{position:static;max-height:none}}@media(max-width:760px){.row,.grid,.route,.secret,.run-actions{grid-template-columns:1fr}h1{font-size:32px}.header-row{flex-direction:column}.activity-log{height:calc(100vh - 400px)}}`;

const clientScript = `
const form = document.querySelector("#run-form");
const routesEl = document.querySelector("#routes");
const secretsEl = document.querySelector("#secrets");
const statusEl = document.querySelector("#status");
const eventsEl = document.querySelector("#events");
const timelineEl = document.querySelector("#timeline");
const reportEl = document.querySelector("#report");
const runPreviewEl = document.querySelector("#runPreview");
const cancelRunBtn = document.querySelector("#cancelRun");
const runsListEl = document.querySelector("#runsList");
const refreshRunsBtn = document.querySelector("#refreshRuns");
const configView = document.querySelector("#config-view");
const activityView = document.querySelector("#activity-view");
const activityLog = document.querySelector("#activity-log");
const viewConfigBtn = document.querySelector("#view-config");
const viewActivityBtn = document.querySelector("#view-activity");
const personaToggle = document.querySelector("#agentPersonasToggle");
const personaMenu = document.querySelector("#agentPersonasMenu");

let activityLines = [];
let lastEventCount = 0;
let agentConcurrencyEdited = false;
let activeRunId = localStorage.getItem("cursor-browser-swarm.ui.activeRunId") || "";
let selectedRunId = localStorage.getItem("cursor-browser-swarm.ui.selectedRunId") || activeRunId;

const PINNED_RUNS_KEY = "cursor-browser-swarm.ui.pinnedRunIds";

function getPinnedRunIds() {
  try {
    const raw = localStorage.getItem(PINNED_RUNS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function savePinnedRunIds(ids) {
  localStorage.setItem(PINNED_RUNS_KEY, JSON.stringify(ids));
}

function pruneStalePinnedIds(validIds) {
  const set = new Set(validIds);
  const current = getPinnedRunIds();
  const next = current.filter((id) => set.has(id));
  if (next.length !== current.length) {
    savePinnedRunIds(next);
  }
}

function input(id) {
  return document.querySelector("#" + id);
}

function estimateActiveAgents() {
  const agents = Number.parseInt(input("agents").value || "1", 10);
  const routeCount = Math.max(routesEl.querySelectorAll(".route").length, 1);
  const assignment = input("assignmentStrategy").value;
  const activeAgents = assignment === "split" ? Math.min(agents, routeCount) : agents;
  return {
    agents,
    routeCount,
    assignment,
    activeAgents,
    isReduced: activeAgents < agents,
  };
}

function updateRunPreview() {
  const plan = estimateActiveAgents();
  const concurrency = input("agentConcurrency").value || "auto";
  runPreviewEl.className = "run-preview" + (plan.isReduced ? " warning" : "");
  runPreviewEl.textContent = plan.isReduced
    ? "Only " +
      String(plan.activeAgents) +
      " of " +
      String(plan.agents) +
      " requested agents will run because split mode cannot create more active agents than routes. Switch assignment to replicate to run all agents."
    : String(plan.activeAgents) +
      " active agents planned across " +
      String(plan.routeCount) +
      " route(s); concurrency: " +
      concurrency +
      ".";
}

function formatRunTime(timestamp) {
  if (!timestamp) {
    return "unknown time";
  }
  return new Date(timestamp).toLocaleString();
}

function togglePin(runId, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const ids = [...getPinnedRunIds()];
  const i = ids.indexOf(runId);
  if (i >= 0) {
    ids.splice(i, 1);
  } else {
    ids.push(runId);
  }
  savePinnedRunIds(ids);
  loadRuns().catch((error) => {
    runsListEl.textContent = String(error);
  });
}

function renderRuns(runs) {
  if (!runs || runs.length === 0) {
    runsListEl.innerHTML = '<div class="empty-runs">No runs yet.</div>';
    return;
  }
  const pinnedOrder = getPinnedRunIds();
  const byId = new Map(runs.map((r) => [r.id, r]));
  const pinnedRuns = pinnedOrder.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const pinnedSet = new Set(pinnedOrder);
  const unpinnedRuns = runs.filter((r) => !pinnedSet.has(r.id));

  function rowHtml(run, isPinned) {
    const selected = run.id === selectedRunId ? " selected" : "";
    const status = run.status || "unknown";
    const agents = run.agents === undefined ? "" : " · " + String(run.agents) + " agents";
    const issues =
      run.issuesFound === undefined ? "" : " · " + String(run.issuesFound) + " issues";
    const pinClass = isPinned ? "pin-btn is-pinned" : "pin-btn";
    const pinTitle = isPinned ? "Unpin from top" : "Pin to top";
    const star = isPinned ? "★" : "☆";
    return (
      '<div class="run-row">' +
      '<button type="button" class="' +
      pinClass +
      '" title="' +
      escapeHtml(pinTitle) +
      '" aria-label="' +
      escapeHtml(pinTitle) +
      '" data-pin-for="' +
      escapeHtml(run.id) +
      '">' +
      star +
      "</button>" +
      '<button type="button" class="run-item' +
      selected +
      '" data-run-id="' +
      escapeHtml(run.id) +
      '">' +
      '<span class="run-title">' +
      escapeHtml(run.appName || run.id) +
      "</span>" +
      '<span class="run-meta">' +
      escapeHtml(formatRunTime(run.startedAt)) +
      "</span>" +
      '<span class="run-meta">' +
      escapeHtml(status + agents + issues) +
      "</span>" +
      "</button>" +
      "</div>"
    );
  }

  let html = "";
  if (pinnedRuns.length) {
    html += '<div class="runs-section-head">Pinned</div>';
    html += pinnedRuns.map((run) => rowHtml(run, true)).join("");
  }
  if (unpinnedRuns.length) {
    if (pinnedRuns.length) {
      html += '<div class="runs-section-head">All runs</div>';
    }
    html += unpinnedRuns.map((run) => rowHtml(run, false)).join("");
  }
  runsListEl.innerHTML = html;
  for (const pinBtn of runsListEl.querySelectorAll(".pin-btn")) {
    const id = pinBtn.dataset.pinFor;
    pinBtn.addEventListener("click", (e) => togglePin(id, e));
  }
  for (const button of runsListEl.querySelectorAll(".run-item")) {
    button.addEventListener("click", () => selectRun(button.dataset.runId));
  }
}

async function loadRuns() {
  const response = await fetch("/api/runs");
  const data = await response.json();
  const runs = data.runs || [];
  pruneStalePinnedIds(runs.map((r) => r.id));
  renderRuns(runs);
  if (!selectedRunId && runs[0]?.id) {
    selectRun(runs[0].id);
  }
}

function selectRun(id) {
  if (!id) {
    return;
  }
  selectedRunId = id;
  localStorage.setItem("cursor-browser-swarm.ui.selectedRunId", selectedRunId);
  renderActivityLog();
  pollRun(id);
  loadRuns().catch((error) => {
    runsListEl.textContent = String(error);
  });
}

function addRoute(path = "/dashboard", goal = "Click dashboard cards, filters, empty states, and navigation links.") {
  const row = document.createElement("div");
  row.className = "route";
  row.innerHTML = '<label>Path <input class="route-path" required></label><label>Goal <input class="route-goal" required></label><button type="button" class="danger">Remove</button>';
  row.querySelector(".route-path").value = path;
  row.querySelector(".route-goal").value = goal;
  row.querySelector("button").addEventListener("click", () => {
    row.remove();
    updateRunPreview();
    saveFormState();
  });
  routesEl.append(row);
  updateRunPreview();
}

function addSecret(key = "", value = "") {
  const row = document.createElement("div");
  row.className = "secret";
  row.innerHTML = '<label>Key <input class="secret-key" placeholder="EMAIL"></label><label>Value <input class="secret-value" type="password"></label><button type="button" class="danger">Remove</button>';
  row.querySelector(".secret-key").value = key;
  row.querySelector(".secret-value").value = value;
  row.querySelector("button").addEventListener("click", () => row.remove());
  secretsEl.append(row);
}

function collectRoutes() {
  return [...routesEl.querySelectorAll(".route")].map((row) => ({
    path: row.querySelector(".route-path").value,
    goal: row.querySelector(".route-goal").value,
  }));
}

function collectSecrets() {
  return [...secretsEl.querySelectorAll(".secret")]
    .map((row) => ({
      key: row.querySelector(".secret-key").value,
      value: row.querySelector(".secret-value").value,
    }))
    .filter((secret) => secret.key && secret.value);
}

function collectSelectedPersonas() {
  return [...personaMenu.querySelectorAll("input[type=checkbox]:checked")]
    .map((checkbox) => checkbox.value)
    .join(",");
}

function selectedPersonaLabels() {
  return [...personaMenu.querySelectorAll("input[type=checkbox]:checked")].map((checkbox) => {
    const row = checkbox.closest(".persona-option");
    return row?.querySelector(".persona-name")?.textContent || checkbox.value;
  });
}

function updatePersonaSummary() {
  const labels = selectedPersonaLabels();
  personaToggle.textContent =
    labels.length === 0
      ? "Default personas"
      : labels.length <= 2
        ? labels.join(", ")
        : labels.slice(0, 2).join(", ") + " +" + String(labels.length - 2);
}

function renderPersonaOptions(options, selectedValue) {
  const selected = new Set(
    String(selectedValue || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  personaMenu.innerHTML = "";
  for (const option of options || []) {
    const label = document.createElement("label");
    label.className = "persona-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = option.id;
    checkbox.checked = selected.size === 0 || selected.has(option.id);
    const body = document.createElement("span");
    body.className = "persona-copy";
    const name = document.createElement("span");
    name.className = "persona-name";
    name.textContent = option.label || option.id;
    const description = document.createElement("span");
    description.className = "persona-description";
    description.textContent = option.instructions || "";
    body.append(name, description);
    label.append(checkbox, body);
    personaMenu.append(label);
    checkbox.addEventListener("change", () => {
      updatePersonaSummary();
      saveFormState();
    });
  }
  updatePersonaSummary();
}

function collectFormState() {
  return {
    baseUrl: input("baseUrl").value,
    appName: input("appName").value,
    routes: collectRoutes(),
    instructions: input("instructions").value,
    secrets: collectSecrets(),
    agents: input("agents").value,
    agentConcurrency: input("agentConcurrency").value,
    agentConcurrencyManual: agentConcurrencyEdited,
    assignmentStrategy: input("assignmentStrategy").value,
    agentPersonas: collectSelectedPersonas(),
    agentDirectives: input("agentDirectives").value,
    mode: input("mode").value,
    chromeMode: input("chromeMode").value,
    model: input("model").value,
    agentCommand: input("agentCommand").value,
    cursorCommand: input("agentCommand").value,
    maxRouteSteps: input("maxRouteSteps").value,
    axiPortBase: input("axiPortBase").value,
    noDevServer: input("noDevServer").checked,
  };
}

function saveFormState() {
  localStorage.setItem("cursor-browser-swarm.ui.form", JSON.stringify(collectFormState()));
}

function loadSavedFormState() {
  const raw = localStorage.getItem("cursor-browser-swarm.ui.form");
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function setModels(models, selectedModel) {
  input("model").innerHTML = "";
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name ? model.id + " - " + model.name : model.id;
    input("model").append(option);
  }
  input("model").value = selectedModel;
}

async function loadDefaults() {
  const defaults = await fetch("/api/defaults").then((r) => r.json());
  const saved = loadSavedFormState();
  input("baseUrl").value = saved?.baseUrl || defaults.baseUrl;
  input("appName").value = saved?.appName || defaults.appName;
  input("agents").value = saved?.agents || defaults.agents;
  agentConcurrencyEdited = Boolean(saved?.agentConcurrencyManual);
  input("agentConcurrency").value = agentConcurrencyEdited
    ? saved?.agentConcurrency || defaults.agentConcurrency || input("agents").value
    : defaults.agentConcurrency || "auto";
  input("assignmentStrategy").value = saved?.assignmentStrategy || defaults.assignmentStrategy;
  renderPersonaOptions(defaults.agentPersonaOptions, saved?.agentPersonas || defaults.agentPersonas);
  input("agentDirectives").value = saved?.agentDirectives || defaults.agentDirectives || "";
  input("mode").value = saved?.mode || defaults.mode;
  input("chromeMode").value = saved?.chromeMode === "playwright" ? defaults.chromeMode : saved?.chromeMode || defaults.chromeMode;
  setModels(defaults.models || [{ id: defaults.model, name: defaults.model }], saved?.model || defaults.model);
  input("agentCommand").value = saved?.agentCommand || saved?.cursorCommand || defaults.agentCommand || defaults.cursorCommand;
  input("maxRouteSteps").value = saved?.maxRouteSteps || defaults.maxRouteSteps;
  input("axiPortBase").value = saved?.axiPortBase || defaults.axiPortBase || "";
  input("instructions").value = saved?.instructions || input("instructions").value;
  input("noDevServer").checked = saved?.noDevServer ?? true;
  if (defaults.modelError) {
    eventsEl.textContent = "Model list fallback: " + defaults.modelError;
  }
  const savedRoutes = Array.isArray(saved?.routes) && saved.routes.length > 0 ? saved.routes : undefined;
  if (savedRoutes) {
    for (const route of savedRoutes) {
      addRoute(route.path || "", route.goal || "");
    }
  } else {
    addRoute();
  }
  if (Array.isArray(saved?.secrets)) {
    for (const secret of saved.secrets) {
      addSecret(secret.key || "", secret.value || "");
    }
  }
  updateRunPreview();
  saveFormState();
  if (activeRunId) {
    selectedRunId = activeRunId;
    statusEl.textContent = "Reattaching to run " + activeRunId + "...";
    cancelRunBtn.disabled = false;
    pollRun(activeRunId).catch((error) => {
      localStorage.removeItem("cursor-browser-swarm.ui.activeRunId");
      activeRunId = "";
      cancelRunBtn.disabled = true;
      statusEl.textContent = String(error);
    });
  }
  loadRuns().catch((error) => {
    runsListEl.textContent = String(error);
  });
}

async function updateEvents(id) {
  const events = await fetch("/api/runs/" + encodeURIComponent(id) + "/events").then((r) => r.text());
  eventsEl.textContent = events || "No events have been written yet.";
  renderTimeline(events);
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  return new Date(timestamp).toLocaleTimeString();
}

function renderTimeline(rawEvents) {
  const events = rawEvents
    .split(/\\r?\\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
  events.sort((a, b) => {
    const agentA = a.context?.agentId || "";
    const agentB = b.context?.agentId || "";
    if (agentA !== agentB) {
      return agentA.localeCompare(agentB);
    }
    const sequenceA = Number(a.context?.sequence || 0);
    const sequenceB = Number(b.context?.sequence || 0);
    if (sequenceA !== sequenceB) {
      return sequenceA - sequenceB;
    }
    return String(a.timestamp || "").localeCompare(String(b.timestamp || ""));
  });

  if (events.length === 0) {
    timelineEl.textContent = "No agent activity yet.";
    return;
  }

  timelineEl.innerHTML = "";
  let activeAgent = "";
  for (const event of events) {
    const context = event.context || {};
    if (context.agentId && context.agentId !== activeAgent) {
      activeAgent = context.agentId;
      const heading = document.createElement("div");
      heading.className = "agent-heading";
      heading.textContent = activeAgent;
      timelineEl.append(heading);
    }
    const row = document.createElement("div");
    row.className = "event";
    const dot = document.createElement("div");
    dot.className = "dot";
    const body = document.createElement("div");
    const message = document.createElement("div");
    message.className = "event-message";
    message.textContent = event.message || "Event";
    const meta = document.createElement("div");
    meta.className = "event-meta";
    meta.textContent = [
      context.sequence ? "#" + context.sequence : "",
      formatTime(event.timestamp),
      context.phase,
    ]
      .filter(Boolean)
      .join(" | ");
    body.append(message, meta);
    row.append(dot, body);
    timelineEl.append(row);
  }
}

async function pollRun(id) {
  const state = await fetch("/api/runs/" + encodeURIComponent(id)).then((r) => r.json());
  if (state.error) {
    throw new Error(state.error);
  }
  statusEl.textContent = JSON.stringify(state, null, 2);
  await updateEvents(id);
  cancelRunBtn.disabled = state.status !== "running";
  if (state.status === "running") {
    setTimeout(() => {
      if (selectedRunId === id || activeRunId === id) {
        pollRun(id).catch((error) => {
          statusEl.textContent = String(error);
        });
      }
    }, 2000);
    return;
  }
  if (activeRunId === id) {
    localStorage.removeItem("cursor-browser-swarm.ui.activeRunId");
    activeRunId = "";
  }
  if (state.status === "succeeded") {
    const report = await fetch("/api/runs/" + encodeURIComponent(id) + "/report").then((r) => r.text());
    reportEl.textContent = report;
  } else if (state.status === "cancelled") {
    reportEl.textContent = "Run cancelled. Partial artifacts remain in the output directory.";
  } else {
    reportEl.textContent = state.error || "Run failed.";
  }
  loadRuns().catch((error) => {
    runsListEl.textContent = String(error);
  });
}

document.querySelector("#add-route").addEventListener("click", () => addRoute("", ""));
document.querySelector("#add-secret").addEventListener("click", () => addSecret());
refreshRunsBtn.addEventListener("click", () => {
  loadRuns().catch((error) => {
    runsListEl.textContent = String(error);
  });
});
cancelRunBtn.addEventListener("click", async () => {
  if (!activeRunId) {
    return;
  }
  cancelRunBtn.disabled = true;
  statusEl.textContent = "Cancelling run " + activeRunId + "...";
  const response = await fetch("/api/runs/" + encodeURIComponent(activeRunId) + "/cancel", {
    method: "POST",
  });
  const state = await response.json();
  statusEl.textContent = JSON.stringify(state, null, 2);
  await updateEvents(activeRunId);
  await loadRuns();
});
personaToggle.addEventListener("click", () => {
  personaMenu.classList.toggle("hidden");
});
document.addEventListener("click", (event) => {
  if (!personaMenu.contains(event.target) && !personaToggle.contains(event.target)) {
    personaMenu.classList.add("hidden");
  }
});
form.addEventListener("input", () => {
  updateRunPreview();
  saveFormState();
});
form.addEventListener("change", () => {
  updateRunPreview();
  saveFormState();
});
input("agents").addEventListener("input", () => {
  if (!agentConcurrencyEdited && input("agentConcurrency").value !== "auto") {
    input("agentConcurrency").value = input("agents").value;
  }
  updateRunPreview();
});
input("agentConcurrency").addEventListener("input", () => {
  agentConcurrencyEdited = true;
  updateRunPreview();
});
input("mode").addEventListener("change", () => {
  input("chromeMode").value = "axi";
  saveFormState();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const plan = estimateActiveAgents();
  if (plan.isReduced) {
    statusEl.textContent =
      "Run not started: split assignment would only launch " +
      String(plan.activeAgents) +
      " of " +
      String(plan.agents) +
      " requested agents. Switch Assignment to replicate routes per agent to run all agents.";
    return;
  }
  saveFormState();
  cancelRunBtn.disabled = true;
  statusEl.textContent = "Starting run...";
  timelineEl.textContent = "Waiting for agent activity...";
  eventsEl.textContent = "Waiting for run events...";
  reportEl.textContent = "Report will appear after the run completes.";
  const payload = collectFormState();
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const state = await response.json();
  if (!response.ok) {
    statusEl.textContent = JSON.stringify(state, null, 2);
    return;
  }
  activeRunId = state.id;
  selectedRunId = state.id;
  localStorage.setItem("cursor-browser-swarm.ui.activeRunId", activeRunId);
  localStorage.setItem("cursor-browser-swarm.ui.selectedRunId", selectedRunId);
  cancelRunBtn.disabled = false;
  statusEl.textContent = JSON.stringify(state, null, 2);
  await loadRuns();
  pollRun(state.id);
});

loadDefaults().catch((error) => {
  statusEl.textContent = String(error);
});

function switchView(view) {
  if (view === "config") {
    configView.classList.remove("hidden");
    activityView.classList.add("hidden");
    viewConfigBtn.classList.add("active");
    viewActivityBtn.classList.remove("active");
  } else {
    configView.classList.add("hidden");
    activityView.classList.remove("hidden");
    viewConfigBtn.classList.remove("active");
    viewActivityBtn.classList.add("active");
    renderActivityLog();
  }
}

viewConfigBtn.addEventListener("click", () => switchView("config"));
viewActivityBtn.addEventListener("click", () => switchView("activity"));

function classifyEvent(event) {
  const msg = (event.message || "").toLowerCase();
  const tool = event.tool || event.context?.tool || "";
  if (tool.includes("shell") || msg.includes("shell:") || msg.includes("shell ")) return "shell";
  if (tool.includes("read") || msg.includes("read_file") || msg.includes("read:")) return "read";
  if (tool.includes("write") || msg.includes("write_file") || msg.includes("apply_patch") || msg.includes("edit")) return "write";
  return "other";
}

function formatActivityTime(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function truncateMessage(msg, maxLen = 200) {
  if (!msg) return "";
  const cleaned = msg.replace(/\\n/g, " ").replace(/\\s+/g, " ").trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "..." : cleaned;
}

function parseActivityFromEvents(rawEvents) {
  const events = rawEvents
    .split(/\\r?\\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return undefined; }
    })
    .filter(Boolean);

  return events.map((event, idx) => {
    const context = event.context || {};
    const agentId = context.agentId || "worker-" + (idx % 100);
    const category = classifyEvent(event);
    const exitCode = event.exitCode ?? event.exit_code ?? context.exitCode;
    const duration = event.duration ?? event.elapsed_ms ?? context.duration;
    return {
      time: formatActivityTime(event.timestamp),
      worker: agentId,
      category,
      message: truncateMessage(event.message || event.type || "event"),
      exitCode,
      duration,
      raw: event,
    };
  });
}

function renderActivityLog() {
  const filterShell = document.querySelector("#filter-shell").checked;
  const filterRead = document.querySelector("#filter-read").checked;
  const filterWrite = document.querySelector("#filter-write").checked;
  const filterOther = document.querySelector("#filter-other").checked;

  const filtered = activityLines.filter((line) => {
    if (line.category === "shell" && !filterShell) return false;
    if (line.category === "read" && !filterRead) return false;
    if (line.category === "write" && !filterWrite) return false;
    if (line.category === "other" && !filterOther) return false;
    return true;
  });

  if (filtered.length === 0) {
    activityLog.innerHTML = '<div class="activity-empty">No activity yet. Start a swarm run to see real-time logs.</div>';
    return;
  }

  activityLog.innerHTML = filtered.map((line) => {
    const exitClass = line.exitCode === undefined ? "" : (line.exitCode === 0 ? "exit-ok" : "exit-err");
    const exitText = line.exitCode !== undefined ? (line.exitCode === 0 ? "exit 0" : "exit " + line.exitCode) : "";
    const durationText = line.duration ? "[" + line.duration + "ms]" : "";
    return '<div class="activity-line">' +
      '<span class="activity-time">' + line.time + '</span>' +
      '<span class="activity-worker worker-' + line.category + '">' + line.worker + '</span>' +
      '<span class="activity-content">' + escapeHtml(line.message) + '</span>' +
      (exitText || durationText ? '<span class="activity-exit ' + exitClass + '">' + [exitText, durationText].filter(Boolean).join(" ") + '</span>' : '') +
      '</div>';
  }).join("");

  if (document.querySelector("#auto-scroll").checked) {
    activityLog.scrollTop = activityLog.scrollHeight;
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

document.querySelector("#clear-activity").addEventListener("click", () => {
  activityLines = [];
  renderActivityLog();
});

["filter-shell", "filter-read", "filter-write", "filter-other"].forEach((id) => {
  document.querySelector("#" + id).addEventListener("change", renderActivityLog);
});

const origUpdateEvents = updateEvents;
updateEvents = async function(id) {
  const events = await fetch("/api/runs/" + encodeURIComponent(id) + "/events").then((r) => r.text());
  eventsEl.textContent = events || "No events have been written yet.";
  renderTimeline(events);

  activityLines = parseActivityFromEvents(events);
  if (!activityView.classList.contains("hidden")) {
    renderActivityLog();
  }
};
`;
