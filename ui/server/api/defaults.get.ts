import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { eventHandler, getQuery } from "h3"

const execFileAsync = promisify(execFile)

const defaultAgentDirectives = [
  {
    id: "balanced",
    label: "Balanced QA",
    instructions:
      "Validate the main happy path, persistence after refresh, obvious error states, and whether the flow matches the route goal.",
    allowDestructiveActions: false,
  },
  {
    id: "destructive",
    label: "Destructive Flow Breaker",
    instructions:
      "Actively try to break the flow with cancel/back/refresh/reopen loops, duplicate submissions, archive/delete-like actions when the route goal allows them, and confusing state transitions.",
    allowDestructiveActions: true,
  },
  {
    id: "security",
    label: "Security Boundary Probe",
    instructions:
      "Probe auth boundaries, forbidden actions, ID/query-param tampering, tenant/workspace leakage, and unsafe direct-object access without exfiltrating secrets or damaging real data.",
    allowDestructiveActions: false,
  },
  {
    id: "realtime",
    label: "Realtime and Persistence Stress",
    instructions:
      "Focus on optimistic UI, WebSocket/realtime acks, reload/back/duplicate-tab behavior, stale snapshots, and whether temp/client IDs reconcile to server-backed state.",
    allowDestructiveActions: false,
  },
  {
    id: "edge-inputs",
    label: "Edge Inputs and Validation",
    instructions:
      "Try empty strings, long values, punctuation, repeated spaces, rapid edits, date boundaries, and validation/recovery behavior.",
    allowDestructiveActions: false,
  },
]

const cursorFallbackModels = [
  { id: "auto", name: "Auto" },
  { id: "composer-2-fast", name: "Composer 2 Fast" },
  { id: "composer-2", name: "Composer 2" },
  { id: "composer-1.5", name: "Composer 1.5" },
  { id: "gpt-5.3-codex", name: "Codex 5.3" },
  { id: "gpt-5.3-codex-high", name: "Codex 5.3 High" },
  { id: "gpt-5.2", name: "GPT-5.2" },
]

const copilotFallbackModels = [
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
  { id: "auto", name: "Auto" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
  { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
  { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
  { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { id: "gpt-4.1", name: "GPT-4.1" },
  { id: "gpt-5-mini", name: "GPT-5 mini" },
  { id: "gpt-5.2", name: "GPT-5.2" },
  { id: "gpt-5.2-codex", name: "GPT-5.2-Codex" },
  { id: "gpt-5.3-codex", name: "GPT-5.3-Codex" },
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 mini" },
  { id: "gpt-5.5", name: "GPT-5.5" },
]

const genericFallbackModels = [{ id: "auto", name: "Auto" }]

function fallbackModelsForMode(mode: string) {
  switch (mode) {
    case "cursor-cli":
      return cursorFallbackModels
    case "copilot-cli":
      return copilotFallbackModels
    case "custom-cli":
    default:
      return genericFallbackModels
  }
}

function parseModelOutput(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = /^([a-zA-Z0-9_.-]+)\s+-\s+(.+)$/.exec(line)
      return match?.[1] && match[2] ? { id: match[1], name: match[2] } : undefined
    })
    .filter((model): model is { id: string; name: string } => Boolean(model))
}

function chooseDefaultModel(models: { id: string; name: string }[]) {
  return models.find((model) => /\(default\)/i.test(model.name))?.id ?? models[0]?.id ?? "auto"
}

function defaultAgentCommand(mode: string) {
  switch (mode) {
    case "copilot-cli":
      return "copilot"
    case "cursor-cli":
    case "custom-cli":
    default:
      return "agent"
  }
}

async function listAgentModels(mode: string, agentCommand: string) {
  const fallbackModels = fallbackModelsForMode(mode)
  if (mode === "copilot-cli") {
    return {
      models: fallbackModels,
      source: "fallback" as const,
      error: "Copilot CLI does not expose a model listing command; showing Copilot-safe defaults.",
    }
  }

  try {
    const result = await execFileAsync(agentCommand, ["--list-models"], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
    const models = parseModelOutput(`${result.stdout}\n${result.stderr}`)
    if (models.length > 0) {
      return { models, source: "agent-cli" as const }
    }
    return {
      models: fallbackModels,
      source: "fallback" as const,
      error: `${agentCommand} --list-models did not return parseable models.`,
    }
  } catch (error) {
    return {
      models: fallbackModels,
      source: "fallback" as const,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export default eventHandler(async (event) => {
  const query = getQuery(event)
  const mode = typeof query.mode === "string" ? query.mode : "cursor-cli"
  const agentCommand =
    (typeof query.agentCommand === "string" && query.agentCommand.trim()) ||
    (typeof query.cursorCommand === "string" && query.cursorCommand.trim()) ||
    defaultAgentCommand(mode)
  const modelResult = await listAgentModels(mode, agentCommand)

  return {
    baseUrl: "http://localhost:3000",
    appName: "My App",
    agents: 4,
    agentConcurrency: "auto",
    assignmentStrategy: "replicate",
    agentPersonas: defaultAgentDirectives.map((d) => d.id).join(","),
    agentPersonaOptions: defaultAgentDirectives,
    agentDirectives: "",
    mode,
    chromeMode: "axi",
    model: chooseDefaultModel(modelResult.models),
    models: modelResult.models,
    modelSource: modelResult.source,
    modelError: modelResult.error,
    agentCommand,
    cursorCommand: agentCommand,
    maxRouteSteps: 12,
    axiPortBase: "",
    secretsEnvPrefix: "SWARM_SECRET_",
    debugEnabled: false,
  }
})
