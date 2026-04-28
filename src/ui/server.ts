import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
import { defaultOutDir, runSwarm } from "../runner/runSwarm.js";
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
  mode?: string | undefined;
  chromeMode?: string | undefined;
  model?: string | undefined;
  noDevServer?: boolean | undefined;
  devCommand?: string | undefined;
  cursorCommand?: string | undefined;
  maxRouteSteps?: number | string | undefined;
  assignmentStrategy?: string | undefined;
  axiPortBase?: number | string | undefined;
}

interface UiRunState {
  id: string;
  status: "running" | "succeeded" | "failed";
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
}

const uiRuns = new Map<string, UiRunState>();

const fallbackModels = [
  { id: "auto", name: "Auto" },
  { id: "composer-2-fast", name: "Composer 2 Fast" },
  { id: "composer-2", name: "Composer 2" },
  { id: "composer-1.5", name: "Composer 1.5" },
  { id: "gpt-5.3-codex", name: "Codex 5.3" },
  { id: "gpt-5.3-codex-high", name: "Codex 5.3 High" },
  { id: "gpt-5.2", name: "GPT-5.2" },
];

function makeRunId(now = new Date()): string {
  return `ui-${now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")}`;
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
    case "cursor-sdk":
    case "cloud-api":
      return mode;
    case "dry-run":
      return "cursor-cli";
    default:
      throw new Error("UI mode must be cursor-cli, cursor-sdk, or cloud-api.");
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
    "composer-2-fast"
  );
}

