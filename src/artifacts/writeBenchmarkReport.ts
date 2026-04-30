import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isReportableApplicationIssue, isToolingFinding } from "./findingFilters.js";
import type { RunBenchmark, SwarmRunConfig, SwarmSummary } from "../types.js";

export interface BenchmarkInstrumentation {
  preflightMs: number;
  firstAgentStartMs: number;
  lastAgentCompleteMs: number;
  totalWallClockMs: number;
  memoryPeakMb: number;
  systemMemoryPeakPercent: number;
  systemLoadPeak1m: number;
  chromeProcessesSpawned: number;
  portCollisions: number;
  startupFailures: number;
  profileConflicts: number;
  tempDirCollisions: number;
  stateBleedEvents: number;
  resourceSamplesPath: string;
  initialConcurrency: number;
  maxObservedConcurrency: number;
  adaptiveDecisions: number;
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
  const appFindings = allFindings.filter(isReportableApplicationIssue);
  const toolingFindings = allFindings.filter(isToolingFinding);
  return {
    run_id: input.summary.runId,
    config: {
      agents: input.config.agents,
      agent_concurrency: input.config.agentConcurrency,
      requested_agent_concurrency: input.config.requestedAgentConcurrency,
      agent_concurrency_mode: input.config.agentConcurrencyMode,
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
      orchestrator_memory_peak_mb: input.instrumentation.memoryPeakMb,
      system_memory_peak_percent: input.instrumentation.systemMemoryPeakPercent,
      system_load_peak_1m: input.instrumentation.systemLoadPeak1m,
      chrome_processes_spawned: input.instrumentation.chromeProcessesSpawned,
      resource_samples_path: input.instrumentation.resourceSamplesPath,
    },
    adaptive: {
      initial_concurrency: input.instrumentation.initialConcurrency,
      max_observed_concurrency: input.instrumentation.maxObservedConcurrency,
      decisions: input.instrumentation.adaptiveDecisions,
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
    "requested_agent_concurrency",
    "agent_concurrency_mode",
    "axi_port_base",
    "isolation_mode",
    "preflight_ms",
    "first_agent_start_ms",
    "last_agent_complete_ms",
    "total_wall_clock_ms",
    "avg_agent_runtime_ms",
    "port_collisions",
    "startup_failures",
    "orchestrator_memory_peak_mb",
    "system_memory_peak_percent",
    "system_load_peak_1m",
    "chrome_processes_spawned",
    "resource_samples_path",
    "initial_concurrency",
    "max_observed_concurrency",
    "adaptive_decisions",
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
    benchmark.config.requested_agent_concurrency,
    benchmark.config.agent_concurrency_mode,
    benchmark.config.axi_port_base,
    benchmark.config.isolation_mode,
    benchmark.timing.preflight_ms,
    benchmark.timing.first_agent_start_ms,
    benchmark.timing.last_agent_complete_ms,
    benchmark.timing.total_wall_clock_ms,
    averageRuntime,
    benchmark.resources.port_collisions,
    benchmark.resources.startup_failures,
    benchmark.resources.orchestrator_memory_peak_mb,
    benchmark.resources.system_memory_peak_percent,
    benchmark.resources.system_load_peak_1m,
    benchmark.resources.chrome_processes_spawned,
    benchmark.resources.resource_samples_path,
    benchmark.adaptive.initial_concurrency,
    benchmark.adaptive.max_observed_concurrency,
    benchmark.adaptive.decisions,
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
