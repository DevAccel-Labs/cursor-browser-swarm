import { describe, expect, it } from "vitest";
import { buildMissionPrompt } from "../src/cursor/missionPrompt.js";
import { defaultAgentDirectives } from "../src/runner/agentDirectives.js";
import type { AgentAssignment } from "../src/types.js";

const assignment: AgentAssignment = {
  agentId: "agent-1",
  index: 0,
  directive: defaultAgentDirectives[1]!,
  routes: [
    {
      id: "DASH-01",
      title: "Dashboard filters",
      path: "/dashboard",
      goal: "Click dashboard filters.",
      hints: [],
      severityFocus: ["console", "network", "visual"],
      seedRequirements: ["Need at least 3 visible rows before filtering."],
      baselineAssertions: ["Before test: record visible row count."],
      passCriteria: ["Pass only if the accessibility tree shows exactly 2 selected rows."],
      expectedOutOfScope: ["Filters are not expected to survive a full reload."],
      telemetryExpectations: {
        websocket: "silent",
        notes: ["Column filters should be local UI state."],
      },
    },
  ],
};

describe("buildMissionPrompt", () => {
  it("includes route, goal, proof requirements, and secret references", () => {
    const prompt = buildMissionPrompt({
      agentId: "agent-1",
      repoPath: "/repo",
      baseUrl: "http://localhost:3000",
      assignment,
      instructions: "Use the seeded test account.",
      secrets: [{ key: "EMAIL", value: "secret@example.com" }],
      secretsEnvPrefix: "SWARM_SECRET_",
      chromeMode: "axi",
      artifactDir: "/tmp/agent-1",
      axiHelperPath: "/tmp/agent-1/swarm-axi.mjs",
      maxRouteSteps: 12,
      model: "composer-2",
      browserSession: {
        agentId: "agent-1",
        index: 0,
        axiPort: 31001,
        homeDir: "/tmp/agent-1/browser-home",
        profileDir: "/tmp/agent-1/browser-profile",
        tempDir: "/tmp/agent-1/tmp",
        scriptsDir: "/tmp/agent-1/scripts",
      },
    });

    expect(prompt).toContain("Repo:\n/repo");
    expect(prompt).toContain("Requested model:\ncomposer-2");
    expect(prompt).toContain("Agent directive:");
    expect(prompt).toContain("destructive (Destructive Flow Breaker)");
    expect(prompt).toContain("Destructive actions allowed: yes");
    expect(prompt).toContain("1. /dashboard");
    expect(prompt).toContain("Scenario ID: DASH-01");
    expect(prompt).toContain("Seed/data requirements");
    expect(prompt).toContain("Before test: record visible row count.");
    expect(prompt).toContain("Pass/fail evidence criteria");
    expect(prompt).toContain("Expected out-of-scope observations");
    expect(prompt).toContain("WebSocket: silent");
    expect(prompt).toContain("Click dashboard filters.");
    expect(prompt).toContain("Evidence contract:");
    expect(prompt).toContain("/tmp/agent-1/screenshots");
    expect(prompt).toContain("/tmp/agent-1/console.json");
    expect(prompt).toContain("/tmp/agent-1/network.json");
    expect(prompt).toContain("/tmp/agent-1/realtime-trace.json");
    expect(prompt).toContain("/tmp/agent-1/handoff.json");
    expect(prompt).toContain("/tmp/agent-1/evidence-manifest.json");
    expect(prompt).toContain("node /tmp/agent-1/swarm-axi.mjs");
    expect(prompt).toContain("AXI bridge port: 31001");
    expect(prompt).toContain("Temporary script dir: /tmp/agent-1/scripts");
    expect(prompt).toContain("Never create or modify scripts in the target repo");
    expect(prompt).toContain("fillform");
    expect(prompt).toContain("lighthouse");
    expect(prompt).toContain("perf-start");
    expect(prompt).toContain("console-get");
    expect(prompt).toContain("network-get");
    expect(prompt).toContain("realtime-save");
    expect(prompt).toContain("realtime-cdp-record");
    expect(prompt).toContain("AXI efficiency rules");
    expect(prompt).toContain("--query");
    expect(prompt).toContain("--submit");
    expect(prompt).toContain("failed-request/4xx/5xx network review");
    expect(prompt).toContain("General long-horizon UI/UX validation playbook");
    expect(prompt).toContain("Stay within 12 meaningful interactions per route");
    expect(prompt).toContain("Snapshot only when needed");
    expect(prompt).toContain("Every artifact path in report.md must exist");
    expect(prompt).toContain("Causality and dedupe rules");
    expect(prompt).toContain("observedBehavior");
    expect(prompt).toContain("rootCauseKey");
    expect(prompt).toContain("downstream-symptom");
    expect(prompt).toContain("tooling");
    expect(prompt).toContain("realtime/WebSocket");
    expect(prompt).toContain("fixReadiness");
    expect(prompt).toContain("findingKind");
    expect(prompt).toContain("scenarioResults");
    expect(prompt).toContain("Scenario results: include baseline");
    expect(prompt).toContain("debugHints");
    expect(prompt).toContain("The harness observes artifacts for progress");
    expect(prompt).toContain("SWARM_SECRET_EMAIL");
    expect(prompt).not.toContain("secret@example.com");
    expect(prompt).toContain("QA-only mode");
    expect(prompt).toContain("Do not create branches, commits, PRs, worktrees, or patches");
  });
});
