import { writeFile } from "node:fs/promises";
import type {
  AgentArtifactPaths,
  AgentAssignment,
  AgentRunReport,
  CreateRunInput,
  CreateRunResult,
  CursorAgentClient,
  RunStatus,
  RunStatusKind,
} from "../types.js";

interface CursorCloudAgent {
  id: string;
  name?: string;
  status?: string;
  target?: {
    url?: string;
    prUrl?: string;
  };
  summary?: string;
}

interface CursorCloudClientOptions {
  apiKey?: string;
  repository?: string;
  ref?: string;
  model?: string;
  baseUrl?: string;
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

export function mapCloudStatus(status: string | undefined): RunStatusKind {
  switch ((status ?? "running").toUpperCase()) {
    case "CREATING":
    case "PENDING":
    case "QUEUED":
      return "queued";
    case "RUNNING":
      return "running";
    case "FINISHED":
    case "SUCCEEDED":
    case "SUCCESS":
      return "succeeded";
    case "STOPPED":
    case "CANCELLED":
    case "CANCELED":
      return "cancelled";
    case "FAILED":
    case "ERROR":
    case "EXPIRED":
      return "failed";
    default:
      return "running";
  }
}

export const __test__ = {
  authHeader,
  mapCloudStatus,
};

function makePlaceholderReport(input: {
  agentId: string;
  assignment: AgentAssignment;
  artifactPaths: AgentArtifactPaths;
  status: RunStatusKind;
  externalUrl?: string | undefined;
  note: string;
}): AgentRunReport {
  return {
    agentId: input.agentId,
    assignment: input.assignment,
    mode: "cloud-api",
    status: input.status,
    reportPath: input.artifactPaths.reportPath,
    screenshots: [],
    promptPath: input.artifactPaths.promptPath,
    handoffPath: input.artifactPaths.handoffPath,
    externalUrl: input.externalUrl,
    findings: [],
    notes: [input.note],
  };
}

export class CloudApiCursorAgentClient implements CursorAgentClient {
  private readonly apiKey: string;
  private readonly repository: string;
  private readonly ref: string;
  private readonly model: string;
  private readonly baseUrl: string;

  public constructor(options: CursorCloudClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.CURSOR_API_KEY ?? "";
    this.repository = options.repository ?? process.env.CURSOR_REPOSITORY ?? "";
    this.ref = options.ref ?? process.env.CURSOR_DEFAULT_BRANCH ?? "main";
    this.model = options.model ?? process.env.CURSOR_MODEL ?? "default";
    this.baseUrl = options.baseUrl ?? "https://api.cursor.com";
  }

  public async createRun(input: CreateRunInput): Promise<CreateRunResult> {
    await writeFile(input.artifactPaths.promptPath, input.missionPrompt);
    if (!this.apiKey) {
      throw new Error("CURSOR_API_KEY is required for cloud-api mode.");
    }
    if (!this.repository) {
      throw new Error("CURSOR_REPOSITORY is required for cloud-api mode.");
    }

    const response = await fetch(`${this.baseUrl}/v0/agents`, {
      method: "POST",
      headers: {
        Authorization: authHeader(this.apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: { text: input.missionPrompt },
        model: this.model,
        source: {
          repository: this.repository,
          ref: this.ref,
        },
        target: {
          autoCreatePr: false,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Cursor Cloud Agent API failed with ${response.status}: ${await response.text()}`,
      );
    }

    const agent = (await response.json()) as CursorCloudAgent;
    const status = mapCloudStatus(agent.status);
    const externalUrl = agent.target?.url ?? agent.target?.prUrl;
    const promptPath = input.artifactPaths.promptPath;
    await writeFile(promptPath, `${input.missionPrompt}\n`);

    const reportInput: {
      agentId: string;
      assignment: AgentAssignment;
      artifactPaths: AgentArtifactPaths;
      status: RunStatusKind;
      note: string;
      externalUrl?: string;
    } = {
      agentId: input.agentId,
      assignment: input.assignment,
      artifactPaths: input.artifactPaths,
      status,
      note: "Cloud API run launched. Browser MCP validation is not available directly in Cloud Agent API mode.",
    };
    const report = makePlaceholderReport(
      externalUrl ? { ...reportInput, externalUrl } : reportInput,
    );

    const result: CreateRunResult = {
      runId: agent.id,
      status,
      startedAt: new Date().toISOString(),
      report,
    };
    if (externalUrl) {
      result.externalUrl = externalUrl;
    }
    return result;
  }

  public async getRun(runId: string): Promise<RunStatus> {
    if (!this.apiKey) {
      throw new Error("CURSOR_API_KEY is required for cloud-api mode.");
    }
    const response = await fetch(`${this.baseUrl}/v0/agents/${runId}`, {
      headers: { Authorization: authHeader(this.apiKey) },
    });
    if (!response.ok) {
      throw new Error(
        `Cursor Cloud Agent API status failed with ${response.status}: ${await response.text()}`,
      );
    }
    const agent = (await response.json()) as CursorCloudAgent;
    const statusResult: RunStatus = {
      runId,
      status: mapCloudStatus(agent.status),
    };
    if (agent.summary) {
      statusResult.message = agent.summary;
    }
    return statusResult;
  }
}
