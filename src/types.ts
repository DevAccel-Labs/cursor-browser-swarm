export type RunMode = "dry-run" | "cursor-cli" | "cursor-sdk" | "cloud-api";

export type SwarmMode = RunMode;

export type ChromeMode = "playwright" | "devtools-mcp" | "axi";

export type AssignmentStrategy = "split" | "replicate";

export type AgentConcurrency = number | "auto";

export type AgentConcurrencyMode = "fixed" | "auto";

export type SwarmSeverityFocus = "console" | "network" | "visual" | "accessibility" | "performance";

export type SeverityFocus = SwarmSeverityFocus;

export type RunStatusKind = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AgentDirective {
  id: string;
  label: string;
  instructions: string;
  allowDestructiveActions: boolean;
}

export interface RouteScenario {
  path: string;
  goal: string;
  hints: string[];
  severityFocus: SeverityFocus[];
}

export interface RouteConfig {
  appName: string;
  baseUrl?: string | undefined;
  routes: RouteScenario[];
  agentDirectives?: AgentDirective[] | undefined;
}

export interface SwarmSecret {
  key: string;
  value: string;
  envName?: string;
}

export interface SwarmCliOptions {
  repo: string;
  devCommand?: string | undefined;
  noDevServer: boolean;
  baseUrl: string;
  routesPath: string;
  instructionsPath?: string | undefined;
  secrets: SwarmSecret[];
  secretEnv: Record<string, string>;
  secretsEnvPrefix: string;
  interactiveSecrets: boolean;
  agents: number;
  agentConcurrency: AgentConcurrency;
  assignmentStrategy: AssignmentStrategy;
  agentDirectives?: AgentDirective[] | undefined;
  agentPersonas?: string | undefined;
  mode: SwarmMode;
  runId?: string | undefined;
  outDir?: string | undefined;
  cursorCommand: string;
  model?: string | undefined;
  chromeMode: ChromeMode;
  axiPortBase?: number | undefined;
  maxRouteSteps: number;
  contextPacketPath?: string | undefined;
}

export type CliOptions = SwarmCliOptions;

export interface SecretReference {
  key: string;
  envName: string;
  value: string;
}

export interface SwarmRunConfig {
  repoPath: string;
  baseUrl: string;
  routesPath: string;
  instructions?: string | undefined;
  instructionsPath?: string | undefined;
  secrets: SecretReference[];
  secretEnv: Record<string, string>;
  secretsEnvPrefix: string;
  interactiveSecrets: boolean;
  agents: number;
  agentConcurrency: number;
  requestedAgentConcurrency: AgentConcurrency;
  agentConcurrencyMode: AgentConcurrencyMode;
  assignmentStrategy: AssignmentStrategy;
  agentDirectives: AgentDirective[];
  agentPersonas?: string | undefined;
  mode: SwarmMode;
  runId: string;
  outDir: string;
  cursorCommand: string;
  model?: string | undefined;
  chromeMode: ChromeMode;
  axiPortBase: number;
  maxRouteSteps: number;
  devCommand?: string | undefined;
  noDevServer: boolean;
  routeConfig: RouteConfig;
  finalReportPath?: string;
  summaryJsonPath?: string;
}

export interface AgentAssignment {
  agentId: string;
  index: number;
  routes: RouteScenario[];
  directive: AgentDirective;
}

export interface ArtifactPaths {
  runDir: string;
  agentsDir: string;
  eventsPath: string;
  finalReportPath: string;
  summaryJsonPath: string;
  metricsJsonPath: string;
  benchmarkJsonPath: string;
  benchmarkCsvPath: string;
  resourceSamplesPath: string;
}

export interface AgentArtifactPaths {
  agentDir: string;
  screenshotsDir: string;
  browserHomeDir: string;
  browserProfileDir: string;
  tempDir: string;
  scriptsDir: string;
  evidenceManifestPath: string;
  axiHelperPath: string;
  reportPath: string;
  consolePath: string;
  networkPath: string;
  realtimeTracePath: string;
  handoffPath: string;
  tracePath: string;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
}

