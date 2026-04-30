import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { eventHandler, readBody, setResponseStatus } from "h3"
import { loadEnvFile } from "../../../../src/env"
import {
  parseAgentConcurrency,
  parseAgents,
  parseAssignmentStrategy,
  parseAxiPortBase,
  parseRouteSteps,
  parseRunMode,
} from "../../../../src/config"
import { parseCustomAgentDirective } from "../../../../src/runner/agentDirectives"
import { runSwarmWithSignal } from "../../../../src/runner/runSwarm"
import { getRunsStore, makeRunId } from "../../lib/runs-store"
import type { H3Event } from "h3"
import type {
  AgentConcurrency,
  ChromeMode,
  SwarmCliOptions,
  SwarmSecret,
} from "../../../../src/types"
import type { UiRunState } from "../../lib/runs-store"

interface RunRequest {
  appName: string
  baseUrl: string
  routes: Array<{
    id?: string
    title?: string
    path: string
    goal: string
    hints?: Array<string>
    severityFocus?: Array<string>
    seedRequirements?: Array<string>
    baselineAssertions?: Array<string>
    passCriteria?: Array<string>
    expectedOutOfScope?: Array<string>
    telemetryExpectations?: {
      websocket?: "expected" | "silent" | "optional"
      network?: "expected" | "silent" | "optional"
      notes?: Array<string>
    }
    minimumFixture?: {
      description?: string
      rows: Array<{
        id?: string
        label: string
        fields: Record<string, string | number | boolean | null>
      }>
      relationships?: Array<string>
      requiredCounts?: Record<string, number>
    }
  }>
  instructions?: string
  secrets?: Array<{ key: string; value: string }>
  agents?: number | string
  agentConcurrency?: number | string
  agentPersonas?: string
  agentDirectives?: string
  mode?: string
  chromeMode?: string
  model?: string
  agentCommand?: string
  cursorCommand?: string
  noDevServer?: boolean
  maxRouteSteps?: number | string
  assignmentStrategy?: string
  axiPortBase?: number | string
}

function safePathSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80) || "browser-app"
  )
}

function defaultOutDir(appName: string, runId: string): string {
  return path.join(homedir(), ".cursor-browser-swarm", "runs", safePathSegment(appName), runId)
}

function repoRoot(): string {
  return path.basename(process.cwd()) === "ui" ? path.resolve(process.cwd(), "..") : process.cwd()
}

function publicRunState(state: UiRunState): Omit<UiRunState, "controller"> {
  const { controller: _controller, ...publicState } = state
  return publicState
}

function parseOptionalAxiPortBase(value: number | string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined
  }
  return parseAxiPortBase(String(value))
}

function parseSecrets(secrets: RunRequest["secrets"]): Array<SwarmSecret> {
  return (secrets ?? [])
    .filter((secret) => secret.key.trim() && secret.value)
    .map((secret) => ({
      key: secret.key.trim(),
      value: secret.value,
    }))
}

