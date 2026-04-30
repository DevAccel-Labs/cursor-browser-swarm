import { describe, expect, it } from "vitest";
import { contextPacketToRouteConfig } from "../src/reactgrab/contextPacket.js";

describe("context packet handoff", () => {
  it("turns a selected element packet into a focused route config", () => {
    const routeConfig = contextPacketToRouteConfig({
      version: "0.1",
      route: "/projects/acme/tickets",
      intent: "Verify status filtering after selecting the dropdown",
      componentStack: ["TicketsPage", "TicketFilters", "StatusDropdown"],
      sourceFiles: ["src/components/TicketFilters.tsx"],
      target: {
        role: "button",
        name: "Status",
      },
      nearbyText: ["Open", "Closed"],
      relatedArtifacts: [],
      preconditions: ["Seed at least three tickets across two statuses"],
      observations: ["Prior run saw the dropdown clip below the table header"],
      debugHints: ["Check popover collision boundaries"],
      notes: "Dropdown appears clipped",
    });

    expect(routeConfig.routes[0]?.path).toBe("/projects/acme/tickets");
    expect(routeConfig.routes[0]?.goal).toContain("StatusDropdown");
    expect(routeConfig.routes[0]?.goal).toContain("Verify status filtering");
    expect(routeConfig.routes[0]?.goal).toContain("Seed at least three tickets");
    expect(routeConfig.routes[0]?.hints).toContain("source:src/components/TicketFilters.tsx");
    expect(routeConfig.routes[0]?.hints).toContain("role:button");
  });
});
