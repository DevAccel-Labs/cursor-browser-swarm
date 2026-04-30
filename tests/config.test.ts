import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRouteConfig, mergeBaseUrl, parseAgents, parseCliOptions } from "../src/config.js";
import {
  parseCustomAgentDirective,
  resolveAgentDirectives,
} from "../src/runner/agentDirectives.js";

describe("config", () => {
  it("parses valid CLI options with defaults", () => {
    const options = parseCliOptions({
      repo: ".",
      baseUrl: "http://localhost:3000",
      agents: "4",
      noDevServer: true,
      model: "composer-2",
    });

    expect(options.agents).toBe(4);
    expect(options.agentConcurrency).toBe("auto");
    expect(options.assignmentStrategy).toBe("replicate");
    expect(options.agentDirectives).toEqual([]);
    expect(options.mode).toBe("cursor-cli");
    expect(options.chromeMode).toBe("axi");
    expect(options.agentCommand).toBe("agent");
    expect(options.model).toBe("composer-2");
    expect(options.routesPath.endsWith("swarm.routes.json")).toBe(true);
  });

  it("supports high local agent counts", () => {
    expect(parseAgents("750")).toBe(750);
    const options = parseCliOptions({
      repo: ".",
      baseUrl: "http://localhost:3000",
      agents: "750",
      agentConcurrency: "500",
      noDevServer: true,
    });
    expect(options.agentConcurrency).toBe(500);
  });

  it("accepts automatic concurrency", () => {
    const options = parseCliOptions({
      repo: ".",
      baseUrl: "http://localhost:3000",
      agents: "50",
      agentConcurrency: "auto",
      noDevServer: true,
    });
    expect(options.agentConcurrency).toBe("auto");
  });

  it("parses configurable agent personas and custom directives", () => {
    const options = parseCliOptions({
      repo: ".",
      baseUrl: "http://localhost:3000",
      agents: "4",
      noDevServer: true,
      agentPersonas: "realtime,security",
      agentDirective: ["vuln=Probe auth bypasses and ID tampering"],
    });

    expect(options.agentPersonas).toBe("realtime,security");
    expect(options.agentDirectives?.map((directive) => directive.id)).toEqual(["vuln"]);
    expect(options.agentDirectives?.[0]?.instructions).toContain("auth bypasses");
  });

  it("combines built-in personas with custom directives", () => {
    const directives = resolveAgentDirectives({
      personaList: "realtime,security",
      customDirectives: [parseCustomAgentDirective("dates=Stress date edges")],
    });

    expect(directives.map((directive) => directive.id)).toEqual(["realtime", "security", "dates"]);
  });

  it("rejects agent counts beyond local safety bounds", () => {
    expect(() => parseAgents("1001")).toThrow("--agents must be an integer between 1 and 1000.");
  });

  it("merges CLI base URL over route config", () => {
    const config = mergeBaseUrl(
      {
        appName: "Demo",
        baseUrl: "http://localhost:1111",
        routes: [{ path: "/dashboard", goal: "Test", hints: [], severityFocus: ["console"] }],
      },
      "http://localhost:3000",
    );

    expect(config.baseUrl).toBe("http://localhost:3000");
    expect(config.routes[0]?.severityFocus).toEqual(["console"]);
  });

  it("parses structured scenario contracts without requiring app-specific fields", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "swarm-config-"));
    const routesPath = path.join(dir, "swarm.routes.json");
    await writeFile(
      routesPath,
      `${JSON.stringify(
        {
          appName: "Demo",
          baseUrl: "http://localhost:3000",
          routes: [
            {
              id: "TS-12",
              title: "Select visible filtered rows only",
              path: "/plan",
              goal: "Apply a filter and select all visible rows.",
              seedRequirements: [
                "Need at least 3 visible rows before filtering; exactly 2 should match.",
              ],
              baselineAssertions: ["Before test: record N visible rows."],
              passCriteria: [
                "Pass only if exactly 2 visible row checkboxes are selected and hidden rows remain unselected.",
              ],
              expectedOutOfScope: ["Column filters are not expected to emit WebSocket events."],
              telemetryExpectations: {
                websocket: "silent",
                notes: ["UI-only local state should not require realtime frames."],
              },
              minimumFixture: {
                rows: [
                  {
                    id: "row-1",
                    label: "Owner Alice high priority",
                    fields: { owner: "Alice", status: "In Progress", priority: "High" },
                  },
                ],
                requiredCounts: { visibleRowsBeforeFilter: 3 },
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const config = await loadRouteConfig(routesPath);

    expect(config.routes[0]).toMatchObject({
      id: "TS-12",
      title: "Select visible filtered rows only",
      seedRequirements: [
        "Need at least 3 visible rows before filtering; exactly 2 should match.",
      ],
      baselineAssertions: ["Before test: record N visible rows."],
      passCriteria: [
        "Pass only if exactly 2 visible row checkboxes are selected and hidden rows remain unselected.",
      ],
      expectedOutOfScope: ["Column filters are not expected to emit WebSocket events."],
      telemetryExpectations: { websocket: "silent" },
      minimumFixture: {
        requiredCounts: { visibleRowsBeforeFilter: 3 },
      },
    });
  });
});
