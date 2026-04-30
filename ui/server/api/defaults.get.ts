import { eventHandler } from "h3"

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
    id: "accessibility",
    label: "Accessibility and Keyboard UX",
    instructions:
      "Use keyboard-like flows, focus order, accessible names, modal/dropdown escape behavior, disabled states, and screen-reader-visible labels.",
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

const fallbackModels = [
  { id: "auto", name: "Auto" },
  { id: "composer-2-fast", name: "Composer 2 Fast" },
  { id: "composer-2", name: "Composer 2" },
  { id: "composer-1.5", name: "Composer 1.5" },
  { id: "gpt-5.3-codex", name: "Codex 5.3" },
  { id: "gpt-5.3-codex-high", name: "Codex 5.3 High" },
  { id: "gpt-5.2", name: "GPT-5.2" },
]

export default eventHandler(async () => {
  return {
    baseUrl: "http://localhost:3000",
    appName: "My App",
    agents: 4,
    agentConcurrency: "auto",
    assignmentStrategy: "replicate",
    agentPersonas: defaultAgentDirectives.map((d) => d.id).join(","),
    agentPersonaOptions: defaultAgentDirectives,
    agentDirectives: "",
    mode: "cursor-cli",
    chromeMode: "axi",
    model: "composer-2-fast",
    models: fallbackModels,
    modelSource: "fallback" as const,
    agentCommand: "agent",
    cursorCommand: "agent",
    maxRouteSteps: 12,
    axiPortBase: "",
    secretsEnvPrefix: "SWARM_SECRET_",
    debugEnabled: false,
  }
})
