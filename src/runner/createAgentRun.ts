import type { CreateRunInput, CreateRunResult, CursorAgentClient } from "../types.js";

export async function createAgentRun(
  client: CursorAgentClient,
  input: CreateRunInput,
): Promise<CreateRunResult> {
  return client.createRun(input);
}
