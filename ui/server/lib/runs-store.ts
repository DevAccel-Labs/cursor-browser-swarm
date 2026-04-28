import { homedir } from "node:os"
import { readdir, readFile, access } from "node:fs/promises"
import path from "node:path"

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled" | "unknown"

export interface UiRunState {
  id: string
  status: RunStatus
  startedAt: string
  endedAt?: string
  baseUrl: string
  outDir: string
  routesPath: string
  eventsPath: string
  instructionsPath?: string
  envPath?: string
  finalReportPath?: string
  metricsPath?: string
  benchmarkJsonPath?: string
  benchmarkCsvPath?: string
  error?: string
  controller?: AbortController
}

export interface UiRunListItem {
  id: string
  status: RunStatus
  startedAt?: string
  endedAt?: string
  appName?: string
  baseUrl?: string
  outDir: string
  agents?: number
  issuesFound?: number
}

const uiRuns = new Map<string, UiRunState>()
const runsRoot = path.join(homedir(), ".cursor-browser-swarm", "runs")

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T
  } catch {
    return undefined
  }
}

function timestampFromUiStyleRunId(id: string): number | undefined {
  const match = /^ui-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(id)
  if (!match) return undefined
  const [, y, mo, d, h, mi, s] = match
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  return Number.isFinite(ms) ? ms : undefined
}

function runListSortTimeMs(run: { id: string; startedAt?: string }): number {
  if (run.startedAt) {
    const fromIso = Date.parse(run.startedAt)
    if (!Number.isNaN(fromIso)) return fromIso
  }
  return timestampFromUiStyleRunId(run.id) ?? 0
}

async function listDiskRuns(): Promise<UiRunListItem[]> {
  const items: UiRunListItem[] = []
  try {
    const apps = await readdir(runsRoot, { withFileTypes: true })
    for (const app of apps) {
      if (!app.isDirectory()) continue
      const appDir = path.join(runsRoot, app.name)
      const runs = await readdir(appDir, { withFileTypes: true })
      for (const run of runs) {
        if (!run.isDirectory()) continue
        const runDir = path.join(appDir, run.name)
        const summary = await readJsonFile<{
          appName?: string
          startedAt?: string
          completedAt?: string
          agents?: number
          issuesFound?: number
        }>(path.join(runDir, "summary.json"))
        const routeConfig = await readJsonFile<{ baseUrl?: string }>(
          path.join(runDir, "config", "swarm.routes.json")
        )
        const finalReportExists = await fileExists(path.join(runDir, "final-report.md"))
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
        })
      }
    }
  } catch {
    return items
  }
  return items
}

class RunsStore {
  async listRuns(): Promise<UiRunListItem[]> {
    const diskRuns = await listDiskRuns()
    const byId = new Map(diskRuns.map((run) => [run.id, run]))
    for (const state of uiRuns.values()) {
      byId.set(state.id, {
        id: state.id,
        status: state.status,
        startedAt: state.startedAt,
        endedAt: state.endedAt,
        baseUrl: state.baseUrl,
        outDir: state.outDir,
      })
    }
    return [...byId.values()].sort((left, right) => {
      const diff = runListSortTimeMs(right) - runListSortTimeMs(left)
      if (diff !== 0) return diff
      return right.id.localeCompare(left.id)
    })
  }

  getRunState(runId: string): UiRunState | undefined {
    return uiRuns.get(runId)
  }

  async getRunStateOrDisk(runId: string): Promise<UiRunState | undefined> {
    const memState = uiRuns.get(runId)
    if (memState) return memState

    try {
      const apps = await readdir(runsRoot, { withFileTypes: true })
      for (const app of apps) {
        if (!app.isDirectory()) continue
        const runDir = path.join(runsRoot, app.name, runId)
        if (await fileExists(runDir)) {
          const summary = await readJsonFile<{
            startedAt?: string
            completedAt?: string
          }>(path.join(runDir, "summary.json"))
          const routeConfig = await readJsonFile<{ baseUrl?: string }>(
            path.join(runDir, "config", "swarm.routes.json")
          )
          const finalReportExists = await fileExists(path.join(runDir, "final-report.md"))
          return {
            id: runId,
            status: finalReportExists ? "succeeded" : "failed",
            startedAt: summary?.startedAt ?? runId,
            ...(summary?.completedAt ? { endedAt: summary.completedAt } : {}),
            baseUrl: routeConfig?.baseUrl ?? "",
            outDir: runDir,
            routesPath: path.join(runDir, "config", "swarm.routes.json"),
            eventsPath: path.join(runDir, "events.jsonl"),
            finalReportPath: path.join(runDir, "final-report.md"),
            metricsPath: path.join(runDir, "metrics.json"),
            benchmarkJsonPath: path.join(runDir, "benchmark.json"),
            benchmarkCsvPath: path.join(runDir, "benchmark.csv"),
          }
        }
      }
    } catch {
      return undefined
    }
    return undefined
  }

  setRunState(runId: string, state: UiRunState): void {
    uiRuns.set(runId, state)
  }

  async getEvents(runId: string): Promise<string> {
    const state = await this.getRunStateOrDisk(runId)
    if (!state) return ""
    try {
      return await readFile(state.eventsPath, "utf8")
    } catch {
      return ""
    }
  }

  async getReport(runId: string): Promise<string | undefined> {
    const state = await this.getRunStateOrDisk(runId)
    if (!state?.finalReportPath) return undefined
    try {
      return await readFile(state.finalReportPath, "utf8")
    } catch {
      return undefined
    }
  }

  cancelRun(runId: string): UiRunState | undefined {
    const state = uiRuns.get(runId)
    if (!state || state.status !== "running") return state
    state.status = "cancelled"
    state.endedAt = new Date().toISOString()
    state.error = "Run cancelled by user."
    state.controller?.abort()
    return state
  }
}

let storeInstance: RunsStore | undefined

export function getRunsStore(): RunsStore {
  if (!storeInstance) {
    storeInstance = new RunsStore()
  }
  return storeInstance
}

export function makeRunId(now = new Date()): string {
  return `ui-${now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")}`
}
