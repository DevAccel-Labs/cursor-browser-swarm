import { useMemo, useState } from "react"
import { Check, ChevronDown, Clipboard } from "lucide-react"
import type { SwarmEvent, UiRunState } from "@/lib/types"
import { MarkdownReport } from "@/components/swarm/markdown-report"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"

interface StatusPanelProps {
  runState: UiRunState | null
  events: string
  report: string | null
}

function formatTime(timestamp?: string): string {
  if (!timestamp) return ""
  try {
    return new Date(timestamp).toLocaleTimeString()
  } catch {
    return ""
  }
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

function groupEventsByAgent(
  events: Array<SwarmEvent>
): Map<string, Array<TimelineEvent>> {
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

export function StatusPanel({ runState, events, report }: StatusPanelProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")
  const parsedEvents = useMemo(() => parseEvents(events), [events])
  const groupedEvents = useMemo(() => groupEventsByAgent(parsedEvents), [parsedEvents])

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
    <div className="space-y-4">
      {/* Run Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Run Status</CardTitle>
        </CardHeader>
        <CardContent>
          {runState ? (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(
                { ...runState, controller: undefined },
                null,
                2
              )}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">No run started.</p>
          )}
        </CardContent>
      </Card>

      {/* Agent Timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Agent Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {groupedEvents.size === 0 ? (
            <p className="text-sm text-muted-foreground">Agent activity will appear here.</p>
          ) : (
            <ScrollArea className="h-64">
              <div className="space-y-4">
                {Array.from(groupedEvents.entries()).map(([agentId, agentEvents]) => (
                  <div key={agentId}>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
                      {agentId}
                    </div>
                    <div className="space-y-2">
                      {agentEvents.map((event, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                          <div className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{event.message || "Event"}</div>
                            <div className="text-xs text-muted-foreground">
                              {[
                                event.sequence ? `#${event.sequence}` : "",
                                formatTime(event.timestamp),
                                event.context?.phase,
                              ]
                                .filter(Boolean)
                                .join(" | ")}
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
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer pb-3 hover:bg-muted/50">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Raw Events</CardTitle>
                <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
                {events || "Run events will stream here."}
              </pre>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Final Report */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base">Final Report</CardTitle>
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
                  : "Copy report"}
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {report ? (
            <div className="rounded-lg border border-border/60 bg-muted/25 px-5 py-8">
              <MarkdownReport markdown={report} />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/60 px-5 py-10">
              <p className="text-center text-sm text-muted-foreground">
                Report will appear after the run completes.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
