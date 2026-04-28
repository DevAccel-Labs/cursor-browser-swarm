import type {
  AgentAssignment,
  BrowserSession,
  ChromeMode,
  ContextPacket,
  SwarmSecret,
} from "../types.js";

interface MissionPromptInput {
  agentId: string;
  repoPath: string;
  baseUrl: string;
  assignment: AgentAssignment;
  instructions?: string | undefined;
  secrets: SwarmSecret[];
  secretsEnvPrefix: string;
  chromeMode: ChromeMode;
  artifactDir: string;
  axiHelperPath: string;
  maxRouteSteps: number;
  model?: string | undefined;
  contextPacket?: ContextPacket | undefined;
  browserSession?: BrowserSession | undefined;
}

function formatBrowserSession(session: BrowserSession | undefined): string {
  if (!session) {
    return "Browser session isolation: not configured for this mode.";
  }
  return [
    "Browser session isolation:",
    `- Session id: ${session.agentId}`,
    `- AXI bridge port: ${session.axiPort}`,
    `- AXI state HOME: ${session.homeDir}`,
    `- Browser profile dir: ${session.profileDir}`,
    `- Temporary script dir: ${session.scriptsDir}`,
    "- Use the provided helper so chrome-devtools-axi runs with this isolated HOME/port. Do not call global chrome-devtools-axi directly unless the helper is broken and you explicitly preserve the same env.",
  ].join("\n");
}

function browserToolInstructions(
  chromeMode: ChromeMode,
  axiHelperPath: string,
  browserSession?: BrowserSession,
): string {
  switch (chromeMode) {
    case "axi":
      return [
        "Use chrome-devtools-axi as the required browser tool path.",
        `Preferred helper: node ${axiHelperPath} <command>`,
        `Run node ${axiHelperPath} with no args if you need the compact command dashboard.`,
        formatBrowserSession(browserSession),
        "Helper command contract:",
        `- Open route, optionally filtered: node ${axiHelperPath} open <url> --query "<text to find>"`,
        `- Snapshot only when needed: node ${axiHelperPath} snapshot`,
        `- Screenshot to a unique file: node ${axiHelperPath} screenshot <descriptive-label>`,
        `- Click exact UID and return focused result: node ${axiHelperPath} click @<uid> --query "<expected text>"`,
        `- Fill exact UID, optionally submit: node ${axiHelperPath} fill @<uid> <value> --submit`,
        `- Fill multiple form fields when single-field fills fail: node ${axiHelperPath} fillform "@<uid>=<value>" "@<uid>=<value>"`,
        `- Save console inspection: node ${axiHelperPath} console`,
        `- Save network inspection: node ${axiHelperPath} network`,
        `- Save realtime/WebSocket probe output: node ${axiHelperPath} realtime-save`,
        `- Native CDP WebSocket frame recording when SWARM_CDP_URL/SWARM_CDP_PORT is configured: node ${axiHelperPath} realtime-cdp-record 5000`,
        `- Tabs/pages: node ${axiHelperPath} pages | newpage <url> | selectpage <id> | closepage <id>`,
        `- Navigation/waits: node ${axiHelperPath} back | wait <ms|text> | scroll <up|down|top|bottom>`,
        `- Input extras: node ${axiHelperPath} type <text> | press <key> | hover @<uid> | drag @<from> @<to> | dialog <accept|dismiss> | upload @<uid> <path>`,
        `- Debug/extract: node ${axiHelperPath} eval <js> | run < script.js | console-get <id> | network-get <id>`,
        `- UX/perf: node ${axiHelperPath} resize <w> <h> | emulate ... | lighthouse | perf-start | perf-stop | perf-insight <set> <name> | heap`,
        "Raw AXI is acceptable only if the helper fails, but artifacts must still land in the required paths and use the same CHROME_DEVTOOLS_AXI_PORT.",
        "For socket-backed or optimistic flows, run realtime-start before the action that opens/creates the socket when possible, then realtime-save after the interaction. If the probe is too late or empty, say that explicitly in protocolEvidence/debugHints.",
        "Prefer combined operations with --query/--submit to reduce turns. Use short wait/snapshot loops after async UI changes. Do not rely on one long sleep.",
      ].join("\n");
    case "devtools-mcp":
      return [
        "Use Chrome DevTools MCP browser tools when available.",
        "Inspect snapshots, console messages, failed network requests, screenshots, and traces.",
      ].join("\n");
    case "playwright":
      return [
        "Use the provided Playwright/dry-run evidence collector if available.",
        "Still behave like a QA-minded browser validation agent.",
      ].join("\n");
    default: {
      const exhaustive: never = chromeMode;
      return exhaustive;
    }
  }
}

