import type { CursorAgentClient, RunStatus, RunStatusKind } from "../types.js";

function isTerminalStatus(status: RunStatusKind): boolean {
  switch (status) {
    case "succeeded":
    case "failed":
    case "cancelled":
      return true;
    case "queued":
    case "running":
      return false;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export async function pollAgentRun(input: {
  client: CursorAgentClient;
  runId: string;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<RunStatus> {
  const intervalMs = input.intervalMs ?? 2_000;
  const timeoutMs = input.timeoutMs ?? 120_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const status = await input.client.getRun(input.runId);
    if (isTerminalStatus(status.status)) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    runId: input.runId,
    status: "failed",
    message: `Timed out after ${timeoutMs}ms waiting for agent run.`,
  };
}
