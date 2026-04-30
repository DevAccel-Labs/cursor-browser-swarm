import { readFile, writeFile } from "node:fs/promises";
import { loadContextPacket } from "../config.js";
import type { ContextPacket, RouteConfig, RouteScenario } from "../types.js";

export async function readContextPacket(path: string): Promise<ContextPacket> {
  return loadContextPacket(path);
}

function compactLines(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function packetTargetSummary(packet: ContextPacket): string | undefined {
  if (!packet.target) {
    return undefined;
  }
  const entries = [
    packet.target.role ? `role=${packet.target.role}` : undefined,
    packet.target.name ? `name=${packet.target.name}` : undefined,
    packet.target.text ? `text=${packet.target.text}` : undefined,
    packet.target.selector ? `selector=${packet.target.selector}` : undefined,
    packet.target.testId ? `testId=${packet.target.testId}` : undefined,
  ].filter(Boolean);
  return entries.length > 0 ? `Start from target ${entries.join(", ")}.` : undefined;
}

export function packetToRoute(packet: ContextPacket, existing?: RouteConfig): RouteScenario {
  const matched = existing?.routes.find((route) => route.path === packet.route);
  const component = packet.componentStack.at(-1) ?? "selected component";
  const preconditions = packet.preconditions ?? [];
  const observations = packet.observations ?? [];
  const debugHints = packet.debugHints ?? [];
  const nearbyText = packet.nearbyText ?? [];
  return {
    path: packet.route,
    goal: compactLines([
      `Validate flows around ReactGrab-selected ${component}.`,
      packet.intent ? `User intent: ${packet.intent}.` : undefined,
      matched ? `Original route goal: ${matched.goal}` : undefined,
      packet.sourceFiles.length > 0
        ? `Inspect likely files: ${packet.sourceFiles.join(", ")}.`
        : undefined,
      packetTargetSummary(packet),
      preconditions.length > 0 ? `Honor preconditions: ${preconditions.join("; ")}.` : undefined,
      observations.length > 0 ? `Prior observations: ${observations.join("; ")}.` : undefined,
      debugHints.length > 0 ? `Debug hints: ${debugHints.join("; ")}.` : undefined,
      packet.notes ? `User notes: ${packet.notes}.` : undefined,
      "Click nearby controls, inspect console/network failures, capture screenshots, and write repro steps.",
    ]).join(" "),
    hints: [
      ...packet.componentStack.map((entry) => `component:${entry}`),
      ...packet.sourceFiles.map((entry) => `source:${entry}`),
      ...(packet.target?.role ? [`role:${packet.target.role}`] : []),
      ...(packet.target?.name ? [`name:${packet.target.name}`] : []),
      ...(packet.target?.text ? [`text:${packet.target.text}`] : []),
      ...(packet.target?.testId ? [`testId:${packet.target.testId}`] : []),
      ...nearbyText.map((entry) => `nearby:${entry}`),
      ...debugHints.map((entry) => `debug:${entry}`),
    ],
    severityFocus: ["console", "network", "visual"],
  };
}

export async function writeFocusedRouteConfig(input: {
  packetPath: string;
  routesPath?: string;
  outPath: string;
}): Promise<RouteConfig> {
  const packet = await loadContextPacket(input.packetPath);
  const existing = input.routesPath
    ? (JSON.parse(await readFile(input.routesPath, "utf8")) as RouteConfig)
    : undefined;
  const config: RouteConfig = {
    appName: existing?.appName ?? "ReactGrab handoff",
    routes: [packetToRoute(packet, existing)],
  };
  if (existing?.baseUrl) {
    config.baseUrl = existing.baseUrl;
  }
  await writeFile(input.outPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export const loadAndValidateContextPacket = readContextPacket;
export const contextPacketToRouteConfig = (packet: ContextPacket): RouteConfig => ({
  appName: "ReactGrab handoff",
  routes: [packetToRoute(packet)],
});
