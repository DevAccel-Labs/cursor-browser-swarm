export type RunStatus = "running" | "succeeded" | "failed" | "cancelled" | "unknown"

export interface UiRunListItem {
  id: string
  status: RunStatus
  startedAt?: string
  endedAt?: string
  appName?: string
  baseUrl?: string
  outDir: string
  agents?: number
  issuesFound?: number
}

export interface UiRunState {
  id: string
  status: RunStatus
  startedAt: string
  endedAt?: string
  baseUrl: string
  outDir: string
  routesPath: string
  eventsPath: string
  instructionsPath?: string
  envPath?: string
  finalReportPath?: string
  metricsPath?: string
  benchmarkJsonPath?: string
  benchmarkCsvPath?: string
  error?: string
}

export interface AgentFindingPreview {
  title: string
  route?: string
  severity?: string
  confidence?: string
}

export interface AgentReportPreview {
  agentId: string
  reportPath: string
  markdown: string
  findings: AgentFindingPreview[]
}

export interface RunPreviewResponse {
  runId: string
  reports: AgentReportPreview[]
}

export interface RouteInput {
  id?: string
  title?: string
  path: string
  goal: string
  hints?: string[]
  severityFocus?: string[]
  seedRequirements?: string[]
  baselineAssertions?: string[]
  passCriteria?: string[]
  expectedOutOfScope?: string[]
  telemetryExpectations?: {
    websocket?: "expected" | "silent" | "optional"
    network?: "expected" | "silent" | "optional"
    notes?: string[]
  }
  minimumFixture?: {
    description?: string
    rows: Array<{
      id?: string
      label: string
      fields: Record<string, string | number | boolean | null>
    }>
    relationships?: string[]
    requiredCounts?: Record<string, number>
  }
}

export interface SecretInput {
  key: string
  value: string
}

export interface AgentPersonaOption {
  id: string
  label: string
  instructions: string
  allowDestructiveActions: boolean
}

export interface ModelOption {
  id: string
  name: string
}

export interface DefaultsResponse {
  baseUrl: string
  appName: string
  agents: number
  agentConcurrency: string
  assignmentStrategy: string
  agentPersonas: string
  agentPersonaOptions: AgentPersonaOption[]
  agentDirectives: string
  mode: string
  chromeMode: string
  model: string
  models: ModelOption[]
  modelSource: "agent-cli" | "cursor-cli" | "fallback"
  modelError?: string
  agentCommand: string
  cursorCommand: string
  maxRouteSteps: number
  axiPortBase: string
  secretsEnvPrefix: string
  debugEnabled: boolean
}

export interface RunRequest {
  appName: string
  baseUrl: string
  routes: RouteInput[]
  instructions?: string
  secrets?: SecretInput[]
  secretsEnvPrefix?: string
  agents?: number | string
  agentConcurrency?: number | string
  agentPersonas?: string
  agentDirectives?: string
  mode?: string
  chromeMode?: string
  model?: string
  agentCommand?: string
  noDevServer?: boolean
  devCommand?: string
  cursorCommand?: string
  maxRouteSteps?: number | string
  assignmentStrategy?: string
  axiPortBase?: number | string
}

export interface SwarmEvent {
  timestamp?: string
  message?: string
  type?: string
  tool?: string
  exitCode?: number
  exit_code?: number
  duration?: number
  elapsed_ms?: number
  context?: {
    agentId?: string
    sequence?: number
    phase?: string
    tool?: string
    exitCode?: number
    duration?: number
  }
}

export interface ActivityLine {
  time: string
  worker: string
  category: "shell" | "read" | "write" | "other"
  message: string
  exitCode?: number
  duration?: number
  raw: SwarmEvent
}

export interface FormState {
  baseUrl: string
  appName: string
  routes: RouteInput[]
  instructions: string
  secrets: SecretInput[]
  agents: number
  agentConcurrency: string
  agentConcurrencyManual: boolean
  assignmentStrategy: string
  agentPersonas: string[]
  agentDirectives: string
  mode: string
  chromeMode: string
  model: string
  agentCommand: string
  cursorCommand: string
  maxRouteSteps: number
  axiPortBase: string
  noDevServer: boolean
}
