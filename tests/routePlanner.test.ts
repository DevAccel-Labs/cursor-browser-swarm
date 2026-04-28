import { describe, expect, it } from "vitest";
import { splitRoutes } from "../src/runner/routePlanner.js";
import type { RouteScenario } from "../src/types.js";

function route(path: string): RouteScenario {
  return { path, goal: `Test ${path}`, hints: [], severityFocus: ["console"] };
}

describe("splitRoutes", () => {
  it("assigns routes round-robin", () => {
    const assignments = splitRoutes([route("/a"), route("/b"), route("/c"), route("/d")], 2);
    expect(assignments).toHaveLength(2);
    expect(assignments[0]?.routes.map((item) => item.path)).toEqual(["/a", "/c"]);
    expect(assignments[1]?.routes.map((item) => item.path)).toEqual(["/b", "/d"]);
  });

  it("does not create empty assignments when routes are fewer than agents", () => {
    const assignments = splitRoutes([route("/a")], 4);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.routes).toHaveLength(1);
  });

  it("can replicate every route to every requested agent", () => {
    const assignments = splitRoutes([route("/a")], 2, "replicate");
    expect(assignments).toHaveLength(2);
    expect(assignments[0]?.routes.map((item) => item.path)).toEqual(["/a"]);
    expect(assignments[1]?.routes.map((item) => item.path)).toEqual(["/a"]);
  });

  it("supports high local agent assignment counts", () => {
    const assignments = splitRoutes([route("/a")], 750, "replicate");
    expect(assignments).toHaveLength(750);
    expect(assignments[749]?.agentId).toBe("agent-750");
  });
});