async function listCursorModels(cursorCommand: string): Promise<{
  models: { id: string; name: string }[];
  source: "cursor-cli" | "fallback";
  error?: string | undefined;
}> {
  try {
    const result = await execa(cursorCommand, ["--list-models"], {
      reject: false,
      timeout: 10_000,
      all: true,
    });
    const models = parseModelOutput(result.all ?? "");
    if (result.exitCode === 0 && models.length > 0) {
      return { models, source: "cursor-cli" };
    }
    return {
      models: fallbackModels,
      source: "fallback",
      error: result.all || `Cursor CLI exited with code ${result.exitCode}.`,
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
    mode,
    runId,
    outDir,
    cursorCommand: textOrUndefined(input.cursorCommand) ?? "agent",
    chromeMode,
    ...(axiPortBaseInput ? { axiPortBase: parseAxiPortBase(axiPortBaseInput) } : {}),
    maxRouteSteps: parseRouteSteps(String(input.maxRouteSteps ?? "12")),
  };
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

  const state: UiRunState = {
    id: runId,
    status: "running",
    startedAt: new Date().toISOString(),
    baseUrl: input.baseUrl.trim(),
    outDir,
    routesPath,
    eventsPath,
  };
  if (instructionsPath) {
    state.instructionsPath = instructionsPath;
  }
  if (envPath) {
    state.envPath = envPath;
  }
  uiRuns.set(runId, state);

  void runSwarm(cliOptions)
    .then((result) => {
      state.status = "succeeded";
      state.endedAt = new Date().toISOString();
      state.finalReportPath = result.finalReportPath;
      state.metricsPath = result.metricsPath;
      state.benchmarkJsonPath = result.benchmarkJsonPath;
      state.benchmarkCsvPath = result.benchmarkCsvPath;
    })
    .catch((error: unknown) => {
      state.status = "failed";
      state.endedAt = new Date().toISOString();
      state.error = error instanceof Error ? error.message : String(error);
    });

  return state;
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/defaults") {
    const cursorCommand = url.searchParams.get("cursorCommand") ?? "agent";
    const modelResult = await listCursorModels(cursorCommand);
    sendJson(response, 200, {
      baseUrl: "http://localhost:3000",
      appName: "My App",
      agents: 4,
      agentConcurrency: 4,
      assignmentStrategy: "replicate",
      mode: "cursor-cli",
      chromeMode: "axi",
      model: chooseDefaultModel(modelResult.models),
      models: modelResult.models,
      modelSource: modelResult.source,
      modelError: modelResult.error,
      cursorCommand,
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
    sendJson(response, 202, state);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/runs/")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const runId = parts[2];
    const state = runId ? uiRuns.get(runId) : undefined;
    if (!state) {
      sendJson(response, 404, { error: "Run not found." });
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
    sendJson(response, 200, state);
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
        <p class="eyebrow">Cursor Browser Swarm</p>
        <h1>Launch browser-validation agents</h1>
        <p class="lede">Point at a running app, describe the routes, choose the model, and let Cursor CLI agents validate with AXI browser tooling.</p>
      </header>
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
            <label>Agent concurrency <input id="agentConcurrency" type="number" min="1" max="1000" /></label>
            <label>Assignment
              <select id="assignmentStrategy">
                <option value="replicate">replicate routes per agent</option>
                <option value="split">split routes across agents</option>
              </select>
            </label>
            <label>Mode
              <select id="mode">
                <option value="cursor-cli">Cursor CLI + AXI</option>
                <option value="cursor-sdk">Cursor SDK</option>
                <option value="cloud-api">Cloud API</option>
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
            <label>Cursor command <input id="cursorCommand" /></label>
            <label>Max route steps <input id="maxRouteSteps" type="number" min="1" max="100" /></label>
            <label>AXI port base <input id="axiPortBase" placeholder="auto" /></label>
          </div>
          <div class="checks">
            <label><input id="noDevServer" type="checkbox" checked /> I already started the dev server</label>
          </div>
        </section>
        <button type="submit" class="primary">Start swarm run</button>
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
    </main>
    <script src="/app.js"></script>
  </body>
</html>`;

const stylesheet = `*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f172a;color:#e2e8f0}main{width:min(1080px,100%);margin:0 auto;padding:32px 20px 64px}.eyebrow{margin:0 0 8px;color:#38bdf8;text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700}h1{margin:0;font-size:42px;line-height:1.05}h2{margin:0 0 16px;font-size:18px}h3{margin:20px 0 8px}.lede{max-width:760px;color:#94a3b8;font-size:18px}.panel{margin-top:18px;padding:20px;border:1px solid #334155;border-radius:16px;background:#111827;box-shadow:0 16px 40px rgba(2,6,23,.24)}label{display:flex;flex-direction:column;gap:7px;color:#cbd5e1;font-size:13px;font-weight:600}input,textarea,select{width:100%;border:1px solid #475569;border-radius:10px;background:#020617;color:#e2e8f0;padding:10px 12px;font:inherit}textarea{resize:vertical}.row,.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.route,.secret{display:grid;grid-template-columns:1fr 1.4fr auto;gap:12px;align-items:end;margin-top:12px}.secret{grid-template-columns:1fr 1.4fr auto}.checks{display:flex;flex-wrap:wrap;gap:16px;margin-top:16px}.checks label{flex-direction:row;align-items:center}.checks input{width:auto}button{border:1px solid #38bdf8;border-radius:10px;background:#082f49;color:#e0f2fe;padding:10px 14px;font-weight:700;cursor:pointer}button:hover{background:#0c4a6e}.primary{width:100%;margin-top:18px;padding:14px 16px;font-size:16px;background:#0284c7}.danger{border-color:#64748b;background:#1e293b;color:#cbd5e1}.muted{margin:0 0 12px;color:#94a3b8}.timeline{display:grid;gap:10px;border:1px solid #334155;border-radius:12px;background:#020617;padding:14px}.agent-heading{margin-top:8px;color:#bae6fd;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.event{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start}.dot{width:10px;height:10px;margin-top:6px;border-radius:999px;background:#38bdf8}.event-message{font-weight:700}.event-meta{color:#94a3b8;font-size:12px}details{margin-top:12px}summary{cursor:pointer;color:#bae6fd;font-weight:700}pre{overflow:auto;white-space:pre-wrap;border:1px solid #334155;border-radius:12px;background:#020617;padding:14px;color:#dbeafe}@media(max-width:760px){.row,.grid,.route,.secret{grid-template-columns:1fr}h1{font-size:32px}}`;

const clientScript = `
const form = document.querySelector("#run-form");
const routesEl = document.querySelector("#routes");
const secretsEl = document.querySelector("#secrets");
const statusEl = document.querySelector("#status");
const eventsEl = document.querySelector("#events");
const timelineEl = document.querySelector("#timeline");
const reportEl = document.querySelector("#report");

function input(id) {
  return document.querySelector("#" + id);
}

function addRoute(path = "/dashboard", goal = "Click dashboard cards, filters, empty states, and navigation links.") {
  const row = document.createElement("div");
  row.className = "route";
  row.innerHTML = '<label>Path <input class="route-path" required></label><label>Goal <input class="route-goal" required></label><button type="button" class="danger">Remove</button>';
  row.querySelector(".route-path").value = path;
  row.querySelector(".route-goal").value = goal;
  row.querySelector("button").addEventListener("click", () => row.remove());
  routesEl.append(row);
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

function collectFormState() {
  return {
    baseUrl: input("baseUrl").value,
    appName: input("appName").value,
    routes: collectRoutes(),
    instructions: input("instructions").value,
    secrets: collectSecrets(),
    agents: input("agents").value,
    agentConcurrency: input("agentConcurrency").value,
    assignmentStrategy: input("assignmentStrategy").value,
    mode: input("mode").value,
    chromeMode: input("chromeMode").value,
    model: input("model").value,
    cursorCommand: input("cursorCommand").value,
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
  input("agentConcurrency").value = saved?.agentConcurrency || defaults.agentConcurrency || input("agents").value;
  input("assignmentStrategy").value = saved?.assignmentStrategy || defaults.assignmentStrategy;
  input("mode").value = saved?.mode === "dry-run" ? defaults.mode : saved?.mode || defaults.mode;
  input("chromeMode").value = saved?.chromeMode === "playwright" ? defaults.chromeMode : saved?.chromeMode || defaults.chromeMode;
  setModels(defaults.models || [{ id: defaults.model, name: defaults.model }], saved?.model || defaults.model);
  input("cursorCommand").value = saved?.cursorCommand || defaults.cursorCommand;
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
  saveFormState();
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
  statusEl.textContent = JSON.stringify(state, null, 2);
  await updateEvents(id);
  if (state.status === "running") {
    setTimeout(() => pollRun(id), 2000);
    return;
  }
  if (state.status === "succeeded") {
    const report = await fetch("/api/runs/" + encodeURIComponent(id) + "/report").then((r) => r.text());
    reportEl.textContent = report;
  } else {
    reportEl.textContent = state.error || "Run failed.";
  }
}

document.querySelector("#add-route").addEventListener("click", () => addRoute("", ""));
document.querySelector("#add-secret").addEventListener("click", () => addSecret());
form.addEventListener("input", saveFormState);
form.addEventListener("change", saveFormState);
input("mode").addEventListener("change", () => {
  if (input("mode").value === "cursor-cli") {
    input("chromeMode").value = "axi";
  } else if (input("mode").value === "dry-run") {
    input("chromeMode").value = "playwright";
  }
  saveFormState();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveFormState();
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
  pollRun(state.id);
});

loadDefaults().catch((error) => {
  statusEl.textContent = String(error);
});
`;
