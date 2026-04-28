import type { AgentAssignment, AssignmentStrategy, RouteScenario } from "../types.js";

export function splitRoutesAcrossAgents(
  routes: RouteScenario[],
  agentCount: number,
  strategy: AssignmentStrategy = "split",
): AgentAssignment[] {
  if (!Number.isInteger(agentCount) || agentCount < 1 || agentCount > 1000) {
    throw new Error("agentCount must be an integer between 1 and 1000.");
  }

  switch (strategy) {
    case "split": {
      const activeAgentCount = Math.min(agentCount, Math.max(routes.length, 1));
      return Array.from({ length: activeAgentCount }, (_, index) => ({
        agentId: `agent-${index + 1}`,
        index,
        routes: routes.filter((_, routeIndex) => routeIndex % activeAgentCount === index),
      }));
    }
    case "replicate":
      return Array.from({ length: agentCount }, (_, index) => ({
        agentId: `agent-${index + 1}`,
        index,
        routes,
      }));
    default: {
      const exhaustive: never = strategy;
      return exhaustive;
    }
  }
}

export const splitRoutes = splitRoutesAcrossAgents;
