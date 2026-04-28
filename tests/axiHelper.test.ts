import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createArtifactPaths, getAgentArtifactPaths } from "../src/artifacts/artifactPaths.js";
import { writeAxiHelper } from "../src/cursor/axiHelper.js";

describe("writeAxiHelper", () => {
  it("generates an AXI-style helper with broad command coverage", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "swarm-axi-helper-"));
    const paths = getAgentArtifactPaths(createArtifactPaths(dir), "agent-1");

    await writeAxiHelper(paths);
    const script = await readFile(paths.axiHelperPath, "utf8");

    expect(script).toContain("description: Swarm-scoped AXI helper");
    expect(script).toContain('"fillform"');
    expect(script).toContain('"pages"');
    expect(script).toContain('"emulate"');
    expect(script).toContain('"lighthouse"');
    expect(script).toContain('"perf-start"');
    expect(script).toContain('"heap"');
    expect(script).toContain("realtime-start");
    expect(script).toContain("realtime-save");
    expect(script).toContain("realtime-cdp-record");
    expect(script).toContain("SWARM_CDP_URL");
    expect(script).toContain("realtime-trace.json");
    expect(script).toContain("passthroughCommands.has(command)");
    expect(script).toContain("SWARM_BROWSER_HOME");
    expect(script).toContain("CHROME_DEVTOOLS_AXI_DISABLE_HOOKS");
    expect(script).toContain("scriptsDir");
    expect(script).toContain("help[5]:");
  });
});
