#!/usr/bin/env node
import process from "node:process";
import { Command } from "commander";
import pc from "picocolors";
import { parseCliOptions } from "./config.js";
import { loadEnvFile } from "./env.js";
import { runSwarm } from "./runner/runSwarm.js";
import { createHandoffRoutes } from "./reactgrab/handoff.js";
import { startUiServer } from "./ui/server.js";

await loadEnvFile(process.cwd());

const program = new Command();

program
  .name("cursor-browser-swarm")
  .description("Parallel browser validation for Cursor agents.")
  .version("0.1.0");

program
  .command("run")
  .description("Run browser-validation missions against a local app.")
  .option("--repo <path>", "Repository/app directory for source context and handoff hints.")
  .option("--dev <command>", "Dev server command. If omitted, use --no-dev-server.")
  .option("--no-dev-server", "Assume the dev server is already running.")
  .requiredOption("--base-url <url>", "Base URL of the running app.")
  .option("--routes <path>", "Routes/scenarios JSON. Defaults to <repo>/swarm.routes.json.")
  .option("--instructions <path>", "Markdown instructions injected into every agent mission.")
  .option("--secret <KEY=VALUE>", "Sensitive test credential. Repeatable.", collect, [])
  .option("--secrets-env-prefix <prefix>", "Prefix for secret env vars.", "SWARM_SECRET_")
  .option("--agents <number>", "Number of agents, 1-1000.", "4")
  .option(
    "--agent-concurrency <number|auto>",
    "Max agent subprocesses to run in parallel, or auto to tune from local resources.",
  )
  .option(
    "--assignment-strategy <strategy>",
    "split routes or replicate all routes per agent.",
    "replicate",
  )
  .option(
    "--agent-personas <list>",
    "Comma-separated built-in agent personas (balanced, destructive, security, realtime, accessibility, edge-inputs).",
  )
  .option(
    "--agent-directive <ID=INSTRUCTIONS>",
    "Custom agent directive/persona. Repeat to assign multiple directives round-robin.",
    collect,
    [],
  )
  .option("--mode <mode>", "dry-run, cursor-cli, cursor-sdk, or cloud-api.", "dry-run")
  .option("--run-id <id>", "Deterministic run id.")
  .option("--out-dir <path>", "Output directory.")
  .option("--cursor-command <command>", "Cursor CLI command.", "agent")
  .option("--model <model>", "Cursor model to request for agent runs.")
  .option("--chrome-mode <mode>", "playwright, devtools-mcp, or axi.")
  .option("--axi-port-base <port>", "First local port used for isolated per-agent AXI bridges.")
  .option("--max-route-steps <number>", "Max safe interactions per route.", "12")
  .option("--context-packet <path>", "ReactGrab context packet JSON.")
  .action(async (options: Record<string, unknown>) => {
    try {
      const result = await runSwarm(parseCliOptions(options));
      console.log(pc.green("Cursor Browser Swarm run complete."));
      console.log(`Run id: ${result.config.runId}`);
      console.log(`Output: ${result.config.outDir}`);
      console.log(`Final report: ${result.finalReportPath}`);
      console.log(`Benchmark: ${result.benchmarkJsonPath}`);
    } catch (error) {
      console.error(pc.red(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  });

program
  .command("ui")
  .description("Start a local control panel for configuring and launching swarm runs.")
  .option("--host <host>", "Host to bind.", "127.0.0.1")
  .option("--port <number>", "Port to bind.", "4517")
  .action(async (options: { host: string; port: string }) => {
    try {
      const server = await startUiServer({
        host: options.host,
        port: Number.parseInt(options.port, 10),
      });
      console.log(pc.green("Cursor Browser Swarm UI is running."));
      console.log(`Open: ${server.url}`);
    } catch (error) {
      console.error(pc.red(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  });

program
  .command("handoff")
  .description("Convert a ReactGrab context packet into a focused swarm route config.")
  .requiredOption("--packet <path>", "ReactGrab context packet JSON.")
  .requiredOption("--routes <path>", "Existing routes JSON.")
  .requiredOption("--out <path>", "Generated focused routes JSON.")
  .action(async (options: { packet: string; routes: string; out: string }) => {
    try {
      await createHandoffRoutes({
        packetPath: options.packet,
        existingRoutesPath: options.routes,
        outPath: options.out,
      });
      console.log(pc.green(`Wrote focused route config to ${options.out}`));
    } catch (error) {
      console.error(pc.red(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  });

program.parse();

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}
