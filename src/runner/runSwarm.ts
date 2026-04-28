import { homedir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { execa } from "execa";
import {
  createArtifactPaths,
  ensureAgentDirectories,
  ensureRunDirectories,
  getAgentArtifactPaths,
} from "../artifacts/artifactPaths.js";
import {
  writeBenchmarkReport,
  type BenchmarkInstrumentation,
} from "../artifacts/writeBenchmarkReport.js";
import { summarizeFindings } from "../artifacts/summarizeFindings.js";
import { writeRunReport } from "../artifacts/writeRunReport.js";
import { runAxiPreflight } from "../browser/axiPreflight.js";
import { loadContextPacket, loadRouteConfig, mergeBaseUrl, readOptionalText } from "../config.js";
import { CloudApiCursorAgentClient } from "../cursor/cloudApiClient.js";
import { writeAxiHelper } from "../cursor/axiHelper.js";
import { CliCursorAgentClient, writeCursorMcpConfig } from "../cursor/cliClient.js";
import { DryRunCursorAgentClient } from "../cursor/dryRunClient.js";
import { buildMissionPrompt } from "../cursor/missionPrompt.js";
import { SdkCursorAgentClient } from "../cursor/sdkClient.js";
import { createRunLogger } from "../observability.js";
import { resolveAgentDirectives } from "./agentDirectives.js";
import type {
  AgentAssignment,
  AgentRunReport,
  BrowserSession,
  CursorAgentClient,
  RouteConfig,
  SwarmCliOptions,
  SwarmRunConfig,
  SwarmSecret,
} from "../types.js";
import { createAgentRun } from "./createAgentRun.js";
import { waitForHealthy } from "./healthCheck.js";
import {
  collectResourceSnapshot,
  estimateInitialConcurrency,
  recommendAdaptiveConcurrency,
  startResourceSampler,
  type AdaptiveDecision,
} from "./resourceMonitor.js";
import { splitRoutesAcrossAgents } from "./routePlanner.js";
import { spawnLocalDevServer } from "./spawnLocalDevServer.js";

function createRunId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return stamp;
}

function buildSecretEnv(secrets: SwarmSecret[]): Record<string, string> {
  return Object.fromEntries(secrets.map((secret) => [secret.envName, secret.value]));
}

function safePathSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80) || "browser-app"
  );
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function defaultAxiPortBase(runId: string, agents: number): number {
  const minBase = 20_000;
  const maxBase = 65_535 - Math.max(agents + 1, 1);
  const spread = Math.max(maxBase - minBase, 1);
  return minBase + (hashString(runId) % spread);
}

function axiPreflightRequired(): boolean {
  const raw =
    process.env.SWARM_AXI_PREFLIGHT_REQUIRED ??
    process.env.CURSOR_BROWSER_SWARM_AXI_PREFLIGHT_REQUIRED ??
    "";
  return ["1", "true", "yes", "required"].includes(raw.toLowerCase());
}

function createBrowserSession(input: {
  assignment: AgentAssignment;
  agentPaths: {
    browserHomeDir: string;
    browserProfileDir: string;
    tempDir: string;
    scriptsDir: string;
  };
  axiPortBase: number;
}): BrowserSession {
  return {
    agentId: input.assignment.agentId,
    index: input.assignment.index,
    axiPort: input.axiPortBase + input.assignment.index + 1,
    homeDir: input.agentPaths.browserHomeDir,
    profileDir: input.agentPaths.browserProfileDir,
    tempDir: input.agentPaths.tempDir,
    scriptsDir: input.agentPaths.scriptsDir,
  };
}

function duplicateCount(values: string[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const value of values) {
    if (seen.has(value)) {
      duplicates += 1;
    }
    seen.add(value);
  }
  return duplicates;
}

function memoryUsageMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function browserSessionEnv(session: BrowserSession): Record<string, string> {
  return {
    ...process.env,
    HOME: session.homeDir,
    ...(process.env.HOME ? { npm_config_cache: path.join(process.env.HOME, ".npm") } : {}),
    TMPDIR: session.tempDir,
    TEMP: session.tempDir,
    TMP: session.tempDir,
    CHROME_DEVTOOLS_AXI_PORT: String(session.axiPort),
    CHROME_DEVTOOLS_AXI_DISABLE_HOOKS: "1",
    SWARM_BROWSER_SESSION_ID: session.agentId,
    SWARM_BROWSER_HOME: session.homeDir,
    SWARM_BROWSER_PROFILE_DIR: session.profileDir,
    SWARM_BROWSER_TEMP_DIR: session.tempDir,
    SWARM_BROWSER_SCRIPTS_DIR: session.scriptsDir,
  };
}

