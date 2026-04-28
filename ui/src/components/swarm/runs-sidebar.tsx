import { useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Star,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  HelpCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { UiRunListItem, RunStatus } from "@/lib/types"

interface RunsSidebarProps {
  runs: UiRunListItem[]
  pinnedIds: string[]
  selectedRunId: string | null
  onSelectRun: (id: string) => void
  onTogglePin: (id: string) => void
  onRefresh: () => void
  isLoading?: boolean
}

function formatRunTime(timestamp?: string): string {
  if (!timestamp) return "unknown time"
  try {
    return new Date(timestamp).toLocaleString()
  } catch {
    return timestamp
  }
}

function StatusIcon({ status }: { status: RunStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-3 animate-spin text-blue-400" />
    case "succeeded":
      return <CheckCircle2 className="size-3 text-green-400" />
    case "failed":
      return <XCircle className="size-3 text-red-400" />
    case "cancelled":
      return <AlertCircle className="size-3 text-yellow-400" />
    default:
      return <HelpCircle className="size-3 text-muted-foreground" />
  }
}

export function RunsSidebar({
  runs,
  pinnedIds,
  selectedRunId,
  onSelectRun,
  onTogglePin,
  onRefresh,
  isLoading,
}: RunsSidebarProps) {
  const [collapsed, setCollapsed] = useState(true)

  const pinnedSet = new Set(pinnedIds)
  const pinnedRuns = pinnedIds
    .filter((id) => runs.some((r) => r.id === id))
    .map((id) => runs.find((r) => r.id === id)!)
  const unpinnedRuns = runs.filter((r) => !pinnedSet.has(r.id))

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-linear",
        collapsed ? "w-14" : "w-72"
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 border-b border-sidebar-border py-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCollapsed(false)}
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="Expand runs sidebar"
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="Refresh runs"
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
          </Button>
          {runs.length > 0 && (
            <span
              className="tabular-nums text-[10px] font-medium text-sidebar-foreground/55"
              title={`${runs.length} run${runs.length === 1 ? "" : "s"}`}
            >
              {runs.length}
            </span>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-sidebar-border p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-sidebar-foreground/70">
              Runs
            </h2>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCollapsed(true)}
                className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                aria-label="Collapse runs sidebar"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onRefresh}
                disabled={isLoading}
                className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                aria-label="Refresh runs"
              >
                <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2">
              {runs.length === 0 && (
                <p className="px-2 py-8 text-center text-sm text-sidebar-foreground/60">No runs yet</p>
              )}

              {pinnedRuns.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/55">
                    Pinned
                  </div>
                  {pinnedRuns.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      isPinned
                      isSelected={run.id === selectedRunId}
                      onSelect={() => onSelectRun(run.id)}
                      onTogglePin={() => onTogglePin(run.id)}
                    />
                  ))}
                </>
              )}

              {unpinnedRuns.length > 0 && (
                <>
                  {pinnedRuns.length > 0 && (
                    <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/55">
                      All Runs
                    </div>
                  )}
                  {unpinnedRuns.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      isPinned={false}
                      isSelected={run.id === selectedRunId}
                      onSelect={() => onSelectRun(run.id)}
                      onTogglePin={() => onTogglePin(run.id)}
                    />
                  ))}
                </>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </aside>
  )
}

interface RunRowProps {
  run: UiRunListItem
  isPinned: boolean
  isSelected: boolean
  onSelect: () => void
  onTogglePin: () => void
}

function RunRow({ run, isPinned, isSelected, onSelect, onTogglePin }: RunRowProps) {
  return (
    <div className="flex items-stretch gap-1 rounded-md py-0.5 pr-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={(e) => {
          e.stopPropagation()
          onTogglePin()
        }}
        className={cn(
          "shrink-0",
          isPinned
            ? "text-amber-400 hover:bg-transparent hover:text-amber-300"
            : cn(
                isSelected
                  ? "text-accent-foreground/70 hover:bg-transparent hover:text-accent-foreground"
                  : "text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )
        )}
      >
        <Star className={cn("size-3.5 stroke-[1.75]", isPinned && "fill-current")} />
      </Button>

      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isSelected
            ? "border border-border bg-accent text-accent-foreground shadow-sm"
            : "border border-transparent text-sidebar-foreground hover:bg-muted/60"
        )}
      >
        <div className="flex items-center gap-2">
          <StatusIcon status={run.status} />
          <span className="truncate text-sm font-medium">
            {run.appName || run.id}
          </span>
        </div>
        <span
          className={cn(
            "text-xs tabular-nums",
            isSelected ? "text-accent-foreground/80" : "text-sidebar-foreground/70"
          )}
        >
          {formatRunTime(run.startedAt)}
        </span>
        <span
          className={cn(
            "text-xs capitalize",
            isSelected ? "text-accent-foreground/80" : "text-sidebar-foreground/70"
          )}
        >
          {run.status}
          {run.agents !== undefined && ` · ${run.agents} agents`}
          {run.issuesFound !== undefined && ` · ${run.issuesFound} issues`}
        </span>
      </button>
    </div>
  )
}
