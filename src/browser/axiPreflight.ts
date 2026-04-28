import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { execa } from "execa";
import type { BrowserSession } from "../types.js";

interface AxiProcessResult {
  all?: string | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  exitCode?: number | undefined;
  signal?: string | undefined;
  timedOut?: boolean | undefined;
  shortMessage?: string | undefined;
  message?: string | undefined;
}

function describeAxiFailure(result: AxiProcessResult): string {
  const output = [result.all, result.stderr, result.stdout]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n")
    .trim();
  if (output) {
    return output;
  }
  if (result.timedOut) {
    return "command timed out after 30s";
  }
  if (result.signal) {
    return `terminated by signal ${result.signal}`;
  }
  if (typeof result.exitCode === "number") {
    return `exit code ${result.exitCode}`;
  }
  return result.shortMessage ?? result.message ?? "command failed without output";
}

async function runAxiCommand(args: string[], browserSession: BrowserSession): Promise<void> {
  let lastFailure = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await execa("npx", ["-y", "chrome-devtools-axi", ...args], {
        all: true,
        reject: false,
        timeout: 30_000,
        env: {
          ...process.env,
          HOME: browserSession.homeDir,
          ...(process.env.HOME ? { SWARM_NPM_CACHE_DIR: path.join(process.env.HOME, ".npm") } : {}),
          ...(process.env.HOME ? { npm_config_cache: path.join(process.env.HOME, ".npm") } : {}),
          TMPDIR: browserSession.tempDir,
          TEMP: browserSession.tempDir,
          TMP: browserSession.tempDir,
          CHROME_DEVTOOLS_AXI_PORT: String(browserSession.axiPort),
          CHROME_DEVTOOLS_AXI_DISABLE_HOOKS: "1",
          SWARM_BROWSER_SESSION_ID: browserSession.agentId,
          SWARM_BROWSER_HOME: browserSession.homeDir,
          SWARM_BROWSER_PROFILE_DIR: browserSession.profileDir,
          SWARM_BROWSER_TEMP_DIR: browserSession.tempDir,
          SWARM_BROWSER_SCRIPTS_DIR: browserSession.scriptsDir,
        },
      });
      if (result.exitCode === 0) {
        return;
      }
      lastFailure = describeAxiFailure(result);
    } catch (error) {
      lastFailure = describeAxiFailure(error as AxiProcessResult);
    }
    if (attempt === 1) {
      await delay(1_000);
    }
  }
  throw new Error(
    `AXI preflight failed while running "chrome-devtools-axi ${args.join(" ")}": ${lastFailure}`,
  );
}

export async function runAxiPreflight(input: {
  baseUrl: string;
  runDir: string;
  browserSession: BrowserSession;
}): Promise<{ screenshotPath: string }> {
  const preflightDir = path.join(input.runDir, "preflight");
  const screenshotPath = path.join(preflightDir, "base-url.png");
  await mkdir(preflightDir, { recursive: true });
  await mkdir(input.browserSession.homeDir, { recursive: true });
  await mkdir(input.browserSession.profileDir, { recursive: true });
  await mkdir(input.browserSession.tempDir, { recursive: true });
  await mkdir(input.browserSession.scriptsDir, { recursive: true });

  const commands = [["open", input.baseUrl], ["snapshot"], ["screenshot", screenshotPath]];
  for (const args of commands) {
    await runAxiCommand(args, input.browserSession);
  }

  return { screenshotPath };
}
