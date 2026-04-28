import { eventHandler, getRouterParam, setResponseStatus, setHeader, type H3Event } from "h3"
import { getRunsStore } from "../../../lib/runs-store"

export default eventHandler(async (event: H3Event) => {
  const runId = getRouterParam(event, "id")
  if (!runId) {
    setResponseStatus(event, 400)
    return { error: "Run ID required" }
  }

  const store = getRunsStore()
  const events = await store.getEvents(runId)

  setHeader(event, "Content-Type", "application/x-ndjson; charset=utf-8")
  return events
})
