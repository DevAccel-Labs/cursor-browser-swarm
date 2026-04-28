import { readFile } from "node:fs/promises";
import path from "node:path";

function parseEnvLine(line: string): [string, string] | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }
  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0) {
    return undefined;
  }
  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();
  if (!/^[A-Z0-9_]+$/i.test(key)) {
    return undefined;
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

export async function loadEnvFile(cwd: string): Promise<string | undefined> {
  const envPath = path.join(cwd, ".env");
  let raw: string;
  try {
    raw = await readFile(envPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }
    const [key, value] = parsed;
    process.env[key] ??= value;
  }
  return envPath;
}