function formatEvidenceContract(artifactDir: string): string {
  return [
    "Evidence contract:",
    `- Artifact directory: ${artifactDir}`,
    `- Required report: ${artifactDir}/report.md`,
    `- Required screenshot directory: ${artifactDir}/screenshots`,
    `- Required console artifact: ${artifactDir}/console.json`,
    `- Required network artifact: ${artifactDir}/network.json`,
    `- Realtime/protocol artifact for socket-heavy or optimistic flows: ${artifactDir}/realtime-trace.json`,
    `- The harness writes debugging handoff artifact ${artifactDir}/handoff.json from your manifest; include protocolEvidence and debugHints so it is useful.`,
    "- Media artifacts are immutable for this run. Do not overwrite a screenshot; create a new descriptive filename for each screenshot.",
    "- Every artifact path in report.md must exist before you finish.",
    "- Never claim success from memory or intent. Success requires runtime evidence: route opened, browser interaction happened, console inspected, failed-request/4xx/5xx network review completed, and at least one screenshot file exists.",
  ].join("\n");
}

function formatEvidenceManifestContract(input: MissionPromptInput): string {
  return `Evidence manifest:
- Before finishing, write valid JSON to ${input.artifactDir}/evidence-manifest.json.
- Use this shape exactly:
{
  "version": "1",
  "agentId": "${input.agentId}",
  "status": "passed" | "failed" | "blocked",
  "baseUrl": "${input.baseUrl}",
  "routes": [
    {
      "path": "/route",
      "status": "passed" | "failed" | "blocked",
      "opened": true,
      "interactions": ["Clicked primary CTA", "Changed filter"],
      "screenshots": ["${input.artifactDir}/screenshots/example.png"],
      "consoleChecked": true,
      "networkChecked": true,
      "realtimeChecked": false,
      "failedRequestReview": "No failed requests, 4xx, or 5xx responses observed in the saved network artifact.",
      "accessibilityChecked": false,
      "performanceChecked": false,
      "findings": [
        {
          "id": "F1",
          "title": "Short human-readable issue title",
          "summary": "One sentence describing what failed and why it matters.",
          "classification": "root-cause-candidate" | "downstream-symptom" | "independent-bug" | "needs-clean-repro" | "observability" | "tooling" | "unknown",
          "rootCauseKey": "stable-shared-root-cause-slug-or-empty",
          "observedBehavior": "Only facts you directly observed in the browser/artifacts.",
          "inferredCause": "Hypothesis, if supported. Leave empty rather than overclaiming.",
          "needsCleanRepro": false,
          "protocolEvidence": ["Observed/missing HTTP, WebSocket, ack, snapshot, or temp-id reconciliation signals. Empty if not relevant."],
          "debugHints": ["Repo search terms, suspected protocol tokens, source file names, or handoff notes for a fixing agent."],
          "fixReadiness": "ready" | "needs-protocol-evidence" | "needs-repo-context" | "needs-clean-repro" | "unknown",
          "severity": "low" | "medium" | "high",
          "confidence": "low" | "medium" | "high",
          "evidence": ["${input.artifactDir}/screenshots/example.png"],
          "reproSteps": ["Open the route", "Click the affected control"],
          "likelyFiles": []
        }
      ],
      "blockedReason": ""
    }
  ],
  "artifacts": {
    "report": "${input.artifactDir}/report.md",
    "screenshots": ["${input.artifactDir}/screenshots/example.png"],
    "console": "${input.artifactDir}/console.json",
    "network": "${input.artifactDir}/network.json",
    "realtimeTrace": "${input.artifactDir}/realtime-trace.json"
  },
  "selfCheck": {
    "browserOpened": true,
    "browserInteracted": true,
    "screenshotsExist": true,
    "consoleInspected": true,
    "networkInspected": true,
    "realtimeInspected": false,
    "artifactPathsExist": true
  },
  "notes": ["Network review must explicitly state whether failed requests, 4xx, 5xx, and realtime/WebSocket persistence signals were observed."]
}`;
}

