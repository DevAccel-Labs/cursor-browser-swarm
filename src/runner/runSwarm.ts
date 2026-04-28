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
}> {
  const startedAt = Date.now();
  const result = await execa("npx", ["-y", "chrome-devtools-axi", "start"], {
    all: true,
    env: browserSessionEnv(session),
    reject: false,
    timeout: 45_000,
  });
  return {
    startupMs: Date.now() - startedAt,
    failed: result.exitCode !== 0,
    output: result.all ?? "",
  };
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

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex] as T);
      }
    }),
  );
  return results;
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
    agentConcurrency: cli.agentConcurrency,
    assignmentStrategy: cli.assignmentStrategy,
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
  await logger.info("Run initialized", {
    runId: config.runId,
    mode: config.mode,
    chromeMode: config.chromeMode,
    agents: config.agents,
    agentConcurrency: config.agentConcurrency,
    routes: config.routeConfig.routes.length,
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
        preflightMs = Date.now() - preflightStartedAt;
        await logger.info("AXI preflight passed", { screenshotPath: preflight.screenshotPath });
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
    );
    await logger.debug("Created route assignments", {
      assignments: assignments.map((assignment) => ({
        agentId: assignment.agentId,
        routes: assignment.routes.map((route) => route.path),
      })),
    });
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
    const reports = await runWithConcurrency(
      assignments,
      config.agentConcurrency,
      async (assignment): Promise<AgentRunReport> => {
        const plan = sessionPlans.get(assignment.agentId);
        if (!plan) {
          throw new Error(`Missing browser session plan for ${assignment.agentId}.`);
        }
        const { agentPaths, browserSession } = plan;
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
      },
    );

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
    const chromeProcessCountAfter = await countChromeProcesses();
    const instrumentation: BenchmarkInstrumentation = {
      preflightMs,
      firstAgentStartMs,
      lastAgentCompleteMs,
      totalWallClockMs: runCompletedAt - runStartedAt,
      memoryPeakMb,
      chromeProcessesSpawned: Math.max(chromeProcessCountAfter - chromeProcessCountBefore, 0),
      portCollisions: portCollisions + portPlanCollisions,
      startupFailures,
      profileConflicts,
      tempDirCollisions,
      stateBleedEvents: 0,
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
    await devServer?.stop();
  }
}
