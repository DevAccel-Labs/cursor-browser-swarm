/**
 * Supplemental capture when chrome-devtools-axi MCP times out (agent-2 mission).
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const artifactDir =
  "/Users/tejashaveri/.cursor-browser-swarm/runs/mystatusflow/ui-20260428T002656/agents/agent-2";
const targetUrl =
  "http://localhost:3000/workspace/workspace-2/kanban-v5?projectId=cmo85yk3g00fvjswzc3uvqa19&objectiveId=cmo85yk3g00fyjswzip61mvil&boardId=cmo8vgcp60001lg0098jkihkz";

const email = process.env.SWARM_SECRET_AGENT_TEST_ACCOUNT;
const password = process.env.SWARM_SECRET_AGENT_TEST_PASSWORD;

mkdirSync(path.join(artifactDir, "screenshots"), { recursive: true });

const consoles = [];
const networkRows = [];

function pushConsole(msg) {
  consoles.push({
    type: msg.type(),
    text: msg.text(),
    location: msg.location(),
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  page.on("console", pushConsole);

  page.on("response", (response) => {
    const req = response.request();
    networkRows.push({
      url: response.url(),
      status: response.status(),
      method: req.method(),
      resourceType: req.resourceType(),
    });
  });

  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 90000 });

  if (page.url().includes("/auth/signin")) {
    if (!email || !password) {
      throw new Error("Missing SWARM_SECRET_AGENT_TEST_ACCOUNT/PASSWORD for sign-in.");
    }
    await page.getByPlaceholder("your@email.com").fill(email);
    await page.getByPlaceholder("Your password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(
      (url) => !url.pathname.includes("/auth/signin"),
      { timeout: 60000 },
    );
    await page.waitForTimeout(2000);
  }

  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);

  const shotBoard = path.join(
    artifactDir,
    "screenshots",
    `kanban-board-after-login-${Date.now()}.png`,
  );
  await page.screenshot({ path: shotBoard, fullPage: false });

  /** @type {{ clicked: string[], errors: string[], visibleButtons: string }} */
  const interactionLog = { clicked: [], errors: [], visibleButtons: "" };

  try {
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .map((b) => (b.innerText || "").trim())
        .filter(Boolean)
        .slice(0, 40)
        .join(" | "),
    );
    interactionLog.visibleButtons = buttons;
  } catch (e) {
    interactionLog.errors.push(`button-scan:${String(e?.message || e)}`);
  }

  async function safeClick(roleOptions, fallbackText) {
    try {
      const loc = page.getByRole("button", roleOptions).first();
      if ((await loc.count()) > 0) {
        await loc.click({ timeout: 8000 });
        interactionLog.clicked.push(roleOptions.name?.toString() ?? fallbackText);
        await page.waitForTimeout(600);
        return true;
      }
    } catch (e) {
      interactionLog.errors.push(`${fallbackText}:${String(e?.message || e)}`);
    }
    return false;
  }

  await safeClick({ name: /add card/i }, "add-card-button");

  const maybeCardTitle = page.getByPlaceholder(/title|card|task/i).first();
  if ((await maybeCardTitle.count()) > 0) {
    await maybeCardTitle.fill(`QA card ${Date.now()}`);
    interactionLog.clicked.push("filled-card-title");
    await safeClick({ name: /save|create|add/i }, "save-card");
  }

  await page.screenshot({
    path: path.join(
      artifactDir,
      "screenshots",
      `kanban-after-add-attempt-${Date.now()}.png`,
    ),
    fullPage: false,
  });

  const title = await page.title();
  const bodySnippet = await page
    .evaluate(() => document.body?.innerText?.slice(0, 1200) ?? "")
    .catch(() => "");

  writeFileSync(
    path.join(artifactDir, "console.json"),
    JSON.stringify(
      {
        source: "playwright-supplemental",
        axiNote:
          "chrome-devtools-axi open/snapshot timed out with MCP -32001; console captured via Playwright.",
        pageTitle: title,
        interactions: interactionLog,
        entries: consoles,
      },
      null,
      2,
    ),
  );

  const failedOrRisky = networkRows.filter(
    (r) => r.status >= 400 || r.status === 0,
  );
  writeFileSync(
    path.join(artifactDir, "network.json"),
    JSON.stringify(
      {
        source: "playwright-supplemental",
        axiNote:
          "chrome-devtools-axi unavailable; responses logged from Playwright response listener.",
        failedOrNonOkReview: failedOrRisky.length ? failedOrRisky : [],
        allResponsesSample: networkRows.slice(0, 150),
        wsNote:
          "WebSocket frames not introspected in this supplemental capture.",
      },
      null,
      2,
    ),
  );

  writeFileSync(
    path.join(artifactDir, "page-snippet.txt"),
    JSON.stringify({ title, bodySnippet }, null, 2),
  );

  console.log(
    JSON.stringify({
      shotBoard,
      title,
      consoles: consoles.length,
      net: networkRows.length,
      interactionLog,
    }),
  );
  await browser.close();
})().catch((e) => {
  writeFileSync(
    path.join(artifactDir, "console.json"),
    JSON.stringify({
      source: "playwright-supplemental-error",
      error: String(e?.message || e),
    }),
    null,
    2,
  );
  process.exit(1);
});