function parseAgentDirectiveLines(value: string | undefined): Array<string> {
  if (!value?.trim()) {
    return []
  }
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function buildCliOptions(input: {
  body: RunRequest
  runId: string
  outDir: string
  routesPath: string
  instructionsPath: string | undefined
}): SwarmCliOptions {
  const agents = parseAgents(String(input.body.agents ?? "4"))
  const agentConcurrency: AgentConcurrency = parseAgentConcurrency(
    String(input.body.agentConcurrency ?? "auto"),
    agents
  )
  const mode = parseRunMode(input.body.mode ?? "cursor-cli")
  const chromeMode = (input.body.chromeMode ?? "axi") as ChromeMode

  const options: SwarmCliOptions = {
    repo: repoRoot(),
    noDevServer: input.body.noDevServer ?? true,
    baseUrl: input.body.baseUrl.trim(),
    routesPath: input.routesPath,
    secrets: parseSecrets(input.body.secrets),
    secretEnv: {},
    secretsEnvPrefix: "SWARM_SECRET_",
    interactiveSecrets: false,
    agents,
    agentConcurrency,
    assignmentStrategy: parseAssignmentStrategy(input.body.assignmentStrategy ?? "replicate"),
    agentDirectives: parseAgentDirectiveLines(input.body.agentDirectives).map((line) =>
      parseCustomAgentDirective(line)
    ),
    agentPersonas: input.body.agentPersonas,
    mode,
    runId: input.runId,
    outDir: input.outDir,
    agentCommand:
      input.body.agentCommand?.trim() ||
      input.body.cursorCommand?.trim() ||
      (mode === "copilot-cli" ? "copilot" : "agent"),
    cursorCommand: input.body.cursorCommand?.trim() || undefined,
    model: input.body.model?.trim() || undefined,
    chromeMode,
    axiPortBase: parseOptionalAxiPortBase(input.body.axiPortBase),
    maxRouteSteps: parseRouteSteps(String(input.body.maxRouteSteps ?? "12")),
  }

  if (input.instructionsPath) {
    options.instructionsPath = input.instructionsPath
  }

  return options
}

export default eventHandler(async (event: H3Event) => {
  const body = (await readBody(event)) as RunRequest

  if (!body.appName || !body.baseUrl || !Array.isArray(body.routes)) {
    setResponseStatus(event, 400)
    return { error: "Invalid run request. Required: appName, baseUrl, routes[]" }
  }

  const store = getRunsStore()
  const runId = makeRunId()
  const outDir = defaultOutDir(body.appName.trim() || "Browser App", runId)
  const configDir = path.join(outDir, "config")
  const routesPath = path.join(configDir, "swarm.routes.json")
  const eventsPath = path.join(outDir, "events.jsonl")
  const instructionsPath = body.instructions?.trim()
    ? path.join(configDir, "swarm.instructions.md")
    : undefined

  await mkdir(configDir, { recursive: true })

  const routeConfig = {
    appName: body.appName.trim() || "Browser App",
    baseUrl: body.baseUrl.trim(),
    routes: body.routes.map((r) => ({
      ...(r.id?.trim() ? { id: r.id.trim() } : {}),
      ...(r.title?.trim() ? { title: r.title.trim() } : {}),
      path: r.path.trim(),
      goal: r.goal.trim(),
      hints: r.hints?.filter(Boolean) ?? [],
      severityFocus: r.severityFocus?.length ? r.severityFocus : ["console", "network", "visual"],
      seedRequirements: r.seedRequirements?.filter(Boolean) ?? [],
      baselineAssertions: r.baselineAssertions?.filter(Boolean) ?? [],
      passCriteria: r.passCriteria?.filter(Boolean) ?? [],
      expectedOutOfScope: r.expectedOutOfScope?.filter(Boolean) ?? [],
      ...(r.telemetryExpectations ? { telemetryExpectations: r.telemetryExpectations } : {}),
      ...(r.minimumFixture ? { minimumFixture: r.minimumFixture } : {}),
    })),
  }

  await writeFile(routesPath, JSON.stringify(routeConfig, null, 2) + "\n")

  if (body.instructions?.trim() && instructionsPath) {
    await writeFile(instructionsPath, body.instructions.trim() + "\n")
  }

  const state: UiRunState = {
    id: runId,
    status: "running",
    startedAt: new Date().toISOString(),
    baseUrl: body.baseUrl.trim(),
    outDir,
    routesPath,
    eventsPath,
    instructionsPath,
    controller: new AbortController(),
  }

  store.setRunState(runId, state)

  const cliOptions = buildCliOptions({ body, runId, outDir, routesPath, instructionsPath })
  await loadEnvFile(repoRoot())

  void runSwarmWithSignal(cliOptions, state.controller?.signal)
    .then((result) => {
      const current = store.getRunState(runId)
      if (!current || current.status === "cancelled") {
        return
      }
      current.status = "succeeded"
      current.endedAt = new Date().toISOString()
      current.finalReportPath = result.finalReportPath
      current.metricsPath = result.metricsPath
      current.benchmarkJsonPath = result.benchmarkJsonPath
      current.benchmarkCsvPath = result.benchmarkCsvPath
    })
    .catch((error: unknown) => {
      const current = store.getRunState(runId)
      if (!current) {
        return
      }
      current.status = current.controller?.signal.aborted ? "cancelled" : "failed"
      current.endedAt = new Date().toISOString()
      current.error = current.controller?.signal.aborted
        ? "Run cancelled by user."
        : error instanceof Error
          ? error.message
          : String(error)
    })

  setResponseStatus(event, 202)
  return publicRunState(state)
})
