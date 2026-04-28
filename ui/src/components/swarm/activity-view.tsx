import { useState, useEffect, useRef } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { SwarmEvent, ActivityLine } from "@/lib/types"

interface ActivityViewProps {
  events: string
}

function classifyEvent(event: SwarmEvent): ActivityLine["category"] {
  const msg = (event.message || "").toLowerCase()
  const tool = event.tool || event.context?.tool || ""
  if (tool.includes("shell") || msg.includes("shell:") || msg.includes("shell ")) return "shell"
  if (tool.includes("read") || msg.includes("read_file") || msg.includes("read:")) return "read"
  if (
    tool.includes("write") ||
    msg.includes("write_file") ||
    msg.includes("apply_patch") ||
    msg.includes("edit")
  )
    return "write"
  return "other"
}

function formatActivityTime(timestamp?: string): string {
  if (!timestamp) return ""
  try {
    const d = new Date(timestamp)
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  } catch {
    return ""
  }
}

function truncateMessage(msg: string | undefined, maxLen = 200): string {
  if (!msg) return ""
  const cleaned = msg.replace(/\n/g, " ").replace(/\s+/g, " ").trim()
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "..." : cleaned
}

function parseActivityFromEvents(rawEvents: string): ActivityLine[] {
  const events = rawEvents
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as SwarmEvent
      } catch {
        return undefined
      }
    })
    .filter((e): e is SwarmEvent => e !== undefined)

  return events.map((event, idx) => {
    const context = event.context || {}
    const agentId = context.agentId || `worker-${idx % 100}`
    const category = classifyEvent(event)
    const exitCode = event.exitCode ?? event.exit_code ?? context.exitCode
    const duration = event.duration ?? event.elapsed_ms ?? context.duration
    return {
      time: formatActivityTime(event.timestamp),
      worker: agentId,
      category,
      message: truncateMessage(event.message || event.type || "event"),
      exitCode,
      duration,
      raw: event,
    }
  })
}

export function ActivityView({ events }: ActivityViewProps) {
  const [filters, setFilters] = useState({
    shell: true,
    read: true,
    write: true,
    other: true,
  })
  const [autoScroll, setAutoScroll] = useState(true)
  const [activityLines, setActivityLines] = useState<ActivityLine[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setActivityLines(parseActivityFromEvents(events))
  }, [events])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [activityLines, autoScroll])

  const filteredLines = activityLines.filter((line) => {
    if (line.category === "shell" && !filters.shell) return false
    if (line.category === "read" && !filters.read) return false
    if (line.category === "write" && !filters.write) return false
    if (line.category === "other" && !filters.other) return false
    return true
  })

  const clearActivity = () => {
    setActivityLines([])
  }

  const toggleFilter = (key: keyof typeof filters) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 border-b bg-muted/30 p-3">
        <FilterCheckbox
          id="filter-shell"
          label="Shell"
          checked={filters.shell}
          onChange={() => toggleFilter("shell")}
          color="text-pink-400"
        />
        <FilterCheckbox
          id="filter-read"
          label="Read"
          checked={filters.read}
          onChange={() => toggleFilter("read")}
          color="text-green-400"
        />
        <FilterCheckbox
          id="filter-write"
          label="Write"
          checked={filters.write}
          onChange={() => toggleFilter("write")}
          color="text-yellow-400"
        />
        <FilterCheckbox
          id="filter-other"
          label="Other"
          checked={filters.other}
          onChange={() => toggleFilter("other")}
          color="text-blue-400"
        />
        <Button variant="destructive" size="sm" onClick={clearActivity}>
          <Trash2 className="mr-1.5 size-3.5" />
          Clear
        </Button>
        <div className="flex items-center gap-2">
          <Checkbox
            id="auto-scroll"
            checked={autoScroll}
            onCheckedChange={(checked) => setAutoScroll(checked === true)}
          />
          <Label htmlFor="auto-scroll" className="text-sm font-normal">
            Auto-scroll
          </Label>
        </div>
      </div>

      {/* Activity Log: min-h-0 + overflow-y-auto so flex layout allows inner scroll */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background [scrollbar-gutter:stable]"
      >
        <div className="font-mono text-xs">
          {filteredLines.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              No activity yet. Start a swarm run to see real-time logs.
            </div>
          )}
          {filteredLines.map((line, idx) => (
            <div
              key={idx}
              className="flex gap-0 border-b border-border/50 hover:bg-muted/30"
            >
              <span className="w-16 shrink-0 px-2 py-1 text-right text-muted-foreground">
                {line.time}
              </span>
              <span
                className={cn(
                  "w-24 shrink-0 px-2 py-1 font-semibold",
                  line.category === "shell" && "text-pink-400",
                  line.category === "read" && "text-green-400",
                  line.category === "write" && "text-yellow-400",
                  line.category === "other" && "text-blue-400"
                )}
              >
                {line.worker}
              </span>
              <span className="flex-1 break-all px-2 py-1 text-foreground">
                {line.message}
              </span>
              {(line.exitCode !== undefined || line.duration !== undefined) && (
                <span
                  className={cn(
                    "shrink-0 px-2 py-1 text-muted-foreground",
                    line.exitCode === 0 && "text-green-400",
                    line.exitCode !== undefined && line.exitCode !== 0 && "text-red-400"
                  )}
                >
                  {line.exitCode !== undefined && `exit ${line.exitCode}`}
                  {line.duration !== undefined && ` [${line.duration}ms]`}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface FilterCheckboxProps {
  id: string
  label: string
  checked: boolean
  onChange: () => void
  color: string
}

function FilterCheckbox({ id, label, checked, onChange, color }: FilterCheckboxProps) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className={cn("text-sm font-normal", color)}>
        {label}
      </Label>
    </div>
  )
}
