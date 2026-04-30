import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createArtifactPaths, getAgentArtifactPaths } from "../src/artifacts/artifactPaths.js";
import { __test__ } from "../src/cursor/cliClient.js";

async function createAgentPaths() {
  const dir = await mkdtemp(path.join(tmpdir(), "swarm-evidence-"));
  const runPaths = createArtifactPaths(dir);
  const agentPaths = getAgentArtifactPaths(runPaths, "agent-1");
  await mkdir(agentPaths.agentDir, { recursive: true });
  return agentPaths;
}

const goodOutput = [
  "npx -y chrome-devtools-axi open http://localhost:3000/auth/signin",
  "npx -y chrome-devtools-axi fill @email tester@example.com",
  "npx -y chrome-devtools-axi click @signin",
  "npx -y chrome-devtools-axi console --type error --limit 50",
  "npx -y chrome-devtools-axi network --limit 50",
].join("\n");

describe("CLI evidence verifier", () => {
  it("recreates the event log parent directory for agent events", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "swarm-events-"));
    const eventsPath = path.join(dir, "deleted", "run", "events.jsonl");

    await __test__.appendAgentEvent({
      eventsPath,
      agentId: "agent-1",
      phase: "start",
      message: "Launching Cursor CLI for agent-1",
    });

    const eventText = await readFile(eventsPath, "utf8");
    expect(eventText).toContain("Launching Cursor CLI for agent-1");
    expect(eventText).toContain('"sequence":1');
  });

  it("converts manifest findings into final-report findings", () => {
    const findings = __test__.manifestToFindings({
      version: "1",
      agentId: "agent-1",
      status: "passed",
      baseUrl: "http://localhost:3000",
      routes: [
        {
          path: "/kanban",
          status: "passed",
          opened: true,
          interactions: ["Opened board", "Archived card"],
          screenshots: ["/tmp/board.png"],
          consoleChecked: true,
          networkChecked: true,
          findings: [
            {
              id: "F2",
              title: "Archived items accessible name collapses to count",
              findingKind: "product-bug",
              classification: "root-cause-candidate",
              rootCauseKey: "archived-items-a11y",
              observedBehavior:
                "The archived-items control exposes only a count as its accessible name.",
              inferredCause: "The label text may be hidden from the accessibility tree.",
              protocolEvidence: ["No realtime traffic relevant to this accessibility issue."],
              debugHints: ["Search ArchiveMenu accessible name and aria-label handling."],
              fixReadiness: "ready",
              severity: "low",
              confidence: "high",
              evidence: ["/tmp/archive-menu.png"],
              reproSteps: ["Open archived items menu"],
              likelyFiles: ["src/components/ArchiveMenu.tsx"],
            },
            {
              id: "F3",
              description: "Card title remains in the add-card input after close and reopen.",
              findingKind: "scenario-blocked",
              classification: "needs-clean-repro",
              needsCleanRepro: true,
              severity: "medium",
              confidence: "high",
            },
            {
              id: "F4",
              title: "chrome-devtools-axi MCP requests time out",
              classification: "observability",
              observedBehavior: "MCP -32001 timeout while calling AXI snapshot.",
              severity: "medium",
              confidence: "high",
            },
            "Duplicate Not Started label needs visual review",
          ],
        },
      ],
      artifacts: {
        report: "/tmp/report.md",
        screenshots: ["/tmp/board.png"],
        console: "/tmp/console.json",
        network: "/tmp/network.json",
      },
      selfCheck: {
        browserOpened: true,
        browserInteracted: true,
        screenshotsExist: true,
        consoleInspected: true,
        networkInspected: true,
        artifactPathsExist: true,
      },
      notes: [],
    });

    expect(findings).toHaveLength(4);
    expect(findings[0]).toMatchObject({
      title: "Archived items accessible name collapses to count",
      route: "/kanban",
      agentId: "agent-1",
      severity: "low",
      confidence: "high",
      findingKind: "product-bug",
      classification: "root-cause-candidate",
      rootCauseKey: "archived-items-a11y",
      observedBehavior: "The archived-items control exposes only a count as its accessible name.",
      inferredCause: "The label text may be hidden from the accessibility tree.",
      protocolEvidence: ["No realtime traffic relevant to this accessibility issue."],
      debugHints: ["Search ArchiveMenu accessible name and aria-label handling."],
      fixReadiness: "ready",
      likelyFiles: ["src/components/ArchiveMenu.tsx"],
      reproSteps: ["Open archived items menu"],
    });
    expect(findings[1]).toMatchObject({
      title: "Card title remains in the add-card input after close and reopen.",
      findingKind: "scenario-blocked",
      classification: "needs-clean-repro",
      needsCleanRepro: true,
      severity: "medium",
      confidence: "high",
    });
    expect(findings[2]).toMatchObject({
      title: "chrome-devtools-axi MCP requests time out",
      classification: "tooling",
    });
    expect(findings[3]).toMatchObject({
      title: "Duplicate Not Started label needs visual review",
      severity: "low",
      confidence: "medium",
    });
  });

  it("does not verify a report that references a missing screenshot", async () => {
    const paths = await createAgentPaths();
    await writeFile(
      paths.reportPath,
      [
        "# Report",
        "Screenshot: post-signin-dashboard.png",
        "Console showed no errors.",
        "Network showed no failed requests.",
      ].join("\n"),
    );

    const result = await __test__.verifyCliEvidence({
      output: goodOutput,
      artifactPaths: paths,
    });

    expect(result.status).not.toBe("verified");
    expect(result.missingArtifactReferences).toEqual(["post-signin-dashboard.png"]);
    expect(result.notes.join("\n")).toContain("Missing referenced artifacts");
  });

  it("verifies when required browser proof and screenshot files exist", async () => {
    const paths = await createAgentPaths();
    await writeFile(path.join(paths.agentDir, "post-signin-dashboard.png"), "fake image bytes");
    await writeFile(
      paths.reportPath,
      [
        "# Report",
        "Screenshot: post-signin-dashboard.png",
        "Console showed no errors.",
        "Network showed no failed requests.",
      ].join("\n"),
    );

    const result = await __test__.verifyCliEvidence({
      output: goodOutput,
      artifactPaths: paths,
    });

    expect(result.status).toBe("verified");
    expect(result.score).toBe("strong");
  });

  it("uses an evidence manifest as the primary proof contract", async () => {
    const paths = await createAgentPaths();
    const screenshotPath = path.join(paths.screenshotsDir, "dashboard.png");
    await mkdir(paths.screenshotsDir, { recursive: true });
    await writeFile(screenshotPath, "fake image bytes");
    await writeFile(paths.consolePath, "[]\n");
    await writeFile(paths.networkPath, "[]\n");
    await writeFile(
      paths.reportPath,
      "# Report\nScreenshot: screenshots/dashboard.png\nNetwork review: no failed requests, 4xx, or 5xx responses observed.\n",
    );
    await writeFile(
      paths.evidenceManifestPath,
      `${JSON.stringify(
        {
          version: "1",
          agentId: "agent-1",
          status: "passed",
          baseUrl: "http://localhost:3000",
          routes: [
            {
              path: "/dashboard",
              status: "passed",
              opened: true,
              interactions: ["Clicked primary action"],
              screenshots: [screenshotPath],
              consoleChecked: true,
              networkChecked: true,
              findings: [],
            },
          ],
          artifacts: {
            report: paths.reportPath,
            screenshots: [screenshotPath],
            console: paths.consolePath,
            network: paths.networkPath,
          },
          selfCheck: {
            browserOpened: true,
            browserInteracted: true,
            screenshotsExist: true,
            consoleInspected: true,
            networkInspected: true,
            artifactPathsExist: true,
          },
          notes: [],
        },
        null,
        2,
      )}\n`,
    );

    const result = await __test__.verifyCliEvidence({
      output: "",
      artifactPaths: paths,
    });

    expect(result.status).toBe("verified");
    expect(result.score).toBe("strong");
  });

  it("does not mark evidence strong without explicit failed-request review", async () => {
    const paths = await createAgentPaths();
    const screenshotPath = path.join(paths.screenshotsDir, "dashboard.png");
    await mkdir(paths.screenshotsDir, { recursive: true });
    await writeFile(screenshotPath, "fake image bytes");
    await writeFile(paths.consolePath, "[]\n");
    await writeFile(paths.networkPath, "[]\n");
    await writeFile(paths.reportPath, "# Report\nScreenshot: screenshots/dashboard.png\n");
    await writeFile(
      paths.evidenceManifestPath,
      `${JSON.stringify(
        {
          version: "1",
          agentId: "agent-1",
          status: "passed",
          baseUrl: "http://localhost:3000",
          routes: [
            {
              path: "/dashboard",
              status: "passed",
              opened: true,
              interactions: ["Clicked primary action"],
              screenshots: [screenshotPath],
              consoleChecked: true,
              networkChecked: true,
              findings: [],
            },
          ],
          artifacts: {
            report: paths.reportPath,
            screenshots: [screenshotPath],
            console: paths.consolePath,
            network: paths.networkPath,
          },
          selfCheck: {
            browserOpened: true,
            browserInteracted: true,
            screenshotsExist: true,
            consoleInspected: true,
            networkInspected: true,
            artifactPathsExist: true,
          },
          notes: [],
        },
        null,
        2,
      )}\n`,
    );

    const result = await __test__.verifyCliEvidence({
      output: "",
      artifactPaths: paths,
    });

    expect(result.status).toBe("verified");
    expect(result.score).toBe("partial");
    expect(result.notes.join("\n")).toContain(
      "Missing explicit failed-request/4xx/5xx network review",
    );
  });

  it("downgrades fix-readiness when realtime concerns lack protocol evidence", async () => {
    const paths = await createAgentPaths();
    const screenshotPath = path.join(paths.screenshotsDir, "kanban.png");
    await mkdir(paths.screenshotsDir, { recursive: true });
    await writeFile(screenshotPath, "fake image bytes");
    await writeFile(paths.consolePath, "[]\n");
    await writeFile(paths.networkPath, "Network review: no failed requests, 4xx, or 5xx.\n");
    await writeFile(
      paths.reportPath,
      [
        "# Report",
        "Screenshot: screenshots/kanban.png",
        "Network review: no failed requests, 4xx, or 5xx responses observed.",
        "Observed optimistic temp_ card disappeared after persistence reconciliation.",
      ].join("\n"),
    );
    await writeFile(
      paths.evidenceManifestPath,
      `${JSON.stringify(
        {
          version: "1",
          agentId: "agent-1",
          status: "failed",
          baseUrl: "http://localhost:3000",
          routes: [
            {
              path: "/kanban",
              status: "failed",
              opened: true,
              interactions: ["Created card", "Set date"],
              screenshots: [screenshotPath],
              consoleChecked: true,
              networkChecked: true,
              findings: [],
            },
          ],
          artifacts: {
            report: paths.reportPath,
            screenshots: [screenshotPath],
            console: paths.consolePath,
            network: paths.networkPath,
          },
          selfCheck: {
            browserOpened: true,
            browserInteracted: true,
            screenshotsExist: true,
            consoleInspected: true,
            networkInspected: true,
            artifactPathsExist: true,
          },
          notes: [],
        },
        null,
        2,
      )}\n`,
    );

    const result = await __test__.verifyCliEvidence({
      output: "",
      artifactPaths: paths,
    });

    expect(result.status).toBe("verified");
    expect(result.score).toBe("partial");
    expect(result.notes.join("\n")).toContain("Realtime/protocol concern detected");
  });

  it("does not mark evidence strong when realtime trace only documents probe failure", async () => {
    const paths = await createAgentPaths();
    const screenshotPath = path.join(paths.screenshotsDir, "kanban.png");
    await mkdir(paths.screenshotsDir, { recursive: true });
    await writeFile(screenshotPath, "fake image bytes");
    await writeFile(paths.consolePath, "[]\n");
    await writeFile(paths.networkPath, "Network review: no failed requests, 4xx, or 5xx.\n");
    await writeFile(
      paths.realtimeTracePath,
      `${JSON.stringify(
        {
          captureMethod: "page-probe",
          status: "probe-error",
          note: 'realtime-save returned "fn is not a function".',
          events: [],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      paths.reportPath,
      [
        "# Report",
        "Screenshot: screenshots/kanban.png",
        "Network review: no failed requests, 4xx, or 5xx responses observed.",
        "Observed optimistic temp_ card disappeared after persistence reconciliation.",
      ].join("\n"),
    );
    await writeFile(
      paths.evidenceManifestPath,
      `${JSON.stringify(
        {
          version: "1",
          agentId: "agent-1",
          status: "failed",
          baseUrl: "http://localhost:3000",
          routes: [
            {
              path: "/kanban",
              status: "failed",
              opened: true,
              interactions: ["Created card", "Set date"],
              screenshots: [screenshotPath],
              consoleChecked: true,
              networkChecked: true,
              realtimeChecked: true,
              findings: [],
            },
          ],
          artifacts: {
            report: paths.reportPath,
            screenshots: [screenshotPath],
            console: paths.consolePath,
            network: paths.networkPath,
            realtimeTrace: paths.realtimeTracePath,
          },
          selfCheck: {
            browserOpened: true,
            browserInteracted: true,
            screenshotsExist: true,
            consoleInspected: true,
            networkInspected: true,
            realtimeInspected: true,
            artifactPathsExist: true,
          },
          notes: [],
        },
        null,
        2,
      )}\n`,
    );

    const result = await __test__.verifyCliEvidence({
      output: "",
      artifactPaths: paths,
    });

    expect(result.status).toBe("verified");
    expect(result.score).toBe("partial");
    expect(result.notes.join("\n")).toContain("Realtime trace status is probe-error");
  });

  it("accepts Playwright-style realtime trace arrays as usable protocol artifacts", async () => {
    const paths = await createAgentPaths();
    const screenshotPath = path.join(paths.screenshotsDir, "kanban.png");
    await mkdir(paths.screenshotsDir, { recursive: true });
    await writeFile(screenshotPath, "fake image bytes");
    await writeFile(paths.consolePath, "[]\n");
    await writeFile(paths.networkPath, "Network review: no failed requests, 4xx, or 5xx.\n");
    await writeFile(
      paths.realtimeTracePath,
      `${JSON.stringify([
        {
          transport: "websocket",
          direction: "inbound",
          url: "ws://localhost/realtime",
          payload: "{}",
          timestamp: new Date().toISOString(),
        },
      ])}\n`,
    );
    await writeFile(
      paths.reportPath,
      [
        "# Report",
        "Screenshot: screenshots/kanban.png",
        "Network review: no failed requests, 4xx, or 5xx responses observed.",
        "Observed optimistic temp_ card reconciled after websocket ack.",
      ].join("\n"),
    );

    const result = await __test__.verifyCliEvidence({
      output: goodOutput,
      artifactPaths: paths,
    });

    expect(result.status).toBe("verified");
    expect(result.score).toBe("strong");
  });

  it("surfaces blocked evidence manifests without verifying them", async () => {
    const paths = await createAgentPaths();
    await writeFile(paths.reportPath, "# Report\nBlocked: AXI could not connect.\n");
    await writeFile(
      paths.evidenceManifestPath,
      `${JSON.stringify({
        version: "1",
        agentId: "agent-1",
        status: "blocked",
        baseUrl: "http://localhost:3000",
        routes: [],
        artifacts: {
          report: paths.reportPath,
          screenshots: [],
          console: paths.consolePath,
          network: paths.networkPath,
        },
        selfCheck: {
          browserOpened: false,
          browserInteracted: false,
          screenshotsExist: false,
          consoleInspected: false,
          networkInspected: false,
          artifactPathsExist: false,
        },
        blockedReason: "AXI could not connect.",
        notes: [],
      })}\n`,
    );

    const result = await __test__.verifyCliEvidence({
      output: "",
      artifactPaths: paths,
    });

    expect(result.status).toBe("missing");
    expect(result.score).toBe("weak");
    expect(result.blockedReason).toBe("AXI could not connect.");
  });
});
