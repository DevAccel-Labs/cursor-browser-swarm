import { readFile, writeFile } from "node:fs/promises";
import { packetToRoute, readContextPacket } from "./contextPacket.js";
import { loadRouteConfig } from "../config.js";
import type { RouteConfig } from "../types.js";

export async function createHandoffRoutes(input: {
  packetPath: string;
  existingRoutesPath?: string;
  outPath: string;
}): Promise<RouteConfig> {
  const packet = await readContextPacket(input.packetPath);
  let config: RouteConfig = {
    appName: "ReactGrab handoff",
    routes: [packetToRoute(packet)],
  };

  if (input.existingRoutesPath) {
    const existing = await loadRouteConfig(input.existingRoutesPath);
    const matchingRoute = existing.routes.find((route) => route.path === packet.route);
    if (matchingRoute) {
      config = {
        ...existing,
        routes: [
          {
            ...matchingRoute,
            goal: `${matchingRoute.goal}\n\nReactGrab focus: ${config.routes[0]?.goal ?? ""}`,
            hints: [...matchingRoute.hints, ...(config.routes[0]?.hints ?? [])],
          },
        ],
      };
    }
  }

  await writeFile(input.outPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export async function readContextPacketRaw(packetPath: string): Promise<string> {
  return readFile(packetPath, "utf8");
}
