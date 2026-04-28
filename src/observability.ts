import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type SwarmLogLevel = "debug" | "info" | "warn" | "error";

export interface SwarmRunLogger {
  debug: (message: string, context?: Record<string, unknown>) => Promise<void>;
  info: (message: string, context?: Record<string, unknown>) => Promise<void>;
  warn: (message: string, context?: Record<string, unknown>) => Promise<void>;
  error: (message: string, context?: Record<string, unknown>) => Promise<void>;
}

function debugEnabled(): boolean {
  const raw = process.env.SWARM_DEBUG ?? process.env.CURSOR_BROWSER_SWARM_DEBUG ?? "";
  return ["1", "true", "yes", "debug"].includes(raw.toLowerCase());
}

function shouldPrint(level: SwarmLogLevel): boolean {
  return debugEnabled() || level === "warn" || level === "error";
}

function serializeEvent(
  level: SwarmLogLevel,
  message: string,
  context?: Record<string, unknown>,
): string {
  return `${JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? { context } : {}),
  })}\n`;
}

export function createRunLogger(eventsPath: string): SwarmRunLogger {
  async function write(level: SwarmLogLevel, message: string, context?: Record<string, unknown>) {
    await mkdir(path.dirname(eventsPath), { recursive: true });
    await appendFile(eventsPath, serializeEvent(level, message, context));
    if (shouldPrint(level)) {
      const suffix = context ? ` ${JSON.stringify(context)}` : "";
      console.error(`[swarm:${level}] ${message}${suffix}`);
    }
  }

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}
