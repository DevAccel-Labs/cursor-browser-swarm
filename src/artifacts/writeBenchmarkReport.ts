import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunBenchmark, SwarmRunConfig, SwarmSummary } from "../types.js";

export interface BenchmarkInstrumentation {
  preflightMs: number;
  firstAgentStartMs: number;
  lastAgentCompleteMs: number;
  totalWallClockMs: number;
  memoryPeakMb: number;
  chromeProcessesSpawned: number;
  portCollisions: number;
  startupFailures: number;
  profileConflicts: number;
  tempDirCollisions: number;
  stateBleedEvents: number;
}

function csvEscape(value: string | number): string {
  const raw = String(value);
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function createRunBenchmark(input: {
  summary: SwarmSummary;
  config: SwarmRunConfig;
  instrumentation: BenchmarkInstrumentation;
}): RunBenchmark {
  const allFindings = input.summary.agentReports.flatMap((report) => report.findings);
  const appFindings = allFindings.filter((finding) => finding.classification !== "tooling");
  const toolingFindings = allFindings.filter((finding) => finding.classification === "tooling");
  return {
    run_id: input.summary.runId,
    config: {
      agents: input.config.agents,
      agent_concurrency: input.config.agentConcurrency,
      axi_port_base: input.config.axiPortBase,
      isolation_mode:
        input.config.mode === "cursor-cli" && input.config.chromeMode === "axi"
          ? "per-agent"
          : "shared",
    },
    timing: {
      preflight_ms: input.instrumentation.preflightMs,
      first_agent_start_ms: input.instrumentation.firstAgentStartMs,
      last_agent_complete_ms: input.instrumentation.lastAgentCompleteMs,
      total_wall_clock_ms: input.instrumentation.totalWallClockMs,
      agent_runtimes_ms: input.summary.agentReports
        .map((report) => report.telemetry?.runtimeMs)
        .filter((runtime): runtime is number => typeof runtime === "number"),
    },
    resources: {
      port_collisions: input.instrumentation.portCollisions,
      startup_failures: input.instrumentation.startupFailures,
      memory_peak_mb: input.instrumentation.memoryPeakMb,
      chrome_processes_spawned: input.instrumentation.chromeProcessesSpawned,
    },
    isolation: {
      profile_conflicts: input.instrumentation.profileConflicts,
      temp_dir_collisions: input.instrumentation.tempDirCollisions,
      state_bleed_events: input.instrumentation.stateBleedEvents,
    },
    classification: {
      app_findings: appFindings.length,
      tooling_findings: toolingFindings.length,
      unclassified: allFindings.filter(
        (finding) => !finding.classification || finding.classification === "unknown",
      ).length,
    },
  };
}

export function benchmarkToCsv(benchmark: RunBenchmark): string {
  const headers = [
    "run_id",
    "agents",
    "agent_concurrency",
    "axi_port_base",
    "isolation_mode",
    "preflight_ms",
    "first_agent_start_ms",
    "last_agent_complete_ms",
    "total_wall_clock_ms",
    "avg_agent_runtime_ms",
    "port_collisions",
    "startup_failures",
    "memory_peak_mb",
    "chrome_processes_spawned",
    "profile_conflicts",
    "temp_dir_collisions",
    "state_bleed_events",
    "app_findings",
    "tooling_findings",
    "unclassified",
  ];
  const averageRuntime =
    benchmark.timing.agent_runtimes_ms.length > 0
      ? Math.round(
          benchmark.timing.agent_runtimes_ms.reduce((sum, runtime) => sum + runtime, 0) /
            benchmark.timing.agent_runtimes_ms.length,
        )
      : 0;
  const row = [
    benchmark.run_id,
    benchmark.config.agents,
    benchmark.config.agent_concurrency,
    benchmark.config.axi_port_base,
    benchmark.config.isolation_mode,
    benchmark.timing.preflight_ms,
    benchmark.timing.first_agent_start_ms,
    benchmark.timing.last_agent_complete_ms,
    benchmark.timing.total_wall_clock_ms,
    averageRuntime,
    benchmark.resources.port_collisions,
    benchmark.resources.startup_failures,
    benchmark.resources.memory_peak_mb,
    benchmark.resources.chrome_processes_spawned,
    benchmark.isolation.profile_conflicts,
    benchmark.isolation.temp_dir_collisions,
    benchmark.isolation.state_bleed_events,
    benchmark.classification.app_findings,
    benchmark.classification.tooling_findings,
    benchmark.classification.unclassified,
  ];
  return `${headers.join(",")}\n${row.map(csvEscape).join(",")}\n`;
}

export async function writeBenchmarkReport(input: {
  summary: SwarmSummary;
  config: SwarmRunConfig;
  instrumentation: BenchmarkInstrumentation;
  runDir: string;
}): Promise<RunBenchmark> {
  const benchmark = createRunBenchmark(input);
  await mkdir(input.runDir, { recursive: true });
  await writeFile(
    path.join(input.runDir, "benchmark.json"),
    `${JSON.stringify(benchmark, null, 2)}\n`,
  );
  await writeFile(path.join(input.runDir, "benchmark.csv"), benchmarkToCsv(benchmark));
  return benchmark;
}
