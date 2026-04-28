import { eventHandler, getRouterParam, setResponseStatus, type H3Event } from "h3"
import { getRunsStore } from "../../lib/runs-store"

export default eventHandler(async (event: H3Event) => {
  const runId = getRouterParam(event, "id")
  if (!runId) {
    setResponseStatus(event, 400)
    return { error: "Run ID required" }
  }

  const store = getRunsStore()
  const state = await store.getRunStateOrDisk(runId)

  if (!state) {
    setResponseStatus(event, 404)
    return { error: "Run not found" }
  }

  const { controller: _, ...publicState } = state as typeof state & { controller?: unknown }
  return publicState
})
