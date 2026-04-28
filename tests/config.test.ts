import { describe, expect, it } from "vitest";
import { mergeBaseUrl, parseAgents, parseCliOptions } from "../src/config.js";
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
    expect(options.mode).toBe("dry-run");
    expect(options.chromeMode).toBe("playwright");
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
});
