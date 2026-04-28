import type { AgentRunReport, SwarmSummary } from "../types.js";

export function summarizeFindings(input: {
  runId: string;
  appName: string;
  mode: SwarmSummary["mode"];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  agents: number;
  routesTested: number;
  reports: AgentRunReport[];
}): SwarmSummary {
  const findings = input.reports.flatMap((report) => report.findings);
  const appFindings = findings.filter((finding) => finding.classification !== "tooling");

  return {
    runId: input.runId,
    appName: input.appName,
    mode: input.mode,
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    ...(typeof input.durationMs === "number" ? { durationMs: input.durationMs } : {}),
    agents: input.agents,
    routesTested: input.routesTested,
    issuesFound: appFindings.length,
    likelyRealBugs: appFindings.filter((finding) => finding.confidence === "high").length,
    highConfidenceIssues: appFindings.filter((finding) => finding.confidence === "high").length,
    agentReports: input.reports,
  };
}