function formatCausalityRules(): string {
  return [
    "Causality and dedupe rules:",
    "- Put observable behavior first. Titles should describe what a user saw, not a guessed implementation cause.",
    "- Keep inferredCause separate from observedBehavior. If you cannot prove the cause, say what failed to persist/reconcile rather than naming a missing function or mutation.",
    "- For realtime/WebSocket apps, do not infer 'no HTTP mutation' means no create happened. Review saved network output for websocket/realtime frames, op messages, acks, authoritative snapshots, and replacement IDs when the tool exposes them.",
    "- If realtime/protocol evidence is missing for an optimistic or socket-backed flow, set fixReadiness to needs-protocol-evidence and include debugHints such as expected op names, observed temp IDs, missing acks, and repo grep terms.",
    "- Use the same rootCauseKey for findings that likely share one root cause. Mark secondary fallout as downstream-symptom instead of duplicating it as a separate top-level bug.",
    "- Use needs-clean-repro for issues that may be caused by injected seed bugs, prior state, or unusual navigation. These should be retested on a clean baseline before being treated as product bugs.",
    "- Use observability for swallowed errors, noisy logs, or missing diagnostics that are useful but not necessarily the user-facing root failure.",
    "- Use tooling for AXI, Chrome, browser bridge, Cursor CLI, or harness failures. Tooling findings are not application bugs.",
  ].join("\n");
}

function formatRoutePlaybooks(input: MissionPromptInput): string {
  const focus = new Set(input.assignment.routes.flatMap((route) => route.severityFocus));
  const playbooks = [
    "General long-horizon UI/UX validation playbook:",
    `- Stay within ${input.maxRouteSteps} meaningful interactions per route unless the operator instructions require more.`,
    "- Prefer realistic user journeys over shallow page-load checks: navigation, forms, empty states, loading states, modals, menus, filters, pagination, back/forward, refresh persistence, and error recovery.",
    "- For every route, identify the primary user intent and at least two secondary UI surfaces to exercise.",
    "- Check whether the page gives clear feedback after each action. Report confusing success/error states even if the app technically works.",
    "- Avoid destructive actions such as delete/archive/billing unless the operator explicitly asks for them.",
  ];
  if (focus.has("accessibility")) {
    playbooks.push(
      "- Accessibility focus: check keyboard-reachable controls, visible focus states, labels, disabled states, and obvious contrast/readability issues.",
    );
  }
  if (focus.has("performance")) {
    playbooks.push(
      "- Performance focus: watch for slow route transitions, repeated loading spinners, jank after interaction, and excessive network failures/retries.",
    );
  }
  if (focus.has("visual")) {
    playbooks.push(
      "- Visual focus: inspect clipping, overlap, responsive breakage, scroll traps, offscreen popovers, empty-state layout, and modal/dropdown layering.",
    );
  }
  if (focus.has("console")) {
    playbooks.push(
      "- Console focus: treat uncaught errors, hydration errors, and noisy repeated warnings as reportable findings.",
    );
  }
  if (focus.has("network")) {
    playbooks.push(
      "- Network focus: treat failed requests, unexpected 4xx/5xx responses, stalled critical requests, and missing realtime/WebSocket persistence signals as reportable findings.",
    );
  }
  return playbooks.join("\n");
}

function formatSecretReferences(secrets: SwarmSecret[], prefix: string): string {
  if (secrets.length === 0) {
    return "No explicit test credential variables were provided. If login is required, report it as blocked with the exact missing credential names.";
  }

  return secrets
    .map(
      (secret) =>
        `- ${prefix}${secret.key}: available in the process environment; do not print its value.`,
    )
    .join("\n");
}

