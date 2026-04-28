import { describe, expect, it } from "vitest";
import { splitRoutes } from "../src/runner/routePlanner.js";
import type { AgentDirective, RouteScenario } from "../src/types.js";

function route(path: string): RouteScenario {
  return { path, goal: `Test ${path}`, hints: [], severityFocus: ["console"] };
}

const directives: AgentDirective[] = [
  {
    id: "realtime",
    label: "Realtime",
    instructions: "Stress realtime persistence.",
    allowDestructiveActions: false,
  },
  {
    id: "destructive",
    label: "Destructive",
    instructions: "Try destructive flows.",
    allowDestructiveActions: true,
  },
];

describe("splitRoutes", () => {
  it("replicates routes to every requested agent by default", () => {
    const assignments = splitRoutes([route("/a")], 4);
    expect(assignments).toHaveLength(4);
    expect(assignments[0]?.routes.map((item) => item.path)).toEqual(["/a"]);
    expect(assignments[3]?.routes.map((item) => item.path)).toEqual(["/a"]);
  });

  it("assigns routes round-robin in split mode", () => {
    const assignments = splitRoutes(
      [route("/a"), route("/b"), route("/c"), route("/d")],
      2,
      "split",
    );
    expect(assignments).toHaveLength(2);
    expect(assignments[0]?.routes.map((item) => item.path)).toEqual(["/a", "/c"]);
    expect(assignments[1]?.routes.map((item) => item.path)).toEqual(["/b", "/d"]);
  });

  it("does not create empty assignments in split mode when routes are fewer than agents", () => {
    const assignments = splitRoutes([route("/a")], 4, "split");
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.routes).toHaveLength(1);
  });

  it("can replicate every route to every requested agent", () => {
    const assignments = splitRoutes([route("/a")], 2, "replicate");
    expect(assignments).toHaveLength(2);
    expect(assignments[0]?.routes.map((item) => item.path)).toEqual(["/a"]);
    expect(assignments[1]?.routes.map((item) => item.path)).toEqual(["/a"]);
  });

  it("assigns directives round-robin to replicated agents", () => {
    const assignments = splitRoutes([route("/a")], 3, "replicate", directives);
    expect(assignments.map((assignment) => assignment.directive.id)).toEqual([
      "realtime",
      "destructive",
      "realtime",
    ]);
  });

  it("assigns directives to split active agents", () => {
    const assignments = splitRoutes([route("/a"), route("/b")], 2, "split", directives);
    expect(assignments.map((assignment) => assignment.directive.id)).toEqual([
      "realtime",
      "destructive",
    ]);
  });

  it("supports high local agent assignment counts", () => {
    const assignments = splitRoutes([route("/a")], 750, "replicate");
    expect(assignments).toHaveLength(750);
    expect(assignments[749]?.agentId).toBe("agent-750");
  });
});
