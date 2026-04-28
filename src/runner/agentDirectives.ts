import type { AgentDirective } from "../types.js";

export const defaultAgentDirectives: AgentDirective[] = [
  {
    id: "balanced",
    label: "Balanced QA",
    instructions:
      "Validate the main happy path, persistence after refresh, obvious error states, and whether the flow matches the route goal.",
    allowDestructiveActions: false,
  },
  {
    id: "destructive",
    label: "Destructive Flow Breaker",
    instructions:
      "Actively try to break the flow with cancel/back/refresh/reopen loops, duplicate submissions, archive/delete-like actions when the route goal allows them, and confusing state transitions.",
    allowDestructiveActions: true,
  },
  {
    id: "security",
    label: "Security Boundary Probe",
    instructions:
      "Probe auth boundaries, forbidden actions, ID/query-param tampering, tenant/workspace leakage, and unsafe direct-object access without exfiltrating secrets or damaging real data.",
    allowDestructiveActions: false,
  },
  {
    id: "realtime",
    label: "Realtime and Persistence Stress",
    instructions:
      "Focus on optimistic UI, WebSocket/realtime acks, reload/back/duplicate-tab behavior, stale snapshots, and whether temp/client IDs reconcile to server-backed state.",
    allowDestructiveActions: false,
  },
  {
    id: "accessibility",
    label: "Accessibility and Keyboard UX",
    instructions:
      "Use keyboard-like flows, focus order, accessible names, modal/dropdown escape behavior, disabled states, and screen-reader-visible labels.",
    allowDestructiveActions: false,
  },
  {
    id: "edge-inputs",
    label: "Edge Inputs and Validation",
    instructions:
      "Try empty strings, long values, punctuation, repeated spaces, rapid edits, date boundaries, and validation/recovery behavior.",
    allowDestructiveActions: false,
  },
];

export function normalizeDirectiveId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "custom"
  );
}

export function resolveAgentDirectives(input?: {
  personaList?: string | undefined;
  customDirectives?: AgentDirective[] | undefined;
  routeDirectives?: AgentDirective[] | undefined;
}): AgentDirective[] {
  const customDirectives = input?.customDirectives ?? [];
  if (input?.personaList?.trim()) {
    const byId = new Map(defaultAgentDirectives.map((directive) => [directive.id, directive]));
    const personaDirectives = input.personaList
      .split(",")
      .map((persona) => normalizeDirectiveId(persona))
      .map((id) => {
        const directive = byId.get(id);
        if (!directive) {
          throw new Error(
            `Unknown agent persona "${id}". Use one of: ${defaultAgentDirectives
              .map((item) => item.id)
              .join(", ")}; or pass --agent-directive ID=INSTRUCTIONS.`,
          );
        }
        return directive;
      });
    return [...personaDirectives, ...customDirectives];
  }
  if (customDirectives.length > 0) {
    return customDirectives;
  }
  if (input?.routeDirectives && input.routeDirectives.length > 0) {
    return input.routeDirectives;
  }
  return defaultAgentDirectives;
}

export function parseCustomAgentDirective(value: string): AgentDirective {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error(`Invalid agent directive "${value}". Expected ID=INSTRUCTIONS.`);
  }
  const rawId = value.slice(0, separatorIndex).trim();
  const instructions = value.slice(separatorIndex + 1).trim();
  if (!instructions) {
    throw new Error(`Invalid agent directive "${value}". Instructions cannot be empty.`);
  }
  const id = normalizeDirectiveId(rawId);
  return {
    id,
    label: rawId,
    instructions,
    allowDestructiveActions: /\b(delete|archive|destructive|break|remove|destroy)\b/i.test(
      instructions,
    ),
  };
}
