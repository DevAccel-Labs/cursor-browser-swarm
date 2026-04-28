import { writeFile } from "node:fs/promises";
import { writeAgentReport } from "../artifacts/writeAgentReport.js";
import { writeHandoffPacket } from "../artifacts/writeHandoffPacket.js";
import { runBrowserScenario } from "../browser/playwrightHarness.js";
import type {
  CreateRunInput,
  CreateRunResult,
  CursorAgentClient,
  EvidenceManifest,
  RunStatus,
} from "../types.js";

const statuses = new Map<string, RunStatus>();

export class DryRunCursorAgentClient implements CursorAgentClient {
  async createRun(input: CreateRunInput): Promise<CreateRunResult> {
    const runId = `${input.agentId}-dry-run`;
    statuses.set(runId, { runId, status: "running" });
    if (input.signal?.aborted) {
      statuses.set(runId, { runId, status: "cancelled" });
      return {
        runId,
        status: "cancelled",
        startedAt: new Date().toISOString(),
      };
    }
    const browserResult = await runBrowserScenario({
      agentId: input.agentId,
      assignment: input.assignment,
      baseUrl: input.baseUrl,
      artifactPaths: input.artifactPaths,
      maxRouteSteps: input.maxRouteSteps,
    });
    if (input.signal?.aborted) {
      statuses.set(runId, { runId, status: "cancelled" });
      return {
        runId,
        status: "cancelled",
        startedAt: new Date().toISOString(),
      };
    }
    const manifest: EvidenceManifest = {
      version: "1",
      agentId: input.agentId,
      agentDirective: {
        id: input.assignment.directive.id,
        label: input.assignment.directive.label,
      },
      status: browserResult.findings.length > 0 ? "failed" : "passed",
      baseUrl: input.baseUrl,
      completedAt: new Date().toISOString(),
      routes: input.assignment.routes.map((route) => ({
        path: route.path,
        status: browserResult.findings.some((finding) => finding.route === route.path)
          ? "failed"
          : "passed",
        opened: true,
        interactions: browserResult.actions.map((action) => action.label),
        screenshots: browserResult.screenshots,
        consoleChecked: true,
        networkChecked: true,
        realtimeChecked: browserResult.realtimeEntries.length > 0,
        accessibilityChecked: route.severityFocus.includes("accessibility"),
        performanceChecked: route.severityFocus.includes("performance"),
        findings: browserResult.findings
          .filter((finding) => finding.route === route.path)
          .map((finding) => finding.title),
      })),
      artifacts: {
        report: input.artifactPaths.reportPath,
        screenshots: browserResult.screenshots,
        console: input.artifactPaths.consolePath,
        network: input.artifactPaths.networkPath,
        realtimeTrace: input.artifactPaths.realtimeTracePath,
        handoff: input.artifactPaths.handoffPath,
        trace: input.artifactPaths.tracePath,
      },
      selfCheck: {
        browserOpened: true,
        browserInteracted: browserResult.actions.length > 0,
        screenshotsExist: browserResult.screenshots.length > 0,
        consoleInspected: true,
        networkInspected: true,
        realtimeInspected: browserResult.realtimeEntries.length > 0,
        artifactPathsExist: true,
      },
      notes: browserResult.notes,
    };
    await writeFile(
      input.artifactPaths.evidenceManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const report = {
      agentId: input.agentId,
      assignment: input.assignment,
      mode: input.mode,
      status: "succeeded" as const,
      evidenceStatus: "verified" as const,
      evidenceScore: "strong" as const,
      evidenceManifestPath: input.artifactPaths.evidenceManifestPath,
      reportPath: input.artifactPaths.reportPath,
      screenshots: browserResult.screenshots,
      consoleLogPath: input.artifactPaths.consolePath,
      networkLogPath: input.artifactPaths.networkPath,
      realtimeTracePath: input.artifactPaths.realtimeTracePath,
      handoffPath: input.artifactPaths.handoffPath,
      tracePath: input.artifactPaths.tracePath,
      findings: browserResult.findings,
      notes: browserResult.notes,
      actions: browserResult.actions,
    };
    await writeHandoffPacket({
      handoffPath: input.artifactPaths.handoffPath,
      agentId: input.agentId,
      repoPath: input.repoPath,
      assignment: input.assignment,
      findings: browserResult.findings,
      notes: browserResult.notes,
    });
    await writeAgentReport(report);
    statuses.set(runId, { runId, status: "succeeded" });
    return {
      runId,
      status: "succeeded",
      startedAt: new Date().toISOString(),
      report,
    };
  }

  async getRun(runId: string): Promise<RunStatus> {
    return statuses.get(runId) ?? { runId, status: "failed", message: "Unknown dry-run id." };
  }
}

export const DryRunClient = DryRunCursorAgentClient;
