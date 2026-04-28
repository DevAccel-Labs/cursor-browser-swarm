import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createArtifactPaths, getAgentArtifactPaths } from "../src/artifacts/artifactPaths.js";
import { summarizeFindings } from "../src/artifacts/summarizeFindings.js";
import { createRunBenchmark } from "../src/artifacts/writeBenchmarkReport.js";
import { writeAgentReport } from "../src/artifacts/writeAgentReport.js";
import { writeHandoffPacket } from "../src/artifacts/writeHandoffPacket.js";
import { writeFinalReport } from "../src/artifacts/writeRunReport.js";
import type { AgentRunReport } from "../src/types.js";

function sampleReport(reportPath: string): AgentRunReport {
  return {
    agentId: "agent-1",
    assignment: {
      agentId: "agent-1",
      index: 1,
      routes: [
        { path: "/dashboard", goal: "Test dashboard", hints: [], severityFocus: ["console"] },
      ],
    },
    mode: "dry-run",
    status: "succeeded",
    evidenceStatus: "verified",
    evidenceScore: "strong",
    reportPath,
    screenshots: ["screenshots/dashboard.png"],
    consoleLogPath: "console.json",
    networkLogPath: "network.json",
    realtimeTracePath: "realtime-trace.json",
    handoffPath: "handoff.json",
    tracePath: "trace.zip",
    findings: [
      {
        title: "Console error observed",
        route: "/dashboard",
        agentId: "agent-1",
        classification: "root-cause-candidate",
        rootCauseKey: "dashboard-console-error",
        observedBehavior: "Dashboard logs an uncaught client error after filter interaction.",
        inferredCause: "Filter state update may be throwing during render.",
        protocolEvidence: ["No WebSocket traffic involved; console error is local render path."],
        debugHints: ["Search dashboard filter reducer and render stack."],
        fixReadiness: "ready",
        severity: "medium",
        confidence: "high",
        evidence: ["console.json"],
        reproSteps: ["Open /dashboard"],
        likelyFiles: ["src/routes/dashboard.tsx"],
        fixStatus: "none",
      },
      {
        title: "Filter popover closes after the console error",
        route: "/dashboard",
        agentId: "agent-1",
        classification: "downstream-symptom",
        rootCauseKey: "dashboard-console-error",
        severity: "low",
        confidence: "medium",
        evidence: ["screenshots/dashboard.png"],
        reproSteps: ["Open /dashboard", "Click filter"],
        likelyFiles: [],
        fixStatus: "none",
      },
      {
        title: "Stale dashboard search text needs clean repro",
        route: "/dashboard",
        agentId: "agent-1",
        classification: "needs-clean-repro",
        needsCleanRepro: true,
        severity: "low",
        confidence: "medium",
        evidence: ["screenshots/dashboard.png"],
        reproSteps: ["Open /dashboard", "Reopen search"],
        likelyFiles: [],
        fixStatus: "none",
      },
      {
        title: "chrome-devtools-axi bridge timed out",
        route: "/dashboard",
        agentId: "agent-1",
        classification: "tooling",
        rootCauseKey: "axi-timeout",
        observedBehavior: "AXI snapshot returned MCP -32001.",
        severity: "medium",
        confidence: "high",
        evidence: ["stdout.log"],
        reproSteps: ["Run chrome-devtools-axi snapshot"],
        likelyFiles: [],
        fixStatus: "none",
      },
    ],
    telemetry: {
      runtimeMs: 1234,
      axiPort: 31001,
      axiPortConflict: false,
      browserProfilePath: "/tmp/agent-1/browser-profile",
      peakMemoryMb: 128,
      sessionIsolationValid: true,
      screenshotsProduced: 2,
      interactionsTotal: 3,
      manifestFindings: 1,
      reportWritten: true,
      manifestWritten: true,
      consoleWritten: true,
      networkWritten: true,
      realtimeTraceWritten: false,
    },
    notes: ["ok"],
  };
}

