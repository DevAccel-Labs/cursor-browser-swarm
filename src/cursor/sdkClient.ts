import { CloudApiCursorAgentClient } from "./cloudApiClient.js";

interface SdkCursorAgentClientOptions {
  model?: string | undefined;
}

export class SdkCursorAgentClient extends CloudApiCursorAgentClient {
  public constructor(options: SdkCursorAgentClientOptions = {}) {
    super({
      apiKey: process.env.CURSOR_API_KEY ?? "",
      repository: process.env.CURSOR_REPOSITORY ?? "",
      ref: process.env.CURSOR_DEFAULT_BRANCH ?? "main",
      model: options.model ?? process.env.CURSOR_MODEL ?? "default",
    });
  }
}
