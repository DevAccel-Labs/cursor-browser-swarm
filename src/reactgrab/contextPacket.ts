import { readFile, writeFile } from "node:fs/promises";
import { loadContextPacket } from "../config.js";
import type { ContextPacket, RouteConfig, RouteScenario } from "../types.js";

export async function readContextPacket(path: string): Promise<ContextPacket> {
  return loadContextPacket(path);
}

export function packetToRoute(packet: ContextPacket, existing?: RouteConfig): RouteScenario {
  const matched = existing?.routes.find((route) => route.path === packet.route);
  const component = packet.componentStack.at(-1) ?? "selected component";
  return {
    path: packet.route,
    goal: [
      `Validate flows around ReactGrab-selected ${component}.`,
      matched ? `Original route goal: ${matched.goal}` : undefined,
      packet.sourceFiles.length > 0
        ? `Inspect likely files: ${packet.sourceFiles.join(", ")}.`
        : undefined,
      packet.notes ? `User notes: ${packet.notes}.` : undefined,
      "Click nearby controls, inspect console/network failures, capture screenshots, and write repro steps.",
    ]
      .filter(Boolean)
      .join(" "),
    hints: [
      ...packet.componentStack.map((entry) => `component:${entry}`),
      ...packet.sourceFiles.map((entry) => `source:${entry}`),
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