export interface BrowserSession {
  agentId: string;
  index: number;
  axiPort: number;
  homeDir: string;
  profileDir: string;
  tempDir: string;
  scriptsDir: string;
  axiPortConflict?: boolean;
  axiStartupMs?: number;
  axiStartupFailed?: boolean;
  axiBridgePids?: number[];
  sessionIsolationValid?: boolean;
}

export interface ActionStep {
  label: string;
  status: "passed" | "failed" | "skipped";
  detail?: string;
}

export interface BrowserScenarioResult {
  screenshots: string[];
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
  realtimeEntries: RealtimeEntry[];
  tracePath: string;
  findings: Finding[];
  notes: string[];
  actions: ActionStep[];
}

export interface ConsoleEntry {
  type: string;
  text: string;
  location?: string;
  timestamp: string;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status?: number;
  failureText?: string | undefined;
  resourceType?: string;
  timestamp: string;
}

export interface RealtimeEntry {
  transport: "websocket";
  direction: "connect" | "outbound" | "inbound" | "close" | "error";
  url: string;
  payload?: string;
  timestamp: string;
}

export type FixReadiness =
  | "ready"
  | "needs-protocol-evidence"
  | "needs-repo-context"
  | "needs-clean-repro"
  | "unknown";

export type FindingClassification =
  | "root-cause-candidate"
  | "downstream-symptom"
  | "independent-bug"
  | "needs-clean-repro"
  | "observability"
  | "tooling"
  | "unknown";

export interface Finding {
  title: string;
  route: string;
  agentId: string;
  classification?: FindingClassification;
  rootCauseKey?: string;
  observedBehavior?: string;
  inferredCause?: string;
  needsCleanRepro?: boolean;
  protocolEvidence?: string[];
  debugHints?: string[];
  fixReadiness?: FixReadiness;
  severity: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  evidence: string[];
  reproSteps: string[];
  likelyFiles: string[];
  fixStatus: "none" | "attempted" | "verified" | "failed";
}

export interface AgentRunReport {
  agentId: string;
  assignment: AgentAssignment;
  mode: SwarmMode;
  status: RunStatusKind;
  evidenceStatus?: "verified" | "partial" | "missing";
  evidenceScore?: "strong" | "partial" | "weak";
  evidenceManifestPath?: string;
  blockedReason?: string;
  reportPath: string;
  screenshots: string[];
  consoleLogPath?: string;
  networkLogPath?: string;
  realtimeTracePath?: string;
  handoffPath?: string;
  tracePath?: string;
  promptPath?: string;
  stdoutPath?: string;
  stderrPath?: string;
  externalUrl?: string | undefined;
  findings: Finding[];
  telemetry?: AgentRunTelemetry;
  notes: string[];
}

export interface AgentRunTelemetry {
  runtimeMs?: number;
  timeToFirstStdoutMs?: number;
  timeToFirstArtifactMs?: number;
  axiPort?: number;
  axiStartupMs?: number;
  axiPortConflict: boolean;
  browserProfilePath?: string;
  peakMemoryMb?: number;
  chromeProcessId?: number;
  sessionIsolationValid: boolean;
  screenshotsProduced: number;
  interactionsTotal: number;
  manifestFindings: number;
  reportWritten: boolean;
  manifestWritten: boolean;
  consoleWritten: boolean;
  networkWritten: boolean;
  realtimeTraceWritten: boolean;
}

export interface SwarmSummary {
  runId: string;
  appName: string;
  mode: SwarmMode;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  agents: number;
  routesTested: number;
  issuesFound: number;
  likelyRealBugs: number;
  highConfidenceIssues: number;
  agentReports: AgentRunReport[];
}

export interface CreateRunInput {
  agentId: string;
  assignment: AgentAssignment;
  repoPath: string;
  runId?: string;
  signal?: AbortSignal;
  artifactPaths: AgentArtifactPaths;
  eventsPath: string;
  missionPrompt: string;
  mode: SwarmMode;
  baseUrl: string;
  model?: string;
  secretEnv: Record<string, string>;
  secrets: SwarmSecret[];
  secretsEnvPrefix: string;
  maxRouteSteps: number;
  chromeMode: ChromeMode;
  browserSession?: BrowserSession;
}

