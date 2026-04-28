import { appendFile, mkdir } from "node:fs/promises";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import path from "node:path";
import type { AgentConcurrency, AgentConcurrencyMode, ChromeMode, RunMode } from "../types.js";

export interface ResourceSnapshot {
  timestamp: string;
  elapsedMs: number;
  cpuCount: number;
  loadAverage1m: number;
  loadPerCpu: number;
  totalMemoryMb: number;
  freeMemoryMb: number;
  usedMemoryPercent: number;
  processRssMb: number;
}

export interface AdaptiveDecision {
  timestamp: string;
  elapsedMs: number;
  from: number;
  to: number;
  reason: string;
  usedMemoryPercent: number;
  loadPerCpu: number;
}

export interface ResourceSummary {
  peakProcessRssMb: number;
  peakSystemMemoryPercent: number;
  peakLoadAverage1m: number;
}

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

export function collectResourceSnapshot(startedAt: number): ResourceSnapshot {
  const totalMemoryMb = mb(totalmem());
  const freeMemoryMb = mb(freemem());
  const usedMemoryPercent =
    totalMemoryMb > 0 ? Math.round(((totalMemoryMb - freeMemoryMb) / totalMemoryMb) * 100) : 0;
  const cpuCount = Math.max(cpus().length, 1);
  const loadAverage1m = loadavg()[0] ?? 0;
  return {
    timestamp: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    cpuCount,
    loadAverage1m,
    loadPerCpu: Number((loadAverage1m / cpuCount).toFixed(2)),
    totalMemoryMb,
    freeMemoryMb,
    usedMemoryPercent,
    processRssMb: mb(process.memoryUsage().rss),
  };
}

export function estimateInitialConcurrency(input: {
  requested: AgentConcurrency;
  agents: number;
  mode: RunMode;
  chromeMode: ChromeMode;
  snapshot: ResourceSnapshot;
}): {
  concurrency: number;
  mode: AgentConcurrencyMode;
  reason: string;
} {
  if (input.requested !== "auto") {
    return {
      concurrency: input.requested,
      mode: "fixed",
      reason: "fixed concurrency requested",
    };
  }

  const perAgentMemoryMb =
    input.mode === "cursor-cli" && input.chromeMode === "axi"
      ? 1_200
      : input.mode === "cloud-api"
        ? 250
        : input.mode === "dry-run"
          ? 700
          : 500;
  const perAgentCpu =
    input.mode === "cursor-cli" && input.chromeMode === "axi"
      ? 1.25
      : input.mode === "cloud-api"
        ? 0.25
        : input.mode === "dry-run"
          ? 0.75
          : 0.5;
  const memoryBudgetMb = Math.max(
    input.snapshot.totalMemoryMb * 0.5,
    input.snapshot.freeMemoryMb * 0.8,
  );
  const memoryBound = Math.max(1, Math.floor(memoryBudgetMb / perAgentMemoryMb));
  const cpuBound = Math.max(1, Math.floor(input.snapshot.cpuCount / perAgentCpu));
  const concurrency = Math.max(1, Math.min(input.agents, memoryBound, cpuBound));
  return {
    concurrency,
    mode: "auto",
    reason: `auto from ${input.snapshot.cpuCount} CPUs, ${input.snapshot.freeMemoryMb} MB free memory`,
  };
}

export function recommendAdaptiveConcurrency(input: {
  current: number;
  max: number;
  snapshot: ResourceSnapshot;
}): { next: number; reason?: string } {
  if (input.snapshot.usedMemoryPercent >= 88) {
    return {
      next: Math.max(1, Math.floor(input.current * 0.65)),
      reason: `system memory pressure ${input.snapshot.usedMemoryPercent}%`,
    };
  }
  if (input.snapshot.loadPerCpu >= 2.5) {
    return {
      next: Math.max(1, input.current - 1),
      reason: `load per CPU ${input.snapshot.loadPerCpu}`,
    };
  }
  if (
    input.current < input.max &&
    input.snapshot.usedMemoryPercent <= 72 &&
    input.snapshot.loadPerCpu <= 1.2
  ) {
    return {
      next: Math.min(input.max, input.current + 1),
      reason: `resource headroom ${input.snapshot.usedMemoryPercent}% memory, ${input.snapshot.loadPerCpu} load/CPU`,
    };
  }
  return { next: input.current };
}

export function startResourceSampler(input: {
  samplesPath: string;
  startedAt: number;
  intervalMs?: number;
}): {
  latest: () => ResourceSnapshot;
  stop: () => void;
  summary: () => ResourceSummary;
} {
  let latest = collectResourceSnapshot(input.startedAt);
  const samples: ResourceSnapshot[] = [latest];
  void mkdir(path.dirname(input.samplesPath), { recursive: true }).then(() =>
    appendFile(input.samplesPath, `${JSON.stringify(latest)}\n`),
  );
  const timer = setInterval(() => {
    latest = collectResourceSnapshot(input.startedAt);
    samples.push(latest);
    void appendFile(input.samplesPath, `${JSON.stringify(latest)}\n`);
  }, input.intervalMs ?? 2_000);
  return {
    latest: () => latest,
    stop: () => clearInterval(timer),
    summary: () => ({
      peakProcessRssMb: Math.max(...samples.map((sample) => sample.processRssMb)),
      peakSystemMemoryPercent: Math.max(...samples.map((sample) => sample.usedMemoryPercent)),
      peakLoadAverage1m: Math.max(...samples.map((sample) => sample.loadAverage1m)),
    }),
  };
}
