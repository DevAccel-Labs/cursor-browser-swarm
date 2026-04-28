import { eventHandler, getRouterParam, setResponseStatus, setHeader, type H3Event } from "h3"
import { getRunsStore } from "../../../lib/runs-store"

export default eventHandler(async (event: H3Event) => {
  const runId = getRouterParam(event, "id")
  if (!runId) {
    setResponseStatus(event, 400)
    return { error: "Run ID required" }
  }

  const store = getRunsStore()
  const report = await store.getReport(runId)

  if (!report) {
    setResponseStatus(event, 404)
    return { error: "Report not ready yet" }
  }

  setHeader(event, "Content-Type", "text/markdown; charset=utf-8")
  return report
})