export interface EvidenceManifestRoute {
  path: string;
  status: "passed" | "failed" | "blocked";
  opened: boolean;
  interactions: string[];
  screenshots: string[];
  consoleChecked: boolean;
  networkChecked: boolean;
  realtimeChecked?: boolean;
  accessibilityChecked?: boolean;
  performanceChecked?: boolean;
  findings: Array<
    | string
    | {
        id?: string;
        title?: string;
        summary?: string;
        description?: string;
        classification?: FindingClassification;
        rootCauseKey?: string;
        observedBehavior?: string;
        inferredCause?: string;
        needsCleanRepro?: boolean;
        protocolEvidence?: string[];
        debugHints?: string[];
        fixReadiness?: FixReadiness;
        severity?: "informational" | "low" | "medium" | "high";
        confidence?: "low" | "medium" | "high";
        evidence?: string[];
        reproSteps?: string[];
        likelyFiles?: string[];
        fixStatus?: "none" | "attempted" | "verified" | "failed";
      }
  >;
  blockedReason?: string;
}

export interface EvidenceManifest {
  version: "1";
  agentId: string;
  agentDirective?: {
    id: string;
    label: string;
  };
  status: "passed" | "failed" | "blocked";
  baseUrl: string;
  startedAt?: string;
  completedAt?: string;
  routes: EvidenceManifestRoute[];
  artifacts: {
    report: string;
    screenshots: string[];
    console: string;
    network: string;
    realtimeTrace?: string;
    handoff?: string;
    trace?: string;
  };
  selfCheck: {
    browserOpened: boolean;
    browserInteracted: boolean;
    screenshotsExist: boolean;
    consoleInspected: boolean;
    networkInspected: boolean;
    realtimeInspected?: boolean;
    artifactPathsExist: boolean;
  };
  blockedReason?: string;
  notes: string[];
}

export interface RunMetrics {
  run_id: string;
  app_name: string;
  mode: SwarmMode;
  started_at?: string;
  completed_at?: string;
  duration_ms: number;
  agents: number;
  routes: number;
  evidence_verified: number;
  evidence_partial: number;
  evidence_missing: number;
  evidence_strong: number;
  issues_found: number;
  likely_real_bugs: number;
  high_confidence: number;
  screenshots_captured: number;
  interactions_total: number;
  manifest_findings: number;
  root_cause_groups: number;
  downstream_symptoms: number;
  needs_clean_repro: number;
  observability_findings: number;
  tool_failures: number;
}

export interface RunBenchmark {
  run_id: string;
  config: {
    agents: number;
    agent_concurrency: number;
    requested_agent_concurrency: AgentConcurrency;
    agent_concurrency_mode: AgentConcurrencyMode;
    axi_port_base: number;
    isolation_mode: "shared" | "per-agent";
  };
  timing: {
    preflight_ms: number;
    first_agent_start_ms: number;
    last_agent_complete_ms: number;
    total_wall_clock_ms: number;
    agent_runtimes_ms: number[];
  };
  resources: {
    port_collisions: number;
    startup_failures: number;
    orchestrator_memory_peak_mb: number;
    system_memory_peak_percent: number;
    system_load_peak_1m: number;
    chrome_processes_spawned: number;
    resource_samples_path: string;
  };
  adaptive: {
    initial_concurrency: number;
    max_observed_concurrency: number;
    decisions: number;
  };
  isolation: {
    profile_conflicts: number;
    temp_dir_collisions: number;
    state_bleed_events: number;
  };
  classification: {
    app_findings: number;
    tooling_findings: number;
    unclassified: number;
  };
}

export interface CreateRunResult {
  runId: string;
  agentId?: string;
  status: RunStatusKind;
  startedAt: string;
  externalUrl?: string | undefined;
  raw?: unknown;
  report?: AgentRunReport;
}

export interface RunStatus {
  runId: string;
  status: RunStatusKind;
  message?: string | undefined;
}

export interface CursorAgentClient {
  createRun(input: CreateRunInput): Promise<CreateRunResult>;
  getRun(runId: string): Promise<RunStatus>;
  streamLogs?(runId: string): AsyncIterable<string>;
}

export interface ContextPacket {
  version: "0.1";
  route: string;
  componentStack: string[];
  sourceFiles: string[];
  dom?: string;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  screenshotPath?: string;
  notes?: string;
}
