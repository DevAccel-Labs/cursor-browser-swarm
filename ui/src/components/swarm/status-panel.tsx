import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, Clipboard } from "lucide-react"
import type { AgentFindingPreview, AgentReportPreview, SwarmEvent, UiRunState } from "@/lib/types"
import { MarkdownReport } from "@/components/swarm/markdown-report"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"

interface StatusPanelProps {
  runState: UiRunState | null
  events: string
  report: string | null
  previewReports: AgentReportPreview[]
}

function formatTime(timestamp?: string): string {
  if (!timestamp) return ""
  try {
    return new Date(timestamp).toLocaleTimeString()
  } catch {
    return ""
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}

function parseEvents(rawEvents: string): Array<SwarmEvent> {
  return rawEvents
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
}

interface TimelineEvent extends SwarmEvent {
  agentId: string
  sequence: number
}

function groupEventsByAgent(events: Array<SwarmEvent>): Map<string, Array<TimelineEvent>> {
  const grouped = new Map<string, Array<TimelineEvent>>()

  for (const event of events) {
    const agentId = event.context?.agentId || "unknown"
    const sequence = event.context?.sequence || 0
    const timelineEvent: TimelineEvent = { ...event, agentId, sequence }

    const existing = grouped.get(agentId) || []
    existing.push(timelineEvent)
    grouped.set(agentId, existing)
  }

  for (const [_agentId, agentEvents] of grouped) {
    agentEvents.sort((a, b) => {
      if (a.sequence !== b.sequence) return a.sequence - b.sequence
      return (a.timestamp || "").localeCompare(b.timestamp || "")
    })
  }

  return grouped
}

function severityVariant(severity: string | undefined): "default" | "secondary" | "destructive" {
  if (severity === "high") return "destructive"
  if (severity === "medium" || severity === "low") return "secondary"
  return "default"
}

function AgentFindingSummary({ finding }: { finding: AgentFindingPreview }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
      <div className="text-sm font-medium text-foreground">{finding.title}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {finding.route && <span>{finding.route}</span>}
        {finding.severity && (
          <Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge>
        )}
        {finding.confidence && <Badge variant="secondary">{finding.confidence}</Badge>}
      </div>
    </div>
  )
}

function LiveReportPreview({ reports }: { reports: AgentReportPreview[] }) {
  const totalFindings = reports.reduce(
    (count, agentReport) => count + agentReport.findings.length,
    0,
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
        <Badge>Live preview</Badge>
        <span className="font-medium">
          {reports.length} {reports.length === 1 ? "agent" : "agents"} reported
        </span>
        <span className="text-muted-foreground">
          {totalFindings} {totalFindings === 1 ? "finding" : "findings"}
        </span>
        <span className="text-muted-foreground">Final report pending</span>
      </div>

      <div className="space-y-2">
        {reports.map((agentReport) => (
          <Collapsible key={agentReport.agentId} defaultOpen>
            <div className="rounded-md border border-border/60 bg-muted/20">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{agentReport.agentId}</span>
                    <span className="text-xs text-muted-foreground">
                      {agentReport.findings.length === 0
                        ? "no findings"
                        : `${agentReport.findings.length} ${
                            agentReport.findings.length === 1 ? "finding" : "findings"
                          }`}
                    </span>
                  </div>
                  <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-3 border-t border-border/60 p-3">
                  {agentReport.findings.length > 0 ? (
                    <div className="space-y-1.5">
                      {agentReport.findings.map((finding, index) => (
                        <AgentFindingSummary
                          key={`${agentReport.agentId}-${finding.title}-${index}`}
                          finding={finding}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      This agent completed without reporting any findings.
                    </p>
                  )}
                  <div className="rounded-md border border-border/60 bg-background px-4 py-3">
                    <MarkdownReport markdown={agentReport.markdown} />
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </div>
    </div>
  )
}

export function StatusPanel({ runState, events, report, previewReports }: StatusPanelProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")
  const [nowMs, setNowMs] = useState(() => Date.now())
  const parsedEvents = useMemo(() => parseEvents(events), [events])
  const groupedEvents = useMemo(() => groupEventsByAgent(parsedEvents), [parsedEvents])
  const wallClock = useMemo(() => {
    if (!runState?.startedAt) return undefined

    const startedMs = Date.parse(runState.startedAt)
    if (Number.isNaN(startedMs)) return undefined

    const endedMs = runState.endedAt ? Date.parse(runState.endedAt) : nowMs
    if (Number.isNaN(endedMs)) return undefined

    return formatDuration(endedMs - startedMs)
  }, [nowMs, runState?.endedAt, runState?.startedAt])

  useEffect(() => {
    if (runState?.status !== "running") return

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [runState?.status])

  const copyFinalReport = async () => {
    if (!report) return

    try {
      await navigator.clipboard.writeText(report)
      setCopyState("copied")
    } catch {
      setCopyState("failed")
    }

    window.setTimeout(() => setCopyState("idle"), 2000)
  }

  return (
    <div className="space-y-3">
      {/* Run Status */}
      <Collapsible>
        <Card size="sm">
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer pb-2 hover:bg-muted/50">
              <div className="flex items-center justify-between">
                <CardTitle>Run Status</CardTitle>
                <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {runState ? (
                <pre className="overflow-auto rounded-md bg-muted p-2.5 text-xs">
                  {JSON.stringify({ ...runState, controller: undefined }, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">No run started.</p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Agent Timeline */}
      <Card size="sm">
        <CardHeader>
          <CardTitle>Agent Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {groupedEvents.size === 0 ? (
            <p className="text-sm text-muted-foreground">Agent activity will appear here.</p>
          ) : (
            <ScrollArea className="h-48">
              <div className="space-y-3">
                {Array.from(groupedEvents.entries()).map(([agentId, agentEvents]) => (
                  <div key={agentId}>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                      {agentId}
                    </div>
                    <div className="space-y-1.5">
                      {agentEvents.map((event, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">
                              {event.message || "Event"}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {[
                                event.sequence ? `#${event.sequence}` : "",
                                formatTime(event.timestamp),
                                event.context?.phase,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Raw Events */}
      <Collapsible>
        <Card size="sm">
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer pb-2 hover:bg-muted/50">
              <div className="flex items-center justify-between">
                <CardTitle>Raw Events</CardTitle>
                <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              <pre className="overflow-auto rounded-md bg-muted p-2.5 text-xs">
                {events || "Run events will stream here."}
              </pre>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Final Report */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Final Report</CardTitle>
            {wallClock && (
              <span className="text-[11px] text-muted-foreground">· {wallClock}</span>
            )}
          </div>
          {report && (
            <Button variant="outline" size="xs" onClick={copyFinalReport}>
              {copyState === "copied" ? (
                <Check className="size-3" />
              ) : (
                <Clipboard className="size-3" />
              )}
              {copyState === "copied"
                ? "Copied"
                : copyState === "failed"
                  ? "Copy failed"
                  : "Copy"}
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {report ? (
            <div className="rounded-md border border-border/60 bg-muted/25 px-4 py-4">
              <MarkdownReport markdown={report} />
            </div>
          ) : previewReports.length > 0 ? (
            <LiveReportPreview reports={previewReports} />
          ) : (
            <div className="rounded-md border border-dashed border-border/60 px-4 py-6">
              <p className="text-center text-xs text-muted-foreground">
                Report will appear after the run completes.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
