import { access, appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { writeAgentReport } from "../artifacts/writeAgentReport.js";
import { writeHandoffPacket } from "../artifacts/writeHandoffPacket.js";
import { writeChromeDevtoolsMcpConfig } from "../browser/chromeDevtoolsMcp.js";
import type {
  AgentArtifactPaths,
  AgentAssignment,
  AgentRunReport,
  AgentRunTelemetry,
  AgentClient,
  CreateRunInput,
  CreateRunResult,
  EvidenceManifest,
  FindingClassification,
  Finding,
  RunMode,
  RunStatus,
  SwarmSecret,
} from "../types.js";

interface ArtifactStats {
  screenshots: number;
  reportWritten: boolean;
  manifestWritten: boolean;
  consoleWritten: boolean;
  networkWritten: boolean;
  realtimeTraceWritten: boolean;
}

function redact(value: string, secrets: SwarmSecret[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.value) {
      redacted = redacted.split(secret.value).join(`[REDACTED:${secret.key}]`);
    }
  }
  return redacted;
}

function makeCliReport(input: {
  agentId: string;
  assignment: AgentAssignment;
  mode: RunMode;
  artifactPaths: AgentArtifactPaths;
  status: "succeeded" | "failed" | "cancelled";
  evidenceStatus?: "verified" | "partial" | "missing";
  evidenceScore?: "strong" | "partial" | "weak";
  blockedReason?: string;
  findings?: Finding[];
  telemetry?: AgentRunTelemetry;
  notes: string[];
}): AgentRunReport {
  return {
    agentId: input.agentId,
    assignment: input.assignment,
    mode: input.mode,
    status: input.status,
    evidenceStatus: input.evidenceStatus ?? "missing",
    evidenceScore: input.evidenceScore ?? "weak",
    evidenceManifestPath: input.artifactPaths.evidenceManifestPath,
    ...(input.blockedReason ? { blockedReason: input.blockedReason } : {}),
    reportPath: input.artifactPaths.reportPath,
    screenshots: [],
    consoleLogPath: input.artifactPaths.consolePath,
    networkLogPath: input.artifactPaths.networkPath,
    realtimeTracePath: input.artifactPaths.realtimeTracePath,
    handoffPath: input.artifactPaths.handoffPath,
    tracePath: input.artifactPaths.tracePath,
    promptPath: input.artifactPaths.promptPath,
    stdoutPath: input.artifactPaths.stdoutPath,
    stderrPath: input.artifactPaths.stderrPath,
    findings: input.findings ?? [],
    ...(input.telemetry ? { telemetry: input.telemetry } : {}),
    notes: input.notes,
  };
}

function isEvidenceManifest(value: unknown): value is EvidenceManifest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const manifest = value as Partial<EvidenceManifest>;
  return (
    manifest.version === "1" &&
    typeof manifest.agentId === "string" &&
    typeof manifest.baseUrl === "string" &&
    Array.isArray(manifest.routes) &&
    Boolean(manifest.artifacts) &&
    Boolean(manifest.selfCheck)
  );
}

