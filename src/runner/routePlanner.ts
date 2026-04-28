import type {
  AgentAssignment,
  AgentDirective,
  AssignmentStrategy,
  RouteScenario,
} from "../types.js";
import { defaultAgentDirectives } from "./agentDirectives.js";

export function splitRoutesAcrossAgents(
  routes: RouteScenario[],
  agentCount: number,
  strategy: AssignmentStrategy = "replicate",
  directives: AgentDirective[] = defaultAgentDirectives,
): AgentAssignment[] {
  if (!Number.isInteger(agentCount) || agentCount < 1 || agentCount > 1000) {
    throw new Error("agentCount must be an integer between 1 and 1000.");
  }
  const effectiveDirectives = directives.length > 0 ? directives : defaultAgentDirectives;
  const directiveFor = (index: number) =>
    effectiveDirectives[index % effectiveDirectives.length] ?? defaultAgentDirectives[0]!;

  switch (strategy) {
    case "split": {
      const activeAgentCount = Math.min(agentCount, Math.max(routes.length, 1));
      return Array.from({ length: activeAgentCount }, (_, index) => ({
        agentId: `agent-${index + 1}`,
        index,
        routes: routes.filter((_, routeIndex) => routeIndex % activeAgentCount === index),
        directive: directiveFor(index),
      }));
    }
    case "replicate":
      return Array.from({ length: agentCount }, (_, index) => ({
        agentId: `agent-${index + 1}`,
        index,
        routes,
        directive: directiveFor(index),
      }));
    default: {
      const exhaustive: never = strategy;
      return exhaustive;
    }
  }
}

export const splitRoutes = splitRoutesAcrossAgents;
