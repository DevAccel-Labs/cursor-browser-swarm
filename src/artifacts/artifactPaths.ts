import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { AgentArtifactPaths, ArtifactPaths } from "../types.js";

export function makeRunId(now = new Date()): string {
  const stamp = now
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  return stamp.replaceAll("T", "-").replaceAll("Z", "");
}

export function getArtifactPaths(outDir: string): ArtifactPaths {
  return {
    runDir: outDir,
    agentsDir: path.join(outDir, "agents"),
    eventsPath: path.join(outDir, "events.jsonl"),
    finalReportPath: path.join(outDir, "final-report.md"),
    summaryJsonPath: path.join(outDir, "summary.json"),
    metricsJsonPath: path.join(outDir, "metrics.json"),
    benchmarkJsonPath: path.join(outDir, "benchmark.json"),
    benchmarkCsvPath: path.join(outDir, "benchmark.csv"),
  };
}

export const createArtifactPaths = getArtifactPaths;

export function getAgentArtifactPaths(
  runPaths: ArtifactPaths,
  agentId: string,
): AgentArtifactPaths {
  const agentDir = path.join(runPaths.agentsDir, agentId);
  return {
    agentDir,
    screenshotsDir: path.join(agentDir, "screenshots"),
    browserHomeDir: path.join(agentDir, "browser-home"),
    browserProfileDir: path.join(agentDir, "browser-profile"),
    tempDir: path.join(agentDir, "tmp"),
    scriptsDir: path.join(agentDir, "scripts"),
    evidenceManifestPath: path.join(agentDir, "evidence-manifest.json"),
    axiHelperPath: path.join(agentDir, "swarm-axi.mjs"),
    reportPath: path.join(agentDir, "report.md"),
    consolePath: path.join(agentDir, "console.json"),
    networkPath: path.join(agentDir, "network.json"),
    realtimeTracePath: path.join(agentDir, "realtime-trace.json"),
    handoffPath: path.join(agentDir, "handoff.json"),
    tracePath: path.join(agentDir, "trace.zip"),
    promptPath: path.join(agentDir, "prompt.md"),
    stdoutPath: path.join(agentDir, "stdout.log"),
    stderrPath: path.join(agentDir, "stderr.log"),
  };
}

export async function ensureRunDirectories(paths: ArtifactPaths): Promise<void> {
  await mkdir(paths.agentsDir, { recursive: true });
}

export async function ensureAgentDirectories(paths: AgentArtifactPaths): Promise<void> {
  await mkdir(paths.screenshotsDir, { recursive: true });
  await mkdir(paths.browserHomeDir, { recursive: true });
  await mkdir(paths.browserProfileDir, { recursive: true });
  await mkdir(paths.tempDir, { recursive: true });
  await mkdir(paths.scriptsDir, { recursive: true });
}
