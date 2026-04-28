import { eventHandler, getRouterParam, setResponseStatus, type H3Event } from "h3"
import { getRunsStore } from "../../../lib/runs-store"

export default eventHandler(async (event: H3Event) => {
  const runId = getRouterParam(event, "id")
  if (!runId) {
    setResponseStatus(event, 400)
    return { error: "Run ID required" }
  }

  const store = getRunsStore()
  const state = store.getRunState(runId)

  if (!state) {
    setResponseStatus(event, 404)
    return { error: "Run not found" }
  }

  if (state.status !== "running") {
    setResponseStatus(event, 409)
    return { error: `Run is already ${state.status}` }
  }

  const updated = store.cancelRun(runId)
  if (!updated) {
    setResponseStatus(event, 404)
    return { error: "Run not found" }
  }

  setResponseStatus(event, 202)
  const { controller: _, ...publicState } = updated as typeof updated & { controller?: unknown }
  return publicState
})