describe("artifact reports", () => {
  it("writes agent and final reports with evidence links", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "swarm-report-"));
    const runPaths = createArtifactPaths(dir);
    const paths = getAgentArtifactPaths(runPaths, "agent-1");
    const report = sampleReport(paths.reportPath);
    await writeAgentReport(report);
    const summary = summarizeFindings({
      runId: "run-1",
      appName: "Demo",
      mode: "dry-run",
      startedAt: "2026-04-27T00:00:00.000Z",
      completedAt: "2026-04-27T00:00:01.234Z",
      durationMs: 1234,
      agents: 1,
      routesTested: 1,
      reports: [report],
    });
    await writeFinalReport(runPaths, summary);

    const agentText = await readFile(paths.reportPath, "utf8");
    const finalText = await readFile(path.join(dir, "final-report.md"), "utf8");
    const metrics = JSON.parse(await readFile(path.join(dir, "metrics.json"), "utf8")) as {
      duration_ms: number;
      evidence_strong: number;
      screenshots_captured: number;
      interactions_total: number;
      manifest_findings: number;
      root_cause_groups: number;
      downstream_symptoms: number;
      needs_clean_repro: number;
      tool_failures: number;
    };
    expect(agentText).toContain("Console error observed");
    expect(agentText).toContain("Root-cause group: dashboard-console-error");
    expect(agentText).toContain("Fix readiness: ready");
    expect(agentText).toContain("Protocol evidence:");
    expect(agentText).toContain("Debug hints:");
    expect(finalText).toContain("Issues found: 3");
    expect(finalText).toContain("## Root-cause debrief");
    expect(finalText).toContain("### dashboard-console-error");
    expect(finalText).toContain("Related symptoms: Filter popover closes after the console error");
    expect(finalText).toContain("## All reported application issues");
    expect(finalText).toContain(
      "Console error observed [root cause candidate] (medium, high; agent-1; /dashboard; group: dashboard-console-error)",
    );
    expect(finalText).toContain("## Harness/tooling issues");
    expect(finalText).toContain("chrome-devtools-axi bridge timed out");
    expect(finalText).toContain("Evidence verified: 1");
    expect(finalText).toContain("evidence: verified");
    expect(finalText).toContain("2 screenshots, 3 interactions, 1 manifest findings");
    expect(finalText).toContain("console.json");
    expect(agentText).toContain("Handoff packet: handoff.json");
    expect(metrics).toMatchObject({
      duration_ms: 1234,
      evidence_strong: 1,
      screenshots_captured: 2,
      interactions_total: 3,
      manifest_findings: 1,
      root_cause_groups: 1,
      downstream_symptoms: 1,
      needs_clean_repro: 1,
      tool_failures: 1,
    });
  });

  it("creates benchmark data for scalability charts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "swarm-benchmark-"));
    const runPaths = createArtifactPaths(dir);
    const paths = getAgentArtifactPaths(runPaths, "agent-1");
    const report = sampleReport(paths.reportPath);
    const summary = summarizeFindings({
      runId: "run-1",
      appName: "Demo",
      mode: "cursor-cli",
      durationMs: 1234,
      agents: 1,
      routesTested: 1,
      reports: [report],
    });
    const benchmark = createRunBenchmark({
      summary,
      config: {
        repoPath: ".",
        baseUrl: "http://localhost:3000",
        routesPath: "routes.json",
        secrets: [],
        secretEnv: {},
        secretsEnvPrefix: "SWARM_SECRET_",
        interactiveSecrets: false,
        agents: 1,
        agentConcurrency: 1,
        assignmentStrategy: "replicate",
        mode: "cursor-cli",
        runId: "run-1",
        outDir: dir,
        cursorCommand: "agent",
        chromeMode: "axi",
        axiPortBase: 31_000,
        maxRouteSteps: 12,
        noDevServer: true,
        routeConfig: { appName: "Demo", routes: [] },
      },
      instrumentation: {
        preflightMs: 100,
        firstAgentStartMs: 120,
        lastAgentCompleteMs: 1234,
        totalWallClockMs: 1234,
        memoryPeakMb: 512,
        chromeProcessesSpawned: 1,
        portCollisions: 0,
        startupFailures: 0,
        profileConflicts: 0,
        tempDirCollisions: 0,
        stateBleedEvents: 0,
      },
    });

    expect(benchmark.config).toMatchObject({
      agents: 1,
      agent_concurrency: 1,
      axi_port_base: 31_000,
      isolation_mode: "per-agent",
    });
    expect(benchmark.resources).toMatchObject({
      memory_peak_mb: 512,
      port_collisions: 0,
    });
    expect(benchmark.classification.tooling_findings).toBe(1);
  });

  it("writes a repo-aware handoff packet with search terms", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "swarm-handoff-"));
    const handoffPath = path.join(dir, "handoff.json");
    const report = sampleReport(path.join(dir, "report.md"));
    const firstFinding = report.findings[0];
    if (!firstFinding) {
      throw new Error("sample report must include a finding");
    }

    await writeHandoffPacket({
      handoffPath,
      agentId: report.agentId,
      repoPath: dir,
      assignment: report.assignment,
      findings: [
        {
          ...firstFinding,
          observedBehavior: "Optimistic temp_123 card vanished after realtime ack was missing.",
          protocolEvidence: ["No card.added ack after outbound card.created payload."],
          debugHints: ["Search sendOperation and card.created"],
        },
      ],
      notes: ["handoff ready"],
    });

    const handoff = JSON.parse(await readFile(handoffPath, "utf8")) as {
      findings: Array<{ suggestedSearchTerms: string[]; protocolEvidence: string[] }>;
      repoContext: { changedFiles: string[] };
    };
    expect(handoff.repoContext.changedFiles).toEqual([]);
    expect(handoff.findings[0]?.protocolEvidence).toContain(
      "No card.added ack after outbound card.created payload.",
    );
    expect(handoff.findings[0]?.suggestedSearchTerms).toEqual(
      expect.arrayContaining(["card.added", "card.created", "sendOperation", "temp_"]),
    );
  });
});
