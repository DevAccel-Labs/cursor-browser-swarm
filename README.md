bun run cursor-browser-swarm ui

Parallel browser validation for Cursor agents.

Cursor Browser Swarm runs multiple Cursor agents against a live browser app. Each agent gets a route mission, uses browser/devtools evidence, clicks through flows, captures screenshots/logs/traces, writes repro steps, and produces a handoff packet for debugging.

This is a prototype of infrastructure for Cursor agents to validate software the way engineers do: open the app, click through flows, inspect DevTools, capture evidence, reproduce bugs, and hand off actionable runtime facts.

## MVP scope

- TypeScript only
- React browser apps first, including TanStack Start and Next.js-style route configs
- Local dev server first
- Chrome only
- 3–5 agents max
- Browser UI bugs only
- No mobile, native desktop automation, 400-agent scaling, or generic QA replacement

## Install

```bash
bun install
bun run build
```

## Primary workflow

Start your app yourself, then point the swarm at it:

```bash
cursor-browser-swarm run \
  --repo ./my-app \
  --no-dev-server \
  --base-url http://localhost:3000 \
  --routes ./my-app/swarm.routes.json \
  --instructions ./my-app/swarm.instructions.md \
  --agents 4 \
  --mode cursor-cli \
  --chrome-mode axi
```

The orchestrator splits scenarios across agents, injects instructions and redacted credential references, and asks local Cursor CLI agents to use `chrome-devtools-axi` / Chrome DevTools MCP-style browser tools to validate flows.

## Route config

```json
{
  "appName": "Demo SaaS App",
  "baseUrl": "http://localhost:3000",
  "routes": [
    {
      "path": "/dashboard",
      "goal": "Click through dashboard cards, filters, empty states, and navigation links."
    },
    {
      "path": "/projects/acme/tickets",
      "goal": "Test ticket table sorting, filters, row opening, create-ticket modal, and pagination."
    }
  ]
}
```

## Test credentials

Prefer environment variables or redacted CLI secrets:

```bash
SWARM_SECRET_EMAIL=tester@example.com \
SWARM_SECRET_PASSWORD='secret' \
cursor-browser-swarm run ... --secrets-env-prefix SWARM_SECRET_
```

or:

```bash
cursor-browser-swarm run ... \
  --secret EMAIL=tester@example.com \
  --secret PASSWORD=secret
```

Reports and copied logs redact supplied secret values where feasible. Prompts refer to credential variable names.

## Modes

- `cursor-cli`: primary local MVP path. Spawns Cursor CLI agents and instructs them to use AXI/Chrome DevTools tooling.
- `cursor-sdk`: Cursor SDK orchestration wrapper. Exact beta SDK shape is isolated behind `CursorAgentClient`.
- `cloud-api`: direct Cursor Cloud Agent API v1 wrapper. Useful for cloud coding/report agents.
- `dry-run`: deterministic Playwright local validation without Cursor credentials.

Important: Cursor Cloud Agent API currently does not directly support local MCP browser tools. Browser proof is strongest in `cursor-cli` and `dry-run`.

## Output

```text
.swarm/runs/<run-id>/
  final-report.md
  summary.json
  agents/
    agent-1/report.md
    agent-1/screenshots/
    agent-1/console.json
    agent-1/network.json
    agent-1/realtime-trace.json
    agent-1/handoff.json
    agent-1/trace.zip
```

## Demo

The demo app includes seeded browser bugs: console error, failed API request, clipped dropdown, broken modal close, broken pagination, bad empty-state link, and non-persisting settings save.

```bash
bun install
bun run build
bun install --cwd demo
bun run --cwd demo dev
```

In another terminal:

```bash
bun run cursor-browser-swarm run \
  --repo ./demo \
  --no-dev-server \
  --base-url http://localhost:3000 \
  --routes ./demo/swarm.routes.json \
  --instructions ./demo/swarm.instructions.md \
  --agents 4 \
  --mode dry-run
```

## ReactGrab handoff

ReactGrab/context-packet mode converts selected-element context into focused route missions:

```bash
cursor-browser-swarm handoff \
  --packet ./reactgrab-packet.json \
  --routes ./swarm.routes.json \
  --out ./swarm.generated.routes.json
```

The packet can include route, component stack, source files, DOM neighborhood, bounding box, screenshot path, and notes.