function formatContextPacket(packet: ContextPacket | undefined): string {
  if (!packet) {
    return "";
  }

  return [
    "ReactGrab context packet:",
    `- Route: ${packet.route}`,
    `- Component stack: ${packet.componentStack.join(" > ") || "unknown"}`,
    `- Source files: ${packet.sourceFiles.join(", ") || "unknown"}`,
    packet.notes ? `- Notes: ${packet.notes}` : undefined,
    packet.bbox
      ? `- BBox: x=${packet.bbox.x}, y=${packet.bbox.y}, width=${packet.bbox.width}, height=${packet.bbox.height}`
      : undefined,
    packet.screenshotPath ? `- Screenshot: ${packet.screenshotPath}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function buildMissionPrompt(input: MissionPromptInput): string {
  const routes = input.assignment.routes
    .map(
      (route, index) =>
        `${index + 1}. ${route.path}\n   Goal: ${route.goal}\n   Focus: ${route.severityFocus.join(", ")}${
          route.hints.length > 0 ? `\n   Hints: ${route.hints.join("; ")}` : ""
        }`,
    )
    .join("\n");

  return `<cursor_browser_swarm_mission>
You are a Cursor browser-validation agent. Your job is to validate live browser behavior with runtime evidence, not to infer success from code or descriptions.

Repo:
${input.repoPath}

Base URL:
${input.baseUrl}

Assigned agent:
${input.agentId}

Requested model:
${input.model ?? "Cursor default"}

Assigned routes:
${routes}

Mission:
Use browser/devtools tools to interact with the app like a QA-minded engineer.

Phase discipline:
- Browser validation is the primary job. Do not spend time redesigning or refactoring.
- Do not edit source files. This product is QA and handoff only; report likely source files and debug hints instead of patching.
- Write temporary validation scripts only under the artifact/browser scripts directory. Never create or modify scripts in the target repo.
- If browser tooling is blocked, credentials are missing, or required artifacts cannot be saved, report the run as blocked/failed in report.md. Do not call it successful.

Required execution loop for each assigned route:
1. Open each assigned route.
2. Take an accessibility snapshot before interacting.
3. Click through realistic UI flows from the route goal, using UIDs from the latest snapshot.
4. After navigation, form submit, modal open/close, filter changes, or other async UI changes, use short wait/snapshot loops until the UI settles.
5. Inspect console errors and save the result.
6. Inspect failed network requests and save the result.
7. Capture at least one screenshot of the exercised route, plus screenshots for any failure.
8. Save reproduction steps with enough detail for a human to repeat the flow.
9. Identify likely source files, repo search terms, and handoff/debug hints when possible.
10. Before finishing, verify every artifact path referenced in report.md exists on disk.
11. Produce the final report.

${formatEvidenceContract(input.artifactDir)}

${formatEvidenceManifestContract(input)}

${formatRoutePlaybooks(input)}

${formatCausalityRules()}

AXI efficiency rules:
- Prefer content-first, targeted commands over full snapshots when possible.
- Use --query on open/click/fill when you know the text or state you need to verify.
- Use fill --submit or fillform to combine form interactions instead of separate fill/click retries.
- Use eval/run for targeted extraction when a full accessibility snapshot would be noisy.
- Keep stdout evidence compact; save large artifacts to files and reference the paths.
- Treat explicit empty states ("0 failed requests", "no console errors") as stronger than omitted output.
- The harness observes artifacts for progress. Prioritize producing valid artifacts over verbose progress chatter.

Source policy:
- QA-only mode: do not edit source files, package files, migrations, generated files, or tests.
- Do not create branches, commits, PRs, worktrees, or patches.
- Focus on actionable reproduction evidence and handoff hints for a separate coding agent/human.

Browser tooling:
${browserToolInstructions(input.chromeMode, input.axiHelperPath, input.browserSession)}

Test credential references:
${formatSecretReferences(input.secrets, input.secretsEnvPrefix)}

Operator instructions:
${input.instructions ?? "No extra operator instructions were provided."}

${formatContextPacket(input.contextPacket)}

Report format:
- Summary
- Routes tested
- Findings with severity/confidence
- Evidence links using only existing artifact paths
- Console/network notes
- Reproduction steps
- Likely source files
- Fix attempt and verification status
- Self-check: state whether screenshot, console, network, and browser interaction evidence exist
</cursor_browser_swarm_mission>`;
}
