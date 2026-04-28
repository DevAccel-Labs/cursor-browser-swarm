import { eventHandler, readBody, setResponseStatus, type H3Event } from "h3"
import { getRunsStore, makeRunId, type UiRunState } from "../../lib/runs-store"
import { homedir } from "node:os"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

interface RunRequest {
  appName: string
  baseUrl: string
  routes: Array<{ path: string; goal: string; hints?: string[]; severityFocus?: string[] }>
  instructions?: string
  secrets?: Array<{ key: string; value: string }>
  agents?: number | string
  agentConcurrency?: number | string
  agentPersonas?: string
  agentDirectives?: string
  mode?: string
  chromeMode?: string
  model?: string
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
      path: r.path.trim(),
      goal: r.goal.trim(),
      hints: r.hints?.filter(Boolean) ?? [],
      severityFocus: r.severityFocus?.length ? r.severityFocus : ["console", "network", "visual"],
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

  // TODO: Actually call runSwarmWithSignal here
  // For now, simulate a run that completes after a delay
  setTimeout(() => {
    const current = store.getRunState(runId)
    if (current && current.status === "running") {
      current.status = "succeeded"
      current.endedAt = new Date().toISOString()
      current.finalReportPath = path.join(outDir, "final-report.md")
    }
  }, 5000)

  setResponseStatus(event, 202)
  const { controller: _, ...publicState } = state
  return publicState
})
