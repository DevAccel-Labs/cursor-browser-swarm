import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRunReport, Finding } from "../types.js";

function findingToMarkdown(finding: Finding, index: number): string {
  const evidence = finding.evidence.map((item) => `- ${item}`).join("\n") || "- none";
  const repro =
    finding.reproSteps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`).join("\n") ||
    "1. No reproduction steps captured.";
  const likelyFiles = finding.likelyFiles.map((file) => `- ${file}`).join("\n") || "- unknown";
  const details = [
    finding.classification ? `Classification: ${finding.classification}` : undefined,
    finding.rootCauseKey ? `Root-cause group: ${finding.rootCauseKey}` : undefined,
    finding.observedBehavior ? `Observed behavior: ${finding.observedBehavior}` : undefined,
    finding.inferredCause ? `Inferred cause: ${finding.inferredCause}` : undefined,
    finding.fixReadiness ? `Fix readiness: ${finding.fixReadiness}` : undefined,
    finding.protocolEvidence && finding.protocolEvidence.length > 0
      ? `Protocol evidence: ${finding.protocolEvidence.join("; ")}`
      : undefined,
    finding.debugHints && finding.debugHints.length > 0
      ? `Debug hints: ${finding.debugHints.join("; ")}`
      : undefined,
    finding.needsCleanRepro ? "Follow-up: needs clean repro on an unmodified baseline." : undefined,
  ].filter((line): line is string => Boolean(line));

  return [
    `### ${index + 1}. ${finding.title}`,
    "",
    `Route: ${finding.route}`,
    `Severity: ${finding.severity}`,
    `Confidence: ${finding.confidence}`,
    ...(details.length > 0 ? ["", ...details] : []),
    "",
    "Evidence:",
    evidence,
    "",
    "Repro:",
    repro,
    "",
    "Likely files:",
    likelyFiles,
  ].join("\n");
}

export function renderAgentReport(report: AgentRunReport): string {
  const routes = report.assignment.routes
    .map((route) => `- ${route.path}: ${route.goal}`)
    .join("\n");
  const screenshots =
    report.screenshots.map((screenshot) => `- ${screenshot}`).join("\n") || "- none";
  const findings =
    report.findings.length > 0
      ? report.findings.map((finding, index) => findingToMarkdown(finding, index)).join("\n\n")
      : "No findings captured.";
  const notes = report.notes.map((note) => `- ${note}`).join("\n") || "- none";
  const telemetry = report.telemetry
    ? [
        `- Runtime: ${report.telemetry.runtimeMs ?? "unknown"}ms`,
        `- Time to first stdout: ${report.telemetry.timeToFirstStdoutMs ?? "unknown"}ms`,
        `- Time to first artifact: ${report.telemetry.timeToFirstArtifactMs ?? "unknown"}ms`,
        `- AXI port: ${report.telemetry.axiPort ?? "n/a"}`,
        `- AXI startup: ${report.telemetry.axiStartupMs ?? "unknown"}ms`,
        `- AXI port conflict: ${report.telemetry.axiPortConflict ? "yes" : "no"}`,
        `- Session isolation valid: ${report.telemetry.sessionIsolationValid ? "yes" : "no"}`,
        `- Browser profile: ${report.telemetry.browserProfilePath ?? "n/a"}`,
        `- Peak harness memory: ${report.telemetry.peakMemoryMb ?? "unknown"} MB`,
        `- Screenshots produced: ${report.telemetry.screenshotsProduced}`,
        `- Interactions total: ${report.telemetry.interactionsTotal}`,
        `- Manifest findings: ${report.telemetry.manifestFindings}`,
      ].join("\n")
    : "- none";

  return [
    `# ${report.agentId} Report`,
    "",
    `Evidence status: ${report.evidenceStatus ?? "missing"}`,
    `Evidence quality: ${report.evidenceScore ?? "weak"}`,
    report.blockedReason ? `Blocked reason: ${report.blockedReason}` : undefined,
    "",
    "## Mission",
    routes,
    "",
    "## Evidence",
    `- Manifest: ${report.evidenceManifestPath ?? "none"}`,
    `- Console log: ${report.consoleLogPath ?? "none"}`,
    `- Network log: ${report.networkLogPath ?? "none"}`,
    `- Realtime trace: ${report.realtimeTracePath ?? "none"}`,
    `- Handoff packet: ${report.handoffPath ?? "none"}`,
    `- Trace: ${report.tracePath ?? "none"}`,
    "",
    "Screenshots:",
    screenshots,
    "",
    "## Findings",
    findings,
    "",
    "## Notes",
    notes,
    "",
    "## Telemetry",
    telemetry,
    "",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export async function writeAgentReport(report: AgentRunReport): Promise<AgentRunReport> {
  await mkdir(path.dirname(report.reportPath), { recursive: true });
  await writeFile(report.reportPath, renderAgentReport(report), "utf8");
  return report;
}
