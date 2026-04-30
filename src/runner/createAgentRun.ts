import type { AgentClient, CreateRunInput, CreateRunResult } from "../types.js";

export async function createAgentRun(client: AgentClient, input: CreateRunInput): Promise<CreateRunResult> {
  return client.createRun(input);
}
