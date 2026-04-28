import { eventHandler } from "h3"
import { getRunsStore } from "../../lib/runs-store"

export default eventHandler(async () => {
  const store = getRunsStore()
  return { runs: await store.listRuns() }
})
