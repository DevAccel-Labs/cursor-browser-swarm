import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Finding, FindingClassification, RunMetrics, SwarmSummary } from "../types.js";

function relativeLink(runDir: string, target: string | undefined): string {
  if (!target) {
    return "";
  }
  return `./${path.relative(runDir, target).replaceAll(path.sep, "/")}`;
}

function classificationLabel(classification: FindingClassification | undefined): string {
  switch (classification) {
    case "root-cause-candidate":
      return "root cause candidate";
    case "downstream-symptom":
      return "downstream symptom";
    case "independent-bug":
      return "independent bug";
    case "needs-clean-repro":
      return "needs clean repro";
    case "observability":
      return "observability";
    case "tooling":
      return "tooling";
    case "unknown":
    case undefined:
      return "unknown";
    default: {
      const exhaustive: never = classification;
      return exhaustive;
    }
  }
}

function needsCleanRepro(finding: Finding): boolean {
  return finding.needsCleanRepro === true || finding.classification === "needs-clean-repro";
}

function rootCauseGroups(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (!finding.rootCauseKey) {
      continue;
    }
    groups.set(finding.rootCauseKey, [...(groups.get(finding.rootCauseKey) ?? []), finding]);
  }
  return groups;
}

function shortFinding(finding: Finding): string {
  return `${finding.title} (${finding.agentId}, ${finding.severity}/${finding.confidence})`;
}

export function createRunMetrics(summary: SwarmSummary): RunMetrics {
  const reports = summary.agentReports;
  const findings = reports.flatMap((report) => report.findings);
  const appFindings = findings.filter((finding) => finding.classification !== "tooling");
  const toolingFindings = findings.filter((finding) => finding.classification === "tooling");
  const groups = rootCauseGroups(appFindings);
  const inferredDuration = Math.max(
    0,
    ...reports.map((report) => report.telemetry?.runtimeMs ?? 0),
  );
  return {
    run_id: summary.runId,
    app_name: summary.appName,
    mode: summary.mode,
    ...(summary.startedAt ? { started_at: summary.startedAt } : {}),
    ...(summary.completedAt ? { completed_at: summary.completedAt } : {}),
    duration_ms: summary.durationMs ?? inferredDuration,
    agents: summary.agents,
    routes: summary.routesTested,
    evidence_verified: reports.filter((report) => report.evidenceStatus === "verified").length,
    evidence_partial: reports.filter((report) => report.evidenceStatus === "partial").length,
    evidence_missing: reports.filter(
      (report) => report.evidenceStatus === "missing" || !report.evidenceStatus,
    ).length,
    evidence_strong: reports.filter((report) => report.evidenceScore === "strong").length,
    issues_found: summary.issuesFound,
    likely_real_bugs: summary.likelyRealBugs,
    high_confidence: summary.highConfidenceIssues,
    screenshots_captured: reports.reduce(
      (total, report) =>
        total + (report.telemetry?.screenshotsProduced ?? report.screenshots.length),
      0,
    ),
    interactions_total: reports.reduce(
      (total, report) => total + (report.telemetry?.interactionsTotal ?? 0),
      0,
    ),
    manifest_findings: reports.reduce(
      (total, report) => total + (report.telemetry?.manifestFindings ?? report.findings.length),
      0,
    ),
    root_cause_groups: groups.size,
    downstream_symptoms: appFindings.filter(
      (finding) => finding.classification === "downstream-symptom",
    ).length,
    needs_clean_repro: appFindings.filter(needsCleanRepro).length,
    observability_findings: appFindings.filter(
      (finding) => finding.classification === "observability",
    ).length,
    tool_failures: toolingFindings.length,
  };
}

