import { Star, RefreshCw, CheckCircle2, XCircle, Loader2, AlertCircle, HelpCircle } from "lucide-react"
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
  const pinnedSet = new Set(pinnedIds)
  const pinnedRuns = pinnedIds
    .filter((id) => runs.some((r) => r.id === id))
    .map((id) => runs.find((r) => r.id === id)!)
  const unpinnedRuns = runs.filter((r) => !pinnedSet.has(r.id))

  return (
    <aside className="flex h-full w-72 flex-col border-r bg-card">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Runs
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRefresh}
          disabled={isLoading}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {runs.length === 0 && (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">No runs yet</p>
          )}

          {pinnedRuns.length > 0 && (
            <>
              <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
    <div className="flex items-stretch gap-1 py-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={(e) => {
          e.stopPropagation()
          onTogglePin()
        }}
        className={cn(
          "shrink-0 text-muted-foreground",
          isPinned && "text-yellow-500 hover:text-yellow-400"
        )}
      >
        <Star className={cn("size-3.5", isPinned && "fill-current")} />
      </Button>

      <button
        onClick={onSelect}
        className={cn(
          "flex flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
          "hover:bg-accent",
          isSelected && "bg-accent"
        )}
      >
        <div className="flex items-center gap-2">
          <StatusIcon status={run.status} />
          <span className="truncate text-sm font-medium">{run.appName || run.id}</span>
        </div>
        <span className="text-xs text-muted-foreground">{formatRunTime(run.startedAt)}</span>
        <span className="text-xs text-muted-foreground">
          {run.status}
          {run.agents !== undefined && ` · ${run.agents} agents`}
          {run.issuesFound !== undefined && ` · ${run.issuesFound} issues`}
        </span>
      </button>
    </div>
  )
}
