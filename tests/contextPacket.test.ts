import { describe, expect, it } from "vitest";
import { contextPacketToRouteConfig } from "../src/reactgrab/contextPacket.js";

describe("context packet handoff", () => {
  it("turns a selected element packet into a focused route config", () => {
    const routeConfig = contextPacketToRouteConfig({
      version: "0.1",
      route: "/projects/acme/tickets",
      componentStack: ["TicketsPage", "TicketFilters", "StatusDropdown"],
      sourceFiles: ["src/components/TicketFilters.tsx"],
      notes: "Dropdown appears clipped",
    });

    expect(routeConfig.routes[0]?.path).toBe("/projects/acme/tickets");
    expect(routeConfig.routes[0]?.goal).toContain("StatusDropdown");
    expect(routeConfig.routes[0]?.hints).toContain("source:src/components/TicketFilters.tsx");
  });
});