async function startAxiBridge(session: BrowserSession): Promise<{
  startupMs: number;
  failed: boolean;
  output: string;
  pids: number[];
}> {
  const startedAt = Date.now();
  const result = await execa("npx", ["-y", "chrome-devtools-axi", "start"], {
    all: true,
    env: browserSessionEnv(session),
    reject: false,
    timeout: 45_000,
  });
  const pids = await tcpListenPids(session.axiPort);
  return {
    startupMs: Date.now() - startedAt,
    failed: result.exitCode !== 0,
    output: result.all ?? "",
    pids,
  };
}

async function tcpListenPids(port: number): Promise<number[]> {
  try {
    const result = await execa("lsof", ["-tiTCP:" + String(port), "-sTCP:LISTEN"], {
      reject: false,
      timeout: 5_000,
    });
    if (result.exitCode !== 0) {
      return [];
    }
    return result.stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

interface ProcessEntry {
  pid: number;
  ppid: number;
  command: string;
}

async function processTable(): Promise<ProcessEntry[]> {
  try {
    const result = await execa("ps", ["-axo", "pid=,ppid=,command="], {
      reject: false,
      timeout: 5_000,
    });
    if (result.exitCode !== 0) {
      return [];
    }
    return result.stdout
      .split(/\r?\n/)
      .map((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
        if (!match?.[1] || !match[2] || !match[3]) {
          return undefined;
        }
        return {
          pid: Number.parseInt(match[1], 10),
          ppid: Number.parseInt(match[2], 10),
          command: match[3],
        };
      })
      .filter((entry): entry is ProcessEntry => entry !== undefined);
  } catch {
    return [];
  }
}

function processTreePids(rootPids: number[], processes: ProcessEntry[]): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const processEntry of processes) {
    const children = childrenByParent.get(processEntry.ppid) ?? [];
    children.push(processEntry.pid);
    childrenByParent.set(processEntry.ppid, children);
  }

  const pids = new Set<number>();
  const stack = [...rootPids];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (!pid || pids.has(pid)) {
      continue;
    }
    pids.add(pid);
    stack.push(...(childrenByParent.get(pid) ?? []));
  }
  return [...pids];
}

async function terminatePids(pids: number[], signal: "SIGTERM" | "SIGKILL"): Promise<void> {
  if (pids.length === 0) {
    return;
  }
  await execa("kill", [signal === "SIGKILL" ? "-9" : "-TERM", ...pids.map(String)], {
    reject: false,
    timeout: 5_000,
  });
}

