import { createFileRoute } from "@tanstack/react-router"
import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RunsSidebar } from "@/components/swarm/runs-sidebar"
import { ConfigForm } from "@/components/swarm/config-form"
import { ActivityView } from "@/components/swarm/activity-view"
import { StatusPanel } from "@/components/swarm/status-panel"
import type {
  DefaultsResponse,
  AgentReportPreview,
  RunPreviewResponse,
  UiRunListItem,
  UiRunState,
  FormState,
} from "@/lib/types"

export const Route = createFileRoute("/")({ component: SwarmDashboard })

const STORAGE_KEYS = {
  pinnedRuns: "cursor-browser-swarm.ui.pinnedRunIds",
  activeRun: "cursor-browser-swarm.ui.activeRunId",
  selectedRun: "cursor-browser-swarm.ui.selectedRunId",
}

function loadPinnedIds(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.pinnedRuns)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []
  } catch {
    return []
  }
}

function savePinnedIds(ids: string[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEYS.pinnedRuns, JSON.stringify(ids))
  }
}

function SwarmDashboard() {
  const [activeView, setActiveView] = useState<"config" | "activity">("config")
  const [defaults, setDefaults] = useState<DefaultsResponse | null>(null)
  const [runs, setRuns] = useState<UiRunListItem[]>([])
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [currentRunState, setCurrentRunState] = useState<UiRunState | null>(null)
  const [events, setEvents] = useState("")
  const [report, setReport] = useState<string | null>(null)
  const [previewReports, setPreviewReports] = useState<AgentReportPreview[]>([])
  const [isLoadingRuns, setIsLoadingRuns] = useState(false)

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [defaultsRes, runsRes] = await Promise.all([
          fetch("/api/defaults").then((r) => r.json()),
          fetch("/api/runs").then((r) => r.json()),
        ])
        setDefaults(defaultsRes)
        setRuns(runsRes.runs || [])
        setPinnedIds(loadPinnedIds())

        const savedActive = localStorage.getItem(STORAGE_KEYS.activeRun)
        const savedSelected = localStorage.getItem(STORAGE_KEYS.selectedRun)
        if (savedActive) setActiveRunId(savedActive)
        if (savedSelected) setSelectedRunId(savedSelected)
        else if (runsRes.runs?.[0]?.id) setSelectedRunId(runsRes.runs[0].id)
      } catch (error) {
        toast.error("Failed to load initial data")
        console.error(error)
      }
    }
    loadInitialData()
  }, [])

  // Poll selected run
  useEffect(() => {
    if (!selectedRunId) return

    const pollRun = async () => {
      try {
        const [stateRes, eventsRes] = await Promise.all([
          fetch(`/api/runs/${encodeURIComponent(selectedRunId)}`).then((r) => r.json()),
          fetch(`/api/runs/${encodeURIComponent(selectedRunId)}/events`).then((r) => r.text()),
        ])
        setCurrentRunState(stateRes)
        setEvents(eventsRes)

        const previewRes = (await fetch(
          `/api/runs/${encodeURIComponent(selectedRunId)}/preview`
        ).then((r) => (r.ok ? r.json() : { reports: [] }))) as RunPreviewResponse
        setPreviewReports(previewRes.reports || [])

        if (stateRes.status === "succeeded" && stateRes.finalReportPath) {
          const reportRes = await fetch(
            `/api/runs/${encodeURIComponent(selectedRunId)}/report`
          ).then((r) => r.text())
          setReport(reportRes)
        }

        if (stateRes.status === "running") {
          return true // continue polling
        }

        if (activeRunId === selectedRunId) {
          setActiveRunId(null)
          localStorage.removeItem(STORAGE_KEYS.activeRun)
        }
        return false
      } catch (error) {
        console.error("Poll error:", error)
        return false
      }
    }

    let timeoutId: ReturnType<typeof setTimeout>
    const poll = async () => {
      const shouldContinue = await pollRun()
      if (shouldContinue) {
        timeoutId = setTimeout(poll, 2000)
      }
    }

    poll()
    return () => clearTimeout(timeoutId)
  }, [selectedRunId, activeRunId])

  const refreshRuns = useCallback(async () => {
    setIsLoadingRuns(true)
    try {
      const res = await fetch("/api/runs").then((r) => r.json())
      setRuns(res.runs || [])
      // Prune stale pinned IDs
      const validIds = new Set((res.runs || []).map((r: UiRunListItem) => r.id))
      setPinnedIds((prev) => {
        const pruned = prev.filter((id) => validIds.has(id))
        if (pruned.length !== prev.length) savePinnedIds(pruned)
        return pruned
      })
    } catch {
      toast.error("Failed to refresh runs")
    } finally {
      setIsLoadingRuns(false)
    }
  }, [])

  const selectRun = useCallback((id: string) => {
    setSelectedRunId(id)
    setReport(null)
    setEvents("")
    setPreviewReports([])
    setCurrentRunState(null)
    localStorage.setItem(STORAGE_KEYS.selectedRun, id)
  }, [])

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
      savePinnedIds(next)
      return next
    })
  }, [])

  const handleSubmit = useCallback(async (formState: FormState) => {
    try {
      const payload = {
        appName: formState.appName,
        baseUrl: formState.baseUrl,
        routes: formState.routes,
        instructions: formState.instructions,
        secrets: formState.secrets.filter((s) => s.key && s.value),
        agents: formState.agents,
        agentConcurrency: formState.agentConcurrency,
        agentPersonas: formState.agentPersonas.join(","),
        agentDirectives: formState.agentDirectives,
        mode: formState.mode,
        chromeMode: formState.chromeMode,
        model: formState.model,
        cursorCommand: formState.cursorCommand,
        maxRouteSteps: formState.maxRouteSteps,
        assignmentStrategy: formState.assignmentStrategy,
        axiPortBase: formState.axiPortBase,
        noDevServer: formState.noDevServer,
      }

      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const state = await res.json()
      if (!res.ok) {
        toast.error(state.error || "Failed to start run")
        return
      }

      toast.success(`Started run ${state.id}`)
      setActiveRunId(state.id)
      setSelectedRunId(state.id)
      localStorage.setItem(STORAGE_KEYS.activeRun, state.id)
      localStorage.setItem(STORAGE_KEYS.selectedRun, state.id)
      setCurrentRunState(state)
      setPreviewReports([])
      refreshRuns()
    } catch (error) {
      toast.error("Failed to start run")
      console.error(error)
    }
  }, [refreshRuns])

  const handleCancel = useCallback(async () => {
    if (!activeRunId) return

    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(activeRunId)}/cancel`, {
        method: "POST",
      })
      const state = await res.json()
      setCurrentRunState(state)
      toast.info("Run cancelled")
      setActiveRunId(null)
      localStorage.removeItem(STORAGE_KEYS.activeRun)
      refreshRuns()
    } catch {
      toast.error("Failed to cancel run")
    }
  }, [activeRunId, refreshRuns])

  return (
    <div className="flex h-svh flex-col">
      {/* Header */}
      <header className="shrink-0 border-b bg-card px-5 py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
              Cursor Browser Swarm
            </p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight">
              Launch browser-validation agents
            </h1>
            <p className="mt-0.5 hidden max-w-2xl text-xs text-muted-foreground sm:block">
              Point at a running app, describe the routes, choose the model, and let Cursor CLI
              agents validate with AXI browser tooling.
            </p>
          </div>
          <Tabs value={activeView} onValueChange={(v) => setActiveView(v as "config" | "activity")}>
            <TabsList>
              <TabsTrigger value="config">Config</TabsTrigger>
              <TabsTrigger value="activity">Activity Log</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <RunsSidebar
          runs={runs}
          pinnedIds={pinnedIds}
          selectedRunId={selectedRunId}
          onSelectRun={selectRun}
          onTogglePin={togglePin}
          onRefresh={refreshRuns}
          isLoading={isLoadingRuns}
        />

        {/* Workspace */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeView === "config" ? (
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto max-w-4xl space-y-4 p-5">
                <ConfigForm
                  defaults={defaults}
                  isRunning={activeRunId !== null}
                  onSubmit={handleSubmit}
                  onCancel={handleCancel}
                />
                <StatusPanel
                  runState={currentRunState}
                  events={events}
                  report={report}
                  previewReports={previewReports}
                />
              </div>
            </ScrollArea>
          ) : (
            <ActivityView events={events} />
          )}
        </main>
      </div>
    </div>
  )
}