export async function writeRunReport(summary: SwarmSummary, runDir: string): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const metrics = createRunMetrics(summary);
  const allFindings = summary.agentReports.flatMap((report) => report.findings);
  const appFindings = allFindings.filter((finding) => finding.classification !== "tooling");
  const toolingFindings = allFindings.filter((finding) => finding.classification === "tooling");
  const groupedFindings = rootCauseGroups(appFindings);
  const highConfidenceFindings = summary.agentReports.flatMap((report) =>
    report.findings.filter(
      (finding) => finding.confidence === "high" && finding.classification !== "tooling",
    ),
  );
  const verifiedAgents = summary.agentReports.filter(
    (report) => report.evidenceStatus === "verified",
  ).length;
  const partialAgents = summary.agentReports.filter(
    (report) => report.evidenceStatus === "partial",
  ).length;
  const missingEvidenceAgents = summary.agentReports.filter(
    (report) => report.evidenceStatus === "missing" || !report.evidenceStatus,
  ).length;
  const strongEvidenceAgents = summary.agentReports.filter(
    (report) => report.evidenceScore === "strong",
  ).length;
  const lines = [
    "# Cursor Browser Swarm Run",
    "",
    "## Summary",
    "",
    `Agents: ${summary.agents}`,
    `Routes tested: ${summary.routesTested}`,
    `Issues found: ${summary.issuesFound}`,
    `Likely real bugs: ${summary.highConfidenceIssues}`,
    `Evidence verified: ${verifiedAgents}`,
    `Evidence partial: ${partialAgents}`,
    `Evidence missing: ${missingEvidenceAgents}`,
    `Evidence quality strong: ${strongEvidenceAgents}`,
    "",
    "## High-confidence issues",
    "",
  ];

  if (highConfidenceFindings.length === 0) {
    lines.push("No high-confidence issues were reported.", "");
  } else {
    highConfidenceFindings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. ${finding.title}`);
      lines.push("");
      lines.push(`Route: ${finding.route}`);
      lines.push(`Agent: ${finding.agentId}`);
      lines.push(`Severity: ${finding.severity}`);
      lines.push(`Classification: ${classificationLabel(finding.classification)}`);
      if (finding.rootCauseKey) {
        lines.push(`Root-cause group: ${finding.rootCauseKey}`);
      }
      if (finding.observedBehavior) {
        lines.push(`Observed behavior: ${finding.observedBehavior}`);
      }
      if (finding.inferredCause) {
        lines.push(`Inferred cause: ${finding.inferredCause}`);
      }
      if (finding.fixReadiness) {
        lines.push(`Fix readiness: ${finding.fixReadiness}`);
      }
      if (finding.protocolEvidence && finding.protocolEvidence.length > 0) {
        lines.push("Protocol evidence:");
        for (const protocolEvidence of finding.protocolEvidence) {
          lines.push(`- ${protocolEvidence}`);
        }
      }
      if (finding.debugHints && finding.debugHints.length > 0) {
        lines.push("Debug hints:");
        for (const debugHint of finding.debugHints) {
          lines.push(`- ${debugHint}`);
        }
      }
      if (needsCleanRepro(finding)) {
        lines.push("Follow-up: needs clean repro on an unmodified baseline.");
      }
      lines.push("Evidence:");
      for (const evidence of finding.evidence) {
        lines.push(`- ${evidence}`);
      }
      lines.push("Repro:");
      finding.reproSteps.forEach((step, stepIndex) => {
        lines.push(`${stepIndex + 1}. ${step}`);
      });
      lines.push("Likely files:");
      for (const likelyFile of finding.likelyFiles) {
        lines.push(`- ${likelyFile}`);
      }
      lines.push("");
    });
  }

  lines.push("## Root-cause debrief", "");
  if (groupedFindings.size === 0) {
    lines.push("No root-cause groups were reported.", "");
  } else {
    for (const [groupKey, findings] of groupedFindings) {
      const rootCandidates = findings.filter(
        (finding) =>
          finding.classification === "root-cause-candidate" ||
          finding.classification === "independent-bug",
      );
      const symptoms = findings.filter(
        (finding) => finding.classification === "downstream-symptom",
      );
      const cleanRepro = findings.filter(needsCleanRepro);
      lines.push(`### ${groupKey}`, "");
      lines.push(
        `Root candidates: ${
          rootCandidates.length > 0 ? rootCandidates.map(shortFinding).join("; ") : "none"
        }`,
      );
      lines.push(
        `Related symptoms: ${symptoms.length > 0 ? symptoms.map(shortFinding).join("; ") : "none"}`,
      );
      lines.push(
        `Needs clean repro: ${
          cleanRepro.length > 0 ? cleanRepro.map(shortFinding).join("; ") : "none"
        }`,
      );
      lines.push("");
    }
  }

  lines.push("## All reported application issues", "");
  if (appFindings.length === 0) {
    lines.push("No issues were reported.", "");
  } else {
    appFindings.forEach((finding, index) => {
      const rootCauseSuffix = finding.rootCauseKey ? `; group: ${finding.rootCauseKey}` : "";
      lines.push(
        `${index + 1}. ${finding.title} [${classificationLabel(finding.classification)}] (${finding.severity}, ${finding.confidence}; ${finding.agentId}; ${finding.route}${rootCauseSuffix})`,
      );
    });
    lines.push("");
  }

  lines.push("## Harness/tooling issues", "");
  if (toolingFindings.length === 0) {
    lines.push("No harness/tooling issues were reported.", "");
  } else {
    toolingFindings.forEach((finding, index) => {
      lines.push(
        `${index + 1}. ${finding.title} (${finding.severity}, ${finding.confidence}; ${finding.agentId})`,
      );
      if (finding.observedBehavior) {
        lines.push(`   Observed: ${finding.observedBehavior}`);
      }
      if (finding.inferredCause) {
        lines.push(`   Inferred: ${finding.inferredCause}`);
      }
    });
    lines.push("");
  }

  lines.push("## Agent reports", "");
  for (const report of summary.agentReports) {
    lines.push(
      `- ${report.agentId}: ${relativeLink(runDir, report.reportPath)} (${report.status}, evidence: ${report.evidenceStatus ?? "missing"}, quality: ${report.evidenceScore ?? "weak"})`,
    );
    if (report.blockedReason) {
      lines.push(`  - Blocked: ${report.blockedReason}`);
    }
    if (report.telemetry) {
      lines.push(
        `  - Telemetry: ${report.telemetry.screenshotsProduced} screenshots, ${report.telemetry.interactionsTotal} interactions, ${report.telemetry.manifestFindings} manifest findings, runtime ${report.telemetry.runtimeMs ?? "unknown"}ms`,
      );
    }
  }

  lines.push("", "## Notes", "");
  lines.push("- Secrets and credentials are redacted from generated summaries.");
  lines.push(
    "- Cloud API mode cannot directly use local Chrome DevTools MCP; use cursor-cli mode for local browser AXI validation.",
  );

  await writeFile(path.join(runDir, "final-report.md"), `${lines.join("\n")}\n`);
  await writeFile(path.join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(runDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
}

export async function writeFinalReport(
  paths: { runDir: string },
  summary: SwarmSummary,
): Promise<void> {
  await writeRunReport(summary, paths.runDir);
}