async function stopAxiBridgeForPort(port: number): Promise<number[]> {
  const pids = await tcpListenPids(port);
  const processes = await processTable();
  const bridgePids = pids.filter((pid) =>
    /chrome-devtools-axi-bridge\.js/.test(
      processes.find((processEntry) => processEntry.pid === pid)?.command ?? "",
    ),
  );
  const targetPids = processTreePids(bridgePids, processes);
  await terminatePids(targetPids, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const remainingProcesses = await processTable();
  const remaining = targetPids.filter((pid) =>
    remainingProcesses.some((processEntry) => processEntry.pid === pid),
  );
  await terminatePids(remaining, "SIGKILL");
  return targetPids;
}

async function runScopedWatchdogPids(runDir: string): Promise<number[]> {
  return (await processTable())
    .filter(
      (entry) =>
        entry.command.includes(runDir) &&
        /chrome-devtools-mcp\/build\/src\/telemetry\/watchdog/.test(entry.command),
    )
    .map((entry) => entry.pid);
}

async function cleanupRunBrowserTools(input: { runDir: string; axiPorts: number[] }): Promise<{
  bridgePids: number[];
  watchdogPids: number[];
}> {
  const bridgePids: number[] = [];
  for (const port of input.axiPorts) {
    bridgePids.push(...(await stopAxiBridgeForPort(port)));
  }
  const watchdogPids = await runScopedWatchdogPids(input.runDir);
  await terminatePids(watchdogPids, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const remainingWatchdogs = (await runScopedWatchdogPids(input.runDir)).filter((pid) =>
    watchdogPids.includes(pid),
  );
  await terminatePids(remainingWatchdogs, "SIGKILL");
  return { bridgePids, watchdogPids };
}

function plannedAxiPorts(config: SwarmRunConfig): number[] {
  return [
    config.axiPortBase,
    ...Array.from({ length: config.agents }, (_, index) => config.axiPortBase + index + 1),
  ];
}

async function countChromeProcesses(): Promise<number> {
  try {
    const result = await execa("ps", ["-axo", "command"], {
      all: true,
      reject: false,
      timeout: 5_000,
    });
    if (result.exitCode !== 0) {
      return 0;
    }
    return (result.all ?? "")
      .split(/\r?\n/)
      .filter((line) => /Google Chrome|Chromium|chrome-devtools-mcp/i.test(line)).length;
  } catch {
    return 0;
  }
}

async function runWithAdaptiveConcurrency<T, R>(input: {
  items: T[];
  initialConcurrency: number;
  maxConcurrency: number;
  adaptive: boolean;
  signal?: AbortSignal;
  snapshot: () => ReturnType<typeof collectResourceSnapshot>;
  onDecision: (decision: AdaptiveDecision) => Promise<void>;
  worker: (item: T) => Promise<R>;
}): Promise<{
  results: R[];
  maxObservedConcurrency: number;
}> {
  const results: R[] = [];
  let nextIndex = 0;
  let active = 0;
  let completed = 0;
  let targetConcurrency = Math.min(input.initialConcurrency, input.items.length);
  let maxObservedConcurrency = 0;

  return new Promise((resolve, reject) => {
    let rejected = false;
    let timer: NodeJS.Timeout | undefined;
    const rejectIfAborted = (): boolean => {
      if (!input.signal?.aborted) {
        return false;
      }
      rejected = true;
      if (timer) {
        clearInterval(timer);
      }
      reject(new Error("Run cancelled."));
      return true;
    };
    const maybeAdjustConcurrency = (): void => {
      if (!input.adaptive || completed >= input.items.length) {
        return;
      }
      const snapshot = input.snapshot();
      const recommendation = recommendAdaptiveConcurrency({
        current: targetConcurrency,
        max: Math.min(input.maxConcurrency, input.items.length),
        snapshot,
      });
      if (recommendation.reason && recommendation.next !== targetConcurrency) {
        const decision: AdaptiveDecision = {
          timestamp: new Date().toISOString(),
          elapsedMs: snapshot.elapsedMs,
          from: targetConcurrency,
          to: recommendation.next,
          reason: recommendation.reason,
          usedMemoryPercent: snapshot.usedMemoryPercent,
          loadPerCpu: snapshot.loadPerCpu,
        };
        targetConcurrency = recommendation.next;
        void input.onDecision(decision).catch(() => undefined);
      }
    };
    const launch = (): void => {
      if (rejectIfAborted()) {
        return;
      }
      maybeAdjustConcurrency();
      while (active < targetConcurrency && nextIndex < input.items.length && !rejected) {
        const currentIndex = nextIndex;
        const item = input.items[currentIndex] as T;
        nextIndex += 1;
        active += 1;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, active);
        input
          .worker(item)
          .then((result) => {
            results[currentIndex] = result;
            active -= 1;
            completed += 1;
            if (completed >= input.items.length) {
              if (timer) {
                clearInterval(timer);
              }
              resolve({ results, maxObservedConcurrency });
              return;
            }
            launch();
          })
          .catch((error: unknown) => {
            rejected = true;
            if (timer) {
              clearInterval(timer);
            }
            reject(error);
          });
      }
    };
    if (input.adaptive) {
      timer = setInterval(launch, 5_000);
    }
    input.signal?.addEventListener("abort", () => {
      void rejectIfAborted();
    });
    launch();
  });
}

export function defaultOutDir(appName: string, runId: string): string {
  return path.join(homedir(), ".cursor-browser-swarm", "runs", safePathSegment(appName), runId);
}

function createClient(config: SwarmRunConfig): CursorAgentClient {
  switch (config.mode) {
    case "dry-run":
      return new DryRunCursorAgentClient();
    case "cursor-cli":
      return new CliCursorAgentClient(config.cursorCommand);
    case "cursor-sdk":
      return config.model
        ? new SdkCursorAgentClient({ model: config.model })
        : new SdkCursorAgentClient();
    case "cloud-api":
      return config.model
        ? new CloudApiCursorAgentClient({ model: config.model })
        : new CloudApiCursorAgentClient();
    default: {
      const exhaustive: never = config.mode;
      return exhaustive;
    }
  }
}

function resolveRunConfig(
  cli: SwarmCliOptions,
  routeConfig: RouteConfig,
  instructions?: string,
): SwarmRunConfig {
  const runId = cli.runId ?? createRunId();
  const concurrencyPlan = estimateInitialConcurrency({
    requested: cli.agentConcurrency,
    agents: cli.agents,
    mode: cli.mode,
    chromeMode: cli.chromeMode,
    snapshot: collectResourceSnapshot(Date.now()),
  });
  return {
    repoPath: cli.repo,
    baseUrl: routeConfig.baseUrl ?? cli.baseUrl,
    routesPath: cli.routesPath,
    instructions,
    instructionsPath: cli.instructionsPath,
    secrets: cli.secrets.map((secret) => ({
      ...secret,
      envName: `${cli.secretsEnvPrefix}${secret.key}`,
    })),
    secretEnv: cli.secretEnv,
    secretsEnvPrefix: cli.secretsEnvPrefix,
    interactiveSecrets: cli.interactiveSecrets,
    agents: cli.agents,
    agentConcurrency: concurrencyPlan.concurrency,
    requestedAgentConcurrency: cli.agentConcurrency,
    agentConcurrencyMode: concurrencyPlan.mode,
    assignmentStrategy: cli.assignmentStrategy,
    agentDirectives: resolveAgentDirectives({
      personaList: cli.agentPersonas,
      customDirectives: cli.agentDirectives,
      routeDirectives: routeConfig.agentDirectives,
    }),
    agentPersonas: cli.agentPersonas,
    mode: cli.mode,
    runId,
    outDir: cli.outDir ?? defaultOutDir(routeConfig.appName, runId),
    cursorCommand: cli.cursorCommand,
    model: cli.model,
    chromeMode: cli.chromeMode,
    axiPortBase: cli.axiPortBase ?? defaultAxiPortBase(runId, cli.agents),
    maxRouteSteps: cli.maxRouteSteps,
    devCommand: cli.devCommand,
    noDevServer: cli.noDevServer,
    routeConfig,
  };
}

export async function runSwarm(cli: SwarmCliOptions): Promise<{
  config: SwarmRunConfig;
  finalReportPath: string;
  metricsPath: string;
  benchmarkJsonPath: string;
  benchmarkCsvPath: string;
}> {
  return runSwarmWithSignal(cli, undefined);
}

export async function runSwarmWithSignal(
  cli: SwarmCliOptions,
  signal: AbortSignal | undefined,
): Promise<{
  config: SwarmRunConfig;
  finalReportPath: string;
  metricsPath: string;
  benchmarkJsonPath: string;
  benchmarkCsvPath: string;
}> {
  const loadedRoutes = await loadRouteConfig(cli.routesPath);
  const mergedRoutes = mergeBaseUrl(loadedRoutes, cli.baseUrl);
  const instructions = await readOptionalText(cli.instructionsPath);
  const contextPacket = cli.contextPacketPath
    ? await loadContextPacket(cli.contextPacketPath)
    : undefined;
  const config = resolveRunConfig(cli, mergedRoutes, instructions);
  const runStartedAt = Date.now();
  const runStartedAtIso = new Date(runStartedAt).toISOString();
  let memoryPeakMb = memoryUsageMb();
  const memorySampler = setInterval(() => {
    memoryPeakMb = Math.max(memoryPeakMb, memoryUsageMb());
  }, 1_000);
  const chromeProcessCountBefore = await countChromeProcesses();
  let preflightMs = 0;
  let firstAgentStartMs = 0;
  let lastAgentCompleteMs = 0;
  let startupFailures = 0;
  let portCollisions = 0;
  const artifacts = createArtifactPaths(config.outDir);
  const logger = createRunLogger(artifacts.eventsPath);
  await ensureRunDirectories(artifacts);
  const resourceSampler = startResourceSampler({
    samplesPath: artifacts.resourceSamplesPath,
    startedAt: runStartedAt,
  });
  const adaptiveDecisions: AdaptiveDecision[] = [];
  await logger.info("Run initialized", {
    runId: config.runId,
    mode: config.mode,
    chromeMode: config.chromeMode,
    agents: config.agents,
    requestedAgentConcurrency: config.requestedAgentConcurrency,
    agentConcurrency: config.agentConcurrency,
    agentConcurrencyMode: config.agentConcurrencyMode,
    routes: config.routeConfig.routes.length,
    agentDirectives: config.agentDirectives.map((directive) => directive.id),
    resourceSamplesPath: artifacts.resourceSamplesPath,
    model: config.model ?? "default",
  });

  const devServer = config.devCommand
    ? await spawnLocalDevServer(config.devCommand, config.repoPath)
    : undefined;
  try {
    await logger.debug("Waiting for base URL health check", { baseUrl: config.baseUrl });
    await waitForHealthy(config.baseUrl);
    await logger.info("Base URL is healthy", { baseUrl: config.baseUrl });
    if (config.mode === "cursor-cli" && config.chromeMode === "devtools-mcp") {
      await writeCursorMcpConfig(config.repoPath);
      await logger.info("Wrote Cursor MCP config", { repoPath: config.repoPath });
    }
    if (config.mode === "cursor-cli" && config.chromeMode === "axi") {
      await logger.info("Running AXI preflight", { baseUrl: config.baseUrl });
      const preflightStartedAt = Date.now();
      try {
        const preflightSession: BrowserSession = {
          agentId: "preflight",
          index: -1,
          axiPort: config.axiPortBase,
          homeDir: path.join(artifacts.runDir, "preflight", "browser-home"),
          profileDir: path.join(artifacts.runDir, "preflight", "browser-profile"),
          tempDir: path.join(artifacts.runDir, "preflight", "tmp"),
          scriptsDir: path.join(artifacts.runDir, "preflight", "scripts"),
        };
        const preflight = await runAxiPreflight({
          baseUrl: config.baseUrl,
          runDir: artifacts.runDir,
          browserSession: preflightSession,
        });
        preflightSession.axiBridgePids = await tcpListenPids(preflightSession.axiPort);
        preflightMs = Date.now() - preflightStartedAt;
        await logger.info("AXI preflight passed", { screenshotPath: preflight.screenshotPath });
        const stoppedPids = await stopAxiBridgeForPort(preflightSession.axiPort);
        if (stoppedPids.length > 0) {
          await logger.info("Stopped AXI bridge for preflight", {
            axiPort: preflightSession.axiPort,
            pids: stoppedPids,
          });
        }
      } catch (error) {
        preflightMs = Date.now() - preflightStartedAt;
        const message = error instanceof Error ? error.message : String(error);
        await logger.warn("AXI preflight failed; continuing to agent run", {
          error: message,
          required: axiPreflightRequired(),
        });
        if (axiPreflightRequired()) {
          throw error;
        }
      }
    }

    const assignments = splitRoutesAcrossAgents(
      config.routeConfig.routes,
      config.agents,
      config.assignmentStrategy,
      config.agentDirectives,
    );
    await logger.debug("Created route assignments", {
      assignments: assignments.map((assignment) => ({
        agentId: assignment.agentId,
        routes: assignment.routes.map((route) => route.path),
        directive: assignment.directive.id,
      })),
    });
    if (assignments.length < config.agents) {
      await logger.warn("Active agent count is lower than requested agents", {
        requestedAgents: config.agents,
        activeAgents: assignments.length,
        assignmentStrategy: config.assignmentStrategy,
        routeCount: config.routeConfig.routes.length,
        hint: "Use assignmentStrategy=replicate to run every requested agent against the route set.",
      });
    }
    const sessionPlans = new Map(
      assignments.map((assignment) => {
        const agentPaths = getAgentArtifactPaths(artifacts, assignment.agentId);
        const browserSession = createBrowserSession({
          assignment,
          agentPaths,
          axiPortBase: config.axiPortBase,
        });
        return [assignment.agentId, { agentPaths, browserSession }] as const;
      }),
    );
    const profileConflicts = duplicateCount(
      [...sessionPlans.values()].map((plan) => plan.browserSession.profileDir),
    );
    const tempDirCollisions = duplicateCount(
      [...sessionPlans.values()].map((plan) => plan.browserSession.tempDir),
    );
    const portPlanCollisions = duplicateCount(
      [...sessionPlans.values()].map((plan) => String(plan.browserSession.axiPort)),
    );
    const client = createClient(config);
    const runResult = await runWithAdaptiveConcurrency({
      items: assignments,
      initialConcurrency: config.agentConcurrency,
      maxConcurrency: assignments.length,
      adaptive: config.agentConcurrencyMode === "auto",
      ...(signal ? { signal } : {}),
      snapshot: resourceSampler.latest,
      onDecision: async (decision) => {
        adaptiveDecisions.push(decision);
        await logger.info("Adaptive concurrency changed", { ...decision });
      },
      worker: async (assignment): Promise<AgentRunReport> => {
        const plan = sessionPlans.get(assignment.agentId);
        if (signal?.aborted) {
          throw new Error("Run cancelled.");
        }
        if (!plan) {
          throw new Error(`Missing browser session plan for ${assignment.agentId}.`);
        }
        const { agentPaths, browserSession } = plan;
        try {
          await ensureAgentDirectories(agentPaths);
          const agentStartedAt = Date.now();
          firstAgentStartMs ||= agentStartedAt - runStartedAt;
          const portAvailable = await isPortAvailable(browserSession.axiPort);
          browserSession.axiPortConflict = !portAvailable;
          browserSession.sessionIsolationValid =
            portAvailable &&
            profileConflicts === 0 &&
            tempDirCollisions === 0 &&
            portPlanCollisions === 0;
          if (!portAvailable) {
            portCollisions += 1;
          }
          await writeAxiHelper(agentPaths);
          if (config.mode === "cursor-cli" && config.chromeMode === "axi") {
            const startup = await startAxiBridge(browserSession);
            browserSession.axiStartupMs = startup.startupMs;
            browserSession.axiStartupFailed = startup.failed;
            browserSession.axiBridgePids = startup.pids;
            if (startup.failed) {
              startupFailures += 1;
              await logger.warn("AXI bridge startup failed for agent", {
                agentId: assignment.agentId,
                axiPort: browserSession.axiPort,
                output: startup.output.slice(0, 1_000),
              });
            }
          }
          await logger.info("Starting agent assignment", {
            agentId: assignment.agentId,
            routeCount: assignment.routes.length,
            promptPath: agentPaths.promptPath,
            browserSession: {
              axiPort: browserSession.axiPort,
              homeDir: browserSession.homeDir,
              startupMs: browserSession.axiStartupMs,
              portConflict: browserSession.axiPortConflict ?? false,
            },
          });
          const missionPrompt = buildMissionPrompt({
            agentId: assignment.agentId,
            repoPath: config.repoPath,
            baseUrl: config.baseUrl,
            assignment,
            instructions: instructions ?? "",
            secrets: config.secrets,
            secretsEnvPrefix: config.secretsEnvPrefix,
            chromeMode: config.chromeMode,
            artifactDir: agentPaths.agentDir,
            axiHelperPath: agentPaths.axiHelperPath,
            maxRouteSteps: config.maxRouteSteps,
            model: config.model,
            contextPacket,
            browserSession,
          });
          const result = await createAgentRun(client, {
            agentId: assignment.agentId,
            assignment,
            repoPath: config.repoPath,
            runId: config.runId,
            artifactPaths: agentPaths,
            eventsPath: artifacts.eventsPath,
            missionPrompt,
            mode: config.mode,
            baseUrl: config.baseUrl,
            ...(config.model ? { model: config.model } : {}),
            secretEnv: buildSecretEnv(config.secrets),
            secrets: config.secrets,
            secretsEnvPrefix: config.secretsEnvPrefix,
            maxRouteSteps: config.maxRouteSteps,
            chromeMode: config.chromeMode,
            browserSession,
            ...(signal ? { signal } : {}),
          });
          await logger.info("Agent assignment finished", {
            agentId: assignment.agentId,
            status: result.status,
          });
          lastAgentCompleteMs = Math.max(lastAgentCompleteMs, Date.now() - runStartedAt);

          return (
            result.report ?? {
              agentId: assignment.agentId,
              assignment,
              mode: config.mode,
              status: result.status,
              reportPath: agentPaths.reportPath,
              screenshots: [],
              handoffPath: agentPaths.handoffPath,
              promptPath: agentPaths.promptPath,
              stdoutPath: agentPaths.stdoutPath,
              stderrPath: agentPaths.stderrPath,
              findings: [],
              notes: ["Agent run completed without an inline report."],
              ...(result.externalUrl ? { externalUrl: result.externalUrl } : {}),
            }
          );
        } finally {
          if (config.mode === "cursor-cli" && config.chromeMode === "axi") {
            const stoppedPids = await stopAxiBridgeForPort(browserSession.axiPort);
            if (stoppedPids.length > 0) {
              await logger.info("Stopped AXI bridge for agent", {
                agentId: assignment.agentId,
                axiPort: browserSession.axiPort,
                pids: stoppedPids,
              });
            }
          }
        }
      },
    });
    const reports = runResult.results;

    const runCompletedAt = Date.now();
    const summary = summarizeFindings({
      runId: config.runId,
      appName: config.routeConfig.appName,
      mode: config.mode,
      startedAt: runStartedAtIso,
      completedAt: new Date(runCompletedAt).toISOString(),
      durationMs: runCompletedAt - runStartedAt,
      agents: reports.length,
      routesTested: config.routeConfig.routes.length,
      reports,
    });
    await writeRunReport(summary, artifacts.runDir);
    if (config.mode === "cursor-cli" && config.chromeMode === "axi") {
      const cleanup = await cleanupRunBrowserTools({
        runDir: artifacts.runDir,
        axiPorts: plannedAxiPorts(config),
      });
      if (cleanup.bridgePids.length > 0 || cleanup.watchdogPids.length > 0) {
        await logger.info("Cleaned up browser tool processes", { ...cleanup });
      }
    }
    const chromeProcessCountAfter = await countChromeProcesses();
    const resourceSummary = resourceSampler.summary();
    const instrumentation: BenchmarkInstrumentation = {
      preflightMs,
      firstAgentStartMs,
      lastAgentCompleteMs,
      totalWallClockMs: runCompletedAt - runStartedAt,
      memoryPeakMb,
      systemMemoryPeakPercent: resourceSummary.peakSystemMemoryPercent,
      systemLoadPeak1m: resourceSummary.peakLoadAverage1m,
      chromeProcessesSpawned: Math.max(chromeProcessCountAfter - chromeProcessCountBefore, 0),
      portCollisions: portCollisions + portPlanCollisions,
      startupFailures,
      profileConflicts,
      tempDirCollisions,
      stateBleedEvents: 0,
      resourceSamplesPath: artifacts.resourceSamplesPath,
      initialConcurrency: config.agentConcurrency,
      maxObservedConcurrency: runResult.maxObservedConcurrency,
      adaptiveDecisions: adaptiveDecisions.length,
    };
    await writeBenchmarkReport({
      summary,
      config,
      instrumentation,
      runDir: artifacts.runDir,
    });
    await logger.info("Final report written", {
      finalReportPath: artifacts.finalReportPath,
      issuesFound: summary.issuesFound,
    });
    return {
      config,
      finalReportPath: artifacts.finalReportPath,
      metricsPath: artifacts.metricsJsonPath,
      benchmarkJsonPath: artifacts.benchmarkJsonPath,
      benchmarkCsvPath: artifacts.benchmarkCsvPath,
    };
  } catch (error) {
    await logger.error("Run failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearInterval(memorySampler);
    resourceSampler.stop();
    if (config.mode === "cursor-cli" && config.chromeMode === "axi") {
      const cleanup = await cleanupRunBrowserTools({
        runDir: artifacts.runDir,
        axiPorts: plannedAxiPorts(config),
      });
      if (cleanup.bridgePids.length > 0 || cleanup.watchdogPids.length > 0) {
        await logger.info("Cleaned up browser tool processes", { ...cleanup });
      }
    }
    await devServer?.stop();
  }
}
