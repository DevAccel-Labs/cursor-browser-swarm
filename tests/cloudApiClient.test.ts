import { describe, expect, it } from "vitest";
import { __test__ } from "../src/cursor/cloudApiClient.js";

describe("CloudApiCursorAgentClient helpers", () => {
  it("generates Cursor Basic auth header", () => {
    expect(__test__.authHeader("cur_test")).toBe(
      `Basic ${Buffer.from("cur_test:").toString("base64")}`,
    );
  });

  it("maps known Cloud Agent statuses", () => {
    expect(__test__.mapCloudStatus("CREATING")).toBe("queued");
    expect(__test__.mapCloudStatus("RUNNING")).toBe("running");
    expect(__test__.mapCloudStatus("FINISHED")).toBe("succeeded");
    expect(__test__.mapCloudStatus("FAILED")).toBe("failed");
  });
});
