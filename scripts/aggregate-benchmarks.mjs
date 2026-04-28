#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

async function collectBenchmarkFiles(root) {
  const info = await stat(root);
  if (info.isFile()) {
    return path.basename(root) === "benchmark.json" ? [root] : [];
  }
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(root, entry.name);
      return entry.isDirectory()
        ? collectBenchmarkFiles(entryPath)
        : collectBenchmarkFiles(entryPath);
    }),
  );
  return nested.flat();
}

function csvEscape(value) {
  const raw = String(value ?? "");
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function average(values) {
  return values.length > 0
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node scripts/aggregate-benchmarks.mjs <run-dir-or-benchmark.json>...");
  process.exit(1);
}

const files = (await Promise.all(roots.map((root) => collectBenchmarkFiles(path.resolve(root)))))
  .flat()
  .sort();

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

console.log(headers.join(","));
for (const file of files) {
  const benchmark = JSON.parse(await readFile(file, "utf8"));
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
    average(benchmark.timing.agent_runtimes_ms ?? []),
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
  console.log(row.map(csvEscape).join(","));
}