async function readEvidenceManifest(manifestPath: string): Promise<EvidenceManifest | undefined> {
  if (!(await fileExists(manifestPath))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    return isEvidenceManifest(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeSeverity(value: unknown): Finding["severity"] {
  switch (value) {
    case "high":
    case "medium":
    case "low":
      return value;
    case "informational":
      return "low";
    default:
      return "low";
  }
}

function normalizeConfidence(value: unknown): Finding["confidence"] {
  switch (value) {
    case "high":
    case "medium":
    case "low":
      return value;
    default:
      return "medium";
  }
}

function normalizeFixStatus(value: unknown): Finding["fixStatus"] {
  switch (value) {
    case "attempted":
    case "verified":
    case "failed":
    case "none":
      return value;
    default:
      return "none";
  }
}

function normalizeFixReadiness(value: unknown): Finding["fixReadiness"] {
  switch (value) {
    case "ready":
    case "needs-protocol-evidence":
    case "needs-repo-context":
    case "needs-clean-repro":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}

function normalizeClassification(value: unknown): FindingClassification {
  switch (value) {
    case "root-cause-candidate":
    case "downstream-symptom":
    case "independent-bug":
    case "needs-clean-repro":
    case "observability":
    case "tooling":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function manifestToFindings(manifest: EvidenceManifest | undefined): Finding[] {
  if (!manifest) {
    return [];
  }
  return manifest.routes.flatMap((route) =>
    route.findings.map((finding, index): Finding => {
      const structured = typeof finding === "object" ? finding : undefined;
      const fallbackTitle = structured?.id
        ? `${structured.id}: Untitled finding`
        : `Finding ${index + 1}`;
      const title =
        typeof finding === "string"
          ? finding
          : (structured?.title ?? structured?.summary ?? structured?.description ?? fallbackTitle);
      const structuredEvidence = asStringArray(structured?.evidence);
      const reproSteps = asStringArray(structured?.reproSteps);
      const likelyFiles = asStringArray(structured?.likelyFiles);
      const rawClassification = normalizeClassification(structured?.classification);
      const rootCauseKey = asNonEmptyString(structured?.rootCauseKey);
      const observedBehavior = asNonEmptyString(structured?.observedBehavior);
      const inferredCause = asNonEmptyString(structured?.inferredCause);
      const protocolEvidence = asStringArray(structured?.protocolEvidence);
      const debugHints = asStringArray(structured?.debugHints);
      const fixReadiness = normalizeFixReadiness(structured?.fixReadiness);
      const combinedText = `${title} ${observedBehavior ?? ""} ${inferredCause ?? ""}`;
      const classification =
        rawClassification === "observability" &&
        /\b(?:chrome-devtools-axi|swarm-axi|MCP|-32001|browser tooling|AXI)\b/i.test(combinedText)
          ? "tooling"
          : rawClassification;
      return {
        title,
        route: route.path,
        agentId: manifest.agentId,
        classification,
        ...(rootCauseKey ? { rootCauseKey } : {}),
        ...(observedBehavior ? { observedBehavior } : {}),
        ...(inferredCause ? { inferredCause } : {}),
        ...(structured?.needsCleanRepro || classification === "needs-clean-repro"
          ? { needsCleanRepro: true }
          : {}),
        ...(protocolEvidence.length > 0 ? { protocolEvidence } : {}),
        ...(debugHints.length > 0 ? { debugHints } : {}),
        ...(fixReadiness ? { fixReadiness } : {}),
        severity: normalizeSeverity(structured?.severity),
        confidence: normalizeConfidence(structured?.confidence),
        evidence: [
          ...new Set([
            ...route.screenshots,
            ...structuredEvidence,
            manifest.artifacts.console,
            manifest.artifacts.network,
            ...(manifest.artifacts.realtimeTrace ? [manifest.artifacts.realtimeTrace] : []),
            manifest.artifacts.report,
          ]),
        ],
        reproSteps: reproSteps.length > 0 ? reproSteps : route.interactions,
        likelyFiles,
        fixStatus: normalizeFixStatus(structured?.fixStatus),
      };
    }),
  );
}

function outputShowsBlockedTooling(output: string): boolean {
  return [
    /run_terminal_cmd.*rejected/i,
    /rejected before execution/i,
    /could not run any shell commands/i,
    /chrome-devtools-axi.*never started/i,
    /browser cli never ran/i,
  ].some((pattern) => pattern.test(output));
}

const eventSequences = new Map<string, number>();

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function appendTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, content);
}

async function getArtifactStats(paths: AgentArtifactPaths): Promise<ArtifactStats> {
  const artifactPaths = await listAgentArtifactPaths(paths.agentDir);
  return {
    screenshots: artifactPaths.filter(
      (artifactPath) => artifactPath.startsWith("screenshots/") && isImageArtifact(artifactPath),
    ).length,
    reportWritten: await fileExists(paths.reportPath),
    manifestWritten: await fileExists(paths.evidenceManifestPath),
    consoleWritten: await fileExists(paths.consolePath),
    networkWritten: await fileExists(paths.networkPath),
    realtimeTraceWritten: await fileExists(paths.realtimeTracePath),
  };
}

function createEventLine(input: {
  agentId: string;
  phase: string;
  message: string;
  sequence: number;
  context?: Record<string, unknown>;
}): string {
  return `${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    message: input.message,
    context: {
      agentId: input.agentId,
      phase: input.phase,
      sequence: input.sequence,
      ...input.context,
    },
  })}\n`;
}

async function appendAgentEvent(input: {
  eventsPath: string;
  agentId: string;
  phase: string;
  message: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  const sequenceKey = `${input.eventsPath}:${input.agentId}`;
  const sequence = (eventSequences.get(sequenceKey) ?? 0) + 1;
  eventSequences.set(sequenceKey, sequence);
  await appendTextFile(input.eventsPath, createEventLine({ ...input, sequence }));
}

function parseSwarmEventLine(line: string): { phase: string; message: string } | undefined {
  const marker = "SWARM_EVENT";
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) {
    return undefined;
  }
  const rawJson = line.slice(markerIndex + marker.length).trim();
  if (!rawJson) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(rawJson) as { phase?: unknown; message?: unknown };
    if (typeof parsed.message !== "string") {
      return undefined;
    }
    return {
      phase: typeof parsed.phase === "string" ? parsed.phase : "agent",
      message: parsed.message,
    };
  } catch {
    return undefined;
  }
}

function hasAnyPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function isArtifactPath(value: string): boolean {
  return /\.(?:png|jpg|jpeg|webp|json|zip|md)$/i.test(value);
}

function isImageArtifact(value: string): boolean {
  return /\.(?:png|jpg|jpeg|webp)$/i.test(value);
}

function extractReferencedArtifacts(reportText: string): string[] {
  const matches = reportText.matchAll(
    /(?:file:\/\/)?(?:[A-Za-z]:)?[^\s`'")<]+?\.(?:png|jpg|jpeg|webp|json|zip)/gi,
  );
  return [...new Set([...matches].map((match) => match[0].replace(/^file:\/\//, "")))];
}

async function listAgentArtifactPaths(agentDir: string): Promise<string[]> {
  try {
    const entries = await readdir(agentDir, { recursive: true });
    return entries
      .map((entry) => entry.toString())
      .filter((entry) => isArtifactPath(entry))
      .map((entry) => entry.replaceAll(path.sep, "/"));
  } catch {
    return [];
  }
}

function artifactReferenceExists(input: {
  reference: string;
  agentDir: string;
  artifactPaths: string[];
}): boolean {
  const reference = input.reference.replaceAll("\\", "/");
  const basename = path.basename(reference);
  if (path.isAbsolute(reference)) {
    const relative = path.relative(input.agentDir, reference).replaceAll(path.sep, "/");
    return !relative.startsWith("..") && input.artifactPaths.includes(relative);
  }
  return (
    input.artifactPaths.includes(reference) ||
    input.artifactPaths.some((artifactPath) => path.basename(artifactPath) === basename)
  );
}

function reviewRealtimeTrace(text: string): {
  present: boolean;
  usable: boolean;
  reason?: string;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { present: false, usable: false };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return { present: true, usable: true };
    }
    if (!parsed || typeof parsed !== "object") {
      return { present: true, usable: false, reason: "Realtime trace is not an object or array." };
    }
    const trace = parsed as Record<string, unknown>;
    const status = typeof trace.status === "string" ? trace.status : undefined;
    const note = typeof trace.note === "string" ? trace.note : "";
    const hasEvents = Array.isArray(trace.events);
    const hasInstallSignal = typeof trace.installed === "boolean";
    const failingStatuses = new Set([
      "unavailable",
      "probe-error",
      "probe-unavailable",
      "error",
      "failed",
    ]);

    if (status && failingStatuses.has(status)) {
      return { present: true, usable: false, reason: `Realtime trace status is ${status}.` };
    }
    if (/\bfn is not a function\b/i.test(note)) {
      return {
        present: true,
        usable: false,
        reason: 'Realtime trace records AXI eval failure "fn is not a function".',
      };
    }
    if (hasEvents || hasInstallSignal || status === "captured") {
      return { present: true, usable: true };
    }
    return {
      present: true,
      usable: false,
      reason: "Realtime trace JSON did not include events, capture status, or probe install state.",
    };
  } catch {
    return { present: true, usable: false, reason: "Realtime trace is not valid JSON." };
  }
}

async function verifyCliEvidence(input: {
  output: string;
  artifactPaths: AgentArtifactPaths;
}): Promise<{
  status: "verified" | "partial" | "missing";
  score: "strong" | "partial" | "weak";
  blockedReason?: string;
  notes: string[];
}> {
  const reportText = (await fileExists(input.artifactPaths.reportPath))
    ? await readFile(input.artifactPaths.reportPath, "utf8")
    : "";
  const combined = `${input.output}\n${reportText}`;
  const networkText = (await fileExists(input.artifactPaths.networkPath))
    ? await readFile(input.artifactPaths.networkPath, "utf8")
    : "";
  const realtimeText = (await fileExists(input.artifactPaths.realtimeTracePath))
    ? await readFile(input.artifactPaths.realtimeTracePath, "utf8")
    : "";
  const networkCombined = `${combined}\n${networkText}\n${realtimeText}`;
  const realtimeTraceReview = reviewRealtimeTrace(realtimeText);
  const artifactPaths = await listAgentArtifactPaths(input.artifactPaths.agentDir);
  const referencedArtifacts = extractReferencedArtifacts(reportText);
  const imageReferences = referencedArtifacts.filter(isImageArtifact);
  const missingReferencedArtifacts = referencedArtifacts.filter(
    (reference) =>
      !artifactReferenceExists({
        reference,
        agentDir: input.artifactPaths.agentDir,
        artifactPaths,
      }),
  );
  const hasBrowserOpen = hasAnyPattern(combined, [
    /chrome-devtools-axi\s+open/i,
    /\bopen(?:ed|ing)?\s+https?:\/\//i,
  ]);
  const hasBrowserAction = hasAnyPattern(combined, [
    /chrome-devtools-axi\s+(?:click|fill|type)/i,
    /\b(?:click|filled|filling|submit|sign in)\b/i,
  ]);
  const hasConsoleArtifact = artifactPaths.some((artifactPath) =>
    artifactPath.endsWith("console.json"),
  );
  const hasNetworkArtifact = artifactPaths.some((artifactPath) =>
    artifactPath.endsWith("network.json"),
  );
  const hasConsoleCheck =
    hasConsoleArtifact ||
    hasAnyPattern(combined, [
      /chrome-devtools-axi\s+console/i,
      /\bconsole\b.*\b(?:error|errors)\b/i,
    ]);
  const hasNetworkCheck =
    hasNetworkArtifact ||
    hasAnyPattern(combined, [
      /chrome-devtools-axi\s+network/i,
      /\bnetwork\b.*\b(?:4xx|5xx|failed|200|request)/i,
    ]);
  const hasFailedRequestReview = hasAnyPattern(networkCombined, [
    /\bno\b.{0,80}\b(?:failed requests?|4xx|5xx)\b/i,
    /\b(?:failed requests?|4xx|5xx)\b.{0,80}\b(?:none|no|zero|0)\b/i,
    /\bno\s+(?:4xx|5xx)\b/i,
    /\b0\s+(?:failed requests?|4xx|5xx)\b/i,
  ]);
  const imageArtifacts = artifactPaths.filter(isImageArtifact);
  const manifest = await readEvidenceManifest(input.artifactPaths.evidenceManifestPath);
  const manifestArtifacts = manifest
    ? [
        manifest.artifacts.report,
        manifest.artifacts.console,
        manifest.artifacts.network,
        manifest.artifacts.realtimeTrace,
        manifest.artifacts.handoff,
        manifest.artifacts.trace,
        ...manifest.artifacts.screenshots,
        ...manifest.routes.flatMap((route) => route.screenshots),
      ].filter((artifact): artifact is string => Boolean(artifact))
    : [];
  const missingManifestArtifacts = manifestArtifacts.filter(
    (reference) =>
      !artifactReferenceExists({
        reference,
        agentDir: input.artifactPaths.agentDir,
        artifactPaths,
      }),
  );
  const manifestRoutesOpened = manifest?.routes.every((route) => route.opened) ?? false;
  const manifestHasInteraction =
    manifest?.routes.some((route) => route.interactions.length > 0) ?? false;
  const manifestConsoleChecked = manifest?.selfCheck.consoleInspected === true;
  const manifestNetworkChecked = manifest?.selfCheck.networkInspected === true;
  const manifestRealtimeChecked =
    manifest?.selfCheck.realtimeInspected === true ||
    (manifest?.routes.some((route) => route.realtimeChecked === true) ?? false);
  const manifestScreenshotsExist =
    manifest?.selfCheck.screenshotsExist === true && missingManifestArtifacts.length === 0;
  const manifestPathsExist =
    manifest?.selfCheck.artifactPathsExist === true && missingManifestArtifacts.length === 0;
  const missingImageReferences = imageReferences.filter(
    (reference) =>
      !artifactReferenceExists({
        reference,
        agentDir: input.artifactPaths.agentDir,
        artifactPaths,
      }),
  );
  const hasExistingScreenshot =
    imageArtifacts.length > 0 &&
    (imageReferences.length === 0 || missingImageReferences.length === 0);
  const hasRealtimeArtifact = artifactPaths.some((artifactPath) =>
    artifactPath.endsWith("realtime-trace.json"),
  );
  const hasUsableRealtimeArtifact = hasRealtimeArtifact && realtimeTraceReview.usable;
  const hasRealtimeConcern = hasAnyPattern(networkCombined, [
    /\b(?:realtime|websocket|web socket|socket-backed|ws)\b/i,
    /\b(?:optimistic|temp_|temporary id|ack|snapshot|persistence|reconcile)\b/i,
  ]);
  const hasRealtimeReview = hasAnyPattern(networkCombined, [
    /\b(?:realtime|websocket|web socket|ws)\b.{0,120}\b(?:observed|captured|missing|not captured|not exposed|no frames|ack|snapshot|payload|op)\b/i,
    /\b(?:observed|captured|missing|not captured|not exposed|no frames|ack|snapshot|payload|op)\b.{0,120}\b(?:realtime|websocket|web socket|ws)\b/i,
  ]);
  const realtimeEvidenceReady =
    !hasRealtimeConcern ||
    hasUsableRealtimeArtifact ||
    manifestRealtimeChecked ||
    hasRealtimeReview;
  const realtimeEvidenceStrong = !hasRealtimeConcern || hasUsableRealtimeArtifact;
  const blockedReason =
    manifest?.blockedReason ??
    manifest?.routes.find((route) => route.status === "blocked" && route.blockedReason)
      ?.blockedReason;

  const notes = [
    manifest
      ? "Verified evidence manifest is present."
      : "Missing evidence manifest; falling back to stdout/report artifact checks.",
    ...(manifest && missingManifestArtifacts.length > 0
      ? [`Missing manifest artifacts: ${missingManifestArtifacts.join(", ")}.`]
      : []),
    hasBrowserOpen ? "Verified browser open evidence." : "Missing browser open evidence.",
    hasBrowserAction
      ? "Verified browser interaction evidence."
      : "Missing browser interaction evidence.",
    hasConsoleCheck
      ? "Verified console inspection evidence."
      : "Missing console inspection evidence.",
    hasNetworkCheck
      ? "Verified network inspection evidence."
      : "Missing network inspection evidence.",
    hasFailedRequestReview
      ? "Verified failed-request/4xx/5xx network review."
      : "Missing explicit failed-request/4xx/5xx network review.",
    !hasRealtimeConcern
      ? "Realtime/protocol evidence not required by observed artifacts."
      : realtimeEvidenceStrong
        ? "Realtime/protocol artifact is usable."
        : realtimeEvidenceReady
          ? "Realtime/protocol concern documented, but no usable realtime trace was captured."
          : "Realtime/protocol concern detected, but no realtime trace or explicit missing-protocol review was present.",
    ...(realtimeTraceReview.present && !realtimeTraceReview.usable && realtimeTraceReview.reason
      ? [realtimeTraceReview.reason]
      : []),
    hasExistingScreenshot
      ? "Verified screenshot artifact evidence."
      : "Missing screenshot artifact evidence.",
    `Image artifacts found: ${imageArtifacts.length}.`,
    ...(missingReferencedArtifacts.length > 0
      ? [`Missing referenced artifacts: ${missingReferencedArtifacts.join(", ")}.`]
      : []),
  ];
  const requiredChecks = [
    manifest ? manifestRoutesOpened || hasBrowserOpen : hasBrowserOpen,
    manifest ? manifestHasInteraction || hasBrowserAction : hasBrowserAction,
    manifest ? manifestConsoleChecked || hasConsoleCheck : hasConsoleCheck,
    manifest ? manifestNetworkChecked || hasNetworkCheck : hasNetworkCheck,
    manifest ? manifestScreenshotsExist || hasExistingScreenshot : hasExistingScreenshot,
    manifest ? manifestPathsExist : missingReferencedArtifacts.length === 0,
  ];
  const passed = requiredChecks.filter(Boolean).length;
  if (manifest?.status === "blocked") {
    return {
      status: passed >= 3 ? "partial" : "missing",
      score: "weak",
      ...(blockedReason ? { blockedReason } : {}),
      notes: [`Agent reported blocked: ${blockedReason ?? "unknown reason"}.`, ...notes],
    };
  }
  if (passed === requiredChecks.length) {
    const score = hasFailedRequestReview && realtimeEvidenceStrong ? "strong" : "partial";
    return { status: "verified", score, notes };
  }
  if (passed >= 3) {
    return {
      status: "partial",
      score: "partial",
      ...(blockedReason ? { blockedReason } : {}),
      notes,
    };
  }
  return {
    status: "missing",
    score: "weak",
    ...(blockedReason ? { blockedReason } : {}),
    notes,
  };
}

function cliLabel(mode: RunMode): string {
  switch (mode) {
    case "cursor-cli":
      return "Cursor CLI";
    case "copilot-cli":
      return "Copilot CLI";
    case "custom-cli":
      return "custom CLI";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

function buildCliArgs(input: CreateRunInput): string[] {
  switch (input.mode) {
    case "cursor-cli": {
      const args = ["--print", "--trust", "--approve-mcps"];
      if (input.chromeMode === "axi" || input.chromeMode === "devtools-mcp") {
        args.push("--force");
      }
      if (input.model) {
        args.push("--model", input.model);
      }
      args.push(input.missionPrompt);
      return args;
    }
    case "copilot-cli":
      return [
        "-p",
        input.missionPrompt,
        "--allow-all",
        ...(input.model && input.model !== "auto" ? ["--model", input.model] : []),
      ];
    case "custom-cli":
      return [input.missionPrompt];
    default: {
      const exhaustive: never = input.mode;
      return exhaustive;
    }
  }
}

export class CliAgentClient implements AgentClient {
  public constructor(
    private readonly mode: RunMode,
    private readonly agentCommand: string,
  ) {}

  public async createRun(input: CreateRunInput): Promise<CreateRunResult> {
    if (input.mode === "cursor-cli" && input.chromeMode === "devtools-mcp") {
      await writeChromeDevtoolsMcpConfig(input.repoPath);
    }
    await writeTextFile(input.artifactPaths.promptPath, input.missionPrompt);

    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      ...Object.fromEntries(
        input.secrets.map((secret) => [`${input.secretsEnvPrefix}${secret.key}`, secret.value]),
      ),
      ...input.secretEnv,
      SWARM_AGENT_ID: input.agentId,
      SWARM_ARTIFACT_DIR: input.artifactPaths.agentDir,
      SWARM_BASE_URL: input.baseUrl,
      ...(input.browserSession
        ? {
            SWARM_BROWSER_SESSION_ID: input.browserSession.agentId,
            SWARM_BROWSER_HOME: input.browserSession.homeDir,
            SWARM_BROWSER_PROFILE_DIR: input.browserSession.profileDir,
            SWARM_BROWSER_TEMP_DIR: input.browserSession.tempDir,
            SWARM_BROWSER_SCRIPTS_DIR: input.browserSession.scriptsDir,
            ...(process.env.HOME
              ? { SWARM_NPM_CACHE_DIR: path.join(process.env.HOME, ".npm") }
              : {}),
            CHROME_DEVTOOLS_AXI_PORT: String(input.browserSession.axiPort),
            CHROME_DEVTOOLS_AXI_DISABLE_HOOKS: "1",
          }
        : {}),
    };

    const args = buildCliArgs(input);
    const label = cliLabel(this.mode);
    const startedAt = new Date().toISOString();
    try {
      await appendAgentEvent({
        eventsPath: input.eventsPath,
        agentId: input.agentId,
        phase: "start",
        message: `Launching ${label} for ${input.agentId}`,
      });
      await writeTextFile(input.artifactPaths.stdoutPath, "");
      await writeTextFile(input.artifactPaths.stderrPath, "");

      const outputChunks: string[] = [];
      let lineBuffer = "";
      let lastAgentOutputAt = Date.now();
      let firstStdoutAt: number | undefined;
      let firstArtifactAt: number | undefined;
      let latestArtifactStats: ArtifactStats = {
        screenshots: 0,
        reportWritten: false,
        manifestWritten: false,
        consoleWritten: false,
        networkWritten: false,
        realtimeTraceWritten: false,
      };
      const artifactObserver = setInterval(() => {
        void (async () => {
          try {
            const nextStats = await getArtifactStats(input.artifactPaths);
            if (!firstArtifactAt && Object.values(nextStats).some(Boolean)) {
              firstArtifactAt = Date.now();
            }
            if (nextStats.screenshots > latestArtifactStats.screenshots) {
              await appendAgentEvent({
                eventsPath: input.eventsPath,
                agentId: input.agentId,
                phase: "artifact",
                message: `${input.agentId} wrote ${nextStats.screenshots} screenshot artifact${nextStats.screenshots === 1 ? "" : "s"}`,
                context: { screenshots: nextStats.screenshots },
              });
            }
            for (const key of [
              "reportWritten",
              "manifestWritten",
              "consoleWritten",
              "networkWritten",
              "realtimeTraceWritten",
            ] as const) {
              if (!latestArtifactStats[key] && nextStats[key]) {
                await appendAgentEvent({
                  eventsPath: input.eventsPath,
                  agentId: input.agentId,
                  phase: "artifact",
                  message: `${input.agentId} wrote ${key.replace("Written", "")}`,
                  context: { artifact: key },
                });
              }
            }
            latestArtifactStats = nextStats;
          } catch {
            // Artifact observation should never crash the agent subprocess.
          }
        })();
      }, 5_000);
      const silenceWatchdog = setInterval(() => {
        const silentForMs = Date.now() - lastAgentOutputAt;
        if (silentForMs < 30_000) {
          return;
        }
        lastAgentOutputAt = Date.now();
        void appendAgentEvent({
          eventsPath: input.eventsPath,
          agentId: input.agentId,
          phase: "thinking",
          message: `${input.agentId} is still warming up or thinking (${Math.round(silentForMs / 1000)}s without streamed output)`,
          context: { silentForMs },
        });
      }, 30_000);
      const subprocess = execa(this.agentCommand, args, {
        cwd: input.repoPath,
        env,
        reject: false,
        all: true,
      });
      const abortSubprocess = (): void => {
        subprocess.kill("SIGTERM");
        setTimeout(() => {
          subprocess.kill("SIGKILL");
        }, 5_000).unref();
      };
      if (input.signal?.aborted) {
        abortSubprocess();
      }
      input.signal?.addEventListener("abort", abortSubprocess, { once: true });
      subprocess.all?.on("data", (chunk: Buffer | string) => {
        lastAgentOutputAt = Date.now();
        firstStdoutAt ??= lastAgentOutputAt;
        const raw = chunk.toString();
        const redactedChunk = redact(raw, input.secrets);
        outputChunks.push(redactedChunk);
        void appendTextFile(input.artifactPaths.stdoutPath, redactedChunk);

        lineBuffer += redactedChunk;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const event = parseSwarmEventLine(line);
          if (!event) {
            continue;
          }
          void appendAgentEvent({
            eventsPath: input.eventsPath,
            agentId: input.agentId,
            phase: event.phase,
            message: event.message,
          });
        }
      });

      const result = await subprocess;
      input.signal?.removeEventListener("abort", abortSubprocess);
      clearInterval(silenceWatchdog);
      clearInterval(artifactObserver);
      if (input.signal?.aborted) {
        latestArtifactStats = await getArtifactStats(input.artifactPaths);
        await appendAgentEvent({
          eventsPath: input.eventsPath,
          agentId: input.agentId,
          phase: "cancelled",
          message: `${input.agentId} cancelled; ${label} subprocess was terminated.`,
        });
        const report = makeCliReport({
          agentId: input.agentId,
          assignment: input.assignment,
          mode: input.mode,
          artifactPaths: input.artifactPaths,
          status: "cancelled",
          evidenceStatus: "missing",
          evidenceScore: "weak",
          findings: [],
          notes: ["Run cancelled by user before this agent completed."],
          telemetry: {
            runtimeMs: Date.now() - Date.parse(startedAt),
            ...(input.browserSession ? { axiPort: input.browserSession.axiPort } : {}),
            axiPortConflict: input.browserSession?.axiPortConflict ?? false,
            ...(input.browserSession
              ? { browserProfilePath: input.browserSession.profileDir }
              : {}),
            peakMemoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            sessionIsolationValid: input.browserSession?.sessionIsolationValid ?? true,
            screenshotsProduced: latestArtifactStats.screenshots,
            interactionsTotal: 0,
            manifestFindings: 0,
            reportWritten: latestArtifactStats.reportWritten,
            manifestWritten: latestArtifactStats.manifestWritten,
            consoleWritten: latestArtifactStats.consoleWritten,
            networkWritten: latestArtifactStats.networkWritten,
            realtimeTraceWritten: latestArtifactStats.realtimeTraceWritten,
          },
        });
        await writeAgentReport(report);
        return {
          runId: input.agentId,
          agentId: input.agentId,
          status: "cancelled",
          startedAt,
          report,
        };
      }
      latestArtifactStats = await getArtifactStats(input.artifactPaths);
      const bufferedEvent = parseSwarmEventLine(lineBuffer);
      if (bufferedEvent) {
        await appendAgentEvent({
          eventsPath: input.eventsPath,
          agentId: input.agentId,
          phase: bufferedEvent.phase,
          message: bufferedEvent.message,
        });
      }
      const output = outputChunks.join("") || redact(result.all ?? "", input.secrets);

      const verification = await verifyCliEvidence({
        output,
        artifactPaths: input.artifactPaths,
      });
      const manifest = await readEvidenceManifest(input.artifactPaths.evidenceManifestPath);
      const manifestFindings = manifestToFindings(manifest);
      const manifestInteractions = manifest
        ? manifest.routes.reduce((total, route) => total + route.interactions.length, 0)
        : 0;
      const finishedAt = Date.now();
      const telemetry: AgentRunTelemetry = {
        runtimeMs: finishedAt - Date.parse(startedAt),
        ...(input.browserSession ? { axiPort: input.browserSession.axiPort } : {}),
        ...(input.browserSession?.axiStartupMs
          ? { axiStartupMs: input.browserSession.axiStartupMs }
          : {}),
        axiPortConflict: input.browserSession?.axiPortConflict ?? false,
        ...(input.browserSession ? { browserProfilePath: input.browserSession.profileDir } : {}),
        peakMemoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        sessionIsolationValid: input.browserSession?.sessionIsolationValid ?? true,
        screenshotsProduced: latestArtifactStats.screenshots,
        interactionsTotal: manifestInteractions,
        manifestFindings: manifestFindings.length,
        reportWritten: latestArtifactStats.reportWritten,
        manifestWritten: latestArtifactStats.manifestWritten,
        consoleWritten: latestArtifactStats.consoleWritten,
        networkWritten: latestArtifactStats.networkWritten,
        realtimeTraceWritten: latestArtifactStats.realtimeTraceWritten,
        ...(firstStdoutAt ? { timeToFirstStdoutMs: firstStdoutAt - Date.parse(startedAt) } : {}),
        ...(firstArtifactAt
          ? { timeToFirstArtifactMs: firstArtifactAt - Date.parse(startedAt) }
          : {}),
      };
      const status =
        result.exitCode === 0 &&
        !outputShowsBlockedTooling(output) &&
        verification.status === "verified"
          ? "succeeded"
          : "failed";
      await appendAgentEvent({
        eventsPath: input.eventsPath,
        agentId: input.agentId,
        phase: verification.status,
        message: `Evidence ${verification.status} for ${input.agentId}`,
        context: { exitCode: result.exitCode, evidenceStatus: verification.status },
      });
      const notes = [
        `${label} exited with code ${result.exitCode}.`,
        `Evidence status: ${verification.status}.`,
        `Evidence quality: ${verification.score}.`,
        ...verification.notes,
        ...(status === "failed" && outputShowsBlockedTooling(output)
          ? ["Browser tooling was blocked or never started; inspect stdout.log."]
          : []),
        "Review stdout/stderr and any artifacts the agent produced in this directory.",
      ];
      await writeHandoffPacket({
        handoffPath: input.artifactPaths.handoffPath,
        agentId: input.agentId,
        repoPath: input.repoPath,
        assignment: input.assignment,
        findings: manifestFindings,
        notes,
      });
      const report = makeCliReport({
        agentId: input.agentId,
        assignment: input.assignment,
        mode: input.mode,
        artifactPaths: input.artifactPaths,
        status,
        evidenceStatus: verification.status,
        evidenceScore: verification.score,
        findings: manifestFindings,
        telemetry,
        notes,
        ...(verification.blockedReason ? { blockedReason: verification.blockedReason } : {}),
      });
      if (!(await fileExists(input.artifactPaths.reportPath))) {
        await writeAgentReport(report);
      }
      return { runId: input.agentId, status, startedAt, report, raw: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeTextFile(input.artifactPaths.stderrPath, redact(message, input.secrets));
      await appendAgentEvent({
        eventsPath: input.eventsPath,
        agentId: input.agentId,
        phase: "failed",
        message: `Failed to spawn ${label} command "${this.agentCommand}"`,
        context: { error: message },
      });
      const report = makeCliReport({
        agentId: input.agentId,
        assignment: input.assignment,
        mode: input.mode,
        artifactPaths: input.artifactPaths,
        status: "failed",
        notes: [
          `Failed to spawn ${label} command "${this.agentCommand}".`,
          message,
          "Install/login to the selected agent CLI or pass --agent-command with the correct binary.",
        ],
      });
      await writeAgentReport(report);
      return { runId: input.agentId, status: "failed", startedAt, report, raw: { error: message } };
    }
  }

  public async getRun(runId: string): Promise<RunStatus> {
    return {
      runId,
      status: "succeeded",
      message: `${cliLabel(this.mode)} subprocess completed synchronously.`,
    };
  }
}

export const CliCursorAgentClient = CliAgentClient;

export const writeCursorMcpConfig = writeChromeDevtoolsMcpConfig;

export const __test__ = {
  verifyCliEvidence,
  manifestToFindings,
  appendAgentEvent,
};
