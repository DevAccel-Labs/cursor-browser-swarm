import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface CursorMcpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export function chromeDevtoolsMcpConfig(
  browserUrl = "http://127.0.0.1:9222",
): Record<string, unknown> {
  return {
    mcpServers: {
      "chrome-devtools": {
        command: "npx",
        args: ["-y", "chrome-devtools-mcp@latest", `--browser-url=${browserUrl}`],
      },
    },
  };
}

export async function writeChromeDevtoolsMcpConfig(
  repoPath: string,
  browserUrl = "http://127.0.0.1:9222",
): Promise<string> {
  const cursorDir = path.join(repoPath, ".cursor");
  const configPath = path.join(cursorDir, "mcp.json");
  await mkdir(cursorDir, { recursive: true });

  let existingConfig: CursorMcpConfig = {};
  try {
    existingConfig = JSON.parse(await readFile(configPath, "utf8")) as CursorMcpConfig;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const generatedConfig = chromeDevtoolsMcpConfig(browserUrl) as CursorMcpConfig;
  const mergedConfig: CursorMcpConfig = {
    ...existingConfig,
    mcpServers: {
      ...existingConfig.mcpServers,
      ...generatedConfig.mcpServers,
    },
  };

  await writeFile(configPath, `${JSON.stringify(mergedConfig, null, 2)}\n`);
  await chmod(configPath, 0o600).catch(() => undefined);
  return configPath;
}

export function chromeDevtoolsMcpInstructions(browserUrl = "http://127.0.0.1:9222"): string {
  return [
    `Chrome DevTools MCP can connect to a Chrome instance at ${browserUrl}.`,
    "Useful tools include navigate_page, click, fill, take_screenshot, take_snapshot, list_console_messages, list_network_requests, performance_start_trace, and performance_stop_trace.",
    "If the browser is unavailable, record that as an environment issue in the agent report.",
  ].join("\n");
}
