import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
  type Page,
} from "playwright";
import type {
  ActionStep,
  AgentAssignment,
  AgentArtifactPaths,
  BrowserScenarioResult,
  ConsoleEntry,
  Finding,
  NetworkEntry,
  RealtimeEntry,
} from "../types.js";

interface BrowserScenarioInput {
  agentId: string;
  assignment: AgentAssignment;
  baseUrl: string;
  artifactPaths: AgentArtifactPaths;
  maxRouteSteps: number;
}

function absoluteRouteUrl(baseUrl: string, routePath: string): string {
  if (URL.canParse(routePath)) {
    return routePath;
  }
  return new URL(routePath, baseUrl).toString();
}

function safeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function isDangerousLabel(label: string): boolean {
  return /delete|remove|archive|billing|payment|charge|destroy/i.test(label);
}

async function clickBoundedElements(page: Page, maxSteps: number): Promise<ActionStep[]> {
  const actions: ActionStep[] = [];
  const selector = "button, a, [role='button'], input, select, textarea";
  const candidates = await page.locator(selector).evaluateAll((nodes) =>
    nodes
      .map((node, index) => ({
        index,
        label:
          node.textContent?.trim() ||
          node.getAttribute("aria-label") ||
          node.getAttribute("placeholder") ||
          "",
        tagName: node.tagName.toLowerCase(),
      }))
      .filter((node) => node.label || ["input", "select", "textarea"].includes(node.tagName)),
  );
  const count = Math.min(candidates.length, maxSteps);

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    const element = page.locator(selector).nth(candidate.index);
    const label = candidate.label.trim();
    const tagName = candidate.tagName;
    if (isDangerousLabel(label)) {
      actions.push({
        label: `Skipped potentially destructive control: ${label}`,
        status: "skipped",
      });
      continue;
    }

    try {
      if (tagName === "input" || tagName === "textarea") {
        await element.fill("swarm test");
        actions.push({ label: `Filled ${tagName}${label ? ` "${label}"` : ""}`, status: "passed" });
      } else if (tagName === "select") {
        const options = await element.locator("option").all();
        if (options.length > 1) {
          const value = await options[1]?.getAttribute("value");
          if (value) {
            await element.selectOption(value);
            actions.push({ label: `Selected option in ${label || "select"}`, status: "passed" });
          }
        }
      } else if (tagName === "a") {
        actions.push({ label: `Observed link ${label}`, status: "skipped" });
      } else {
        await element.click({ timeout: 1500 });
        actions.push({ label: `Clicked ${label || tagName}`, status: "passed" });
        await page.waitForTimeout(250);
      }
    } catch (error) {
      actions.push({
        label: `Interaction failed for ${label || tagName}`,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return actions;
}

function collectHeuristicFindings(input: {
  agentId: string;
  route: string;
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
  actions: ActionStep[];
  screenshotPath: string;
  tracePath: string;
}): Finding[] {
  const findings: Finding[] = [];
  const errorEntries = input.consoleEntries.filter(
    (entry) => entry.type === "error" || entry.type === "pageerror",
  );
  if (errorEntries.length > 0) {
    findings.push({
      title: "Console error observed during scenario",
      route: input.route,
      agentId: input.agentId,
      severity: "medium",
      confidence: "high",
      evidence: [input.screenshotPath, input.tracePath, "console.json"],
      reproSteps: [
        `Open ${input.route}`,
        "Run the assigned scenario interactions",
        "Inspect browser console errors",
      ],
      likelyFiles: [],
      fixStatus: "none",
    });
  }

  const failedRequests = input.networkEntries.filter(
    (entry) => entry.failureText || (entry.status && entry.status >= 400),
  );
  if (failedRequests.length > 0) {
    findings.push({
      title: "Failed network request observed during scenario",
      route: input.route,
      agentId: input.agentId,
      severity: "medium",
      confidence: "high",
      evidence: [input.screenshotPath, input.tracePath, "network.json"],
      reproSteps: [
        `Open ${input.route}`,
        "Run the assigned scenario interactions",
        "Inspect failed network requests",
      ],
      likelyFiles: [],
      fixStatus: "none",
    });
  }

  const failedActions = input.actions.filter((action) => action.status === "failed");
  if (failedActions.length > 0) {
    findings.push({
      title: "Interactive control failed during route sweep",
      route: input.route,
      agentId: input.agentId,
      severity: "low",
      confidence: "medium",
      evidence: [input.screenshotPath, input.tracePath],
      reproSteps: [
        `Open ${input.route}`,
        failedActions[0]?.label ?? "Interact with the failing control",
      ],
      likelyFiles: [],
      fixStatus: "none",
    });
  }

  return findings;
}

async function attachCollectors(page: Page): Promise<{
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
  realtimeEntries: RealtimeEntry[];
}> {
  const consoleEntries: ConsoleEntry[] = [];
  const networkEntries: NetworkEntry[] = [];
  const realtimeEntries: RealtimeEntry[] = [];

  const payloadText = (payload: string | Buffer): string =>
    typeof payload === "string" ? payload : `[binary ${payload.byteLength} bytes]`;

  page.on("console", (message) => {
    consoleEntries.push({
      type: message.type(),
      text: message.text(),
      location: `${message.location().url}:${message.location().lineNumber}`,
      timestamp: new Date().toISOString(),
    });
  });

  page.on("pageerror", (error) => {
    consoleEntries.push({
      type: "pageerror",
      text: error.message,
      timestamp: new Date().toISOString(),
    });
  });

  page.on("requestfailed", (request) => {
    const failureText = request.failure()?.errorText;
    networkEntries.push({
      url: request.url(),
      method: request.method(),
      ...(failureText ? { failureText } : {}),
      resourceType: request.resourceType(),
      timestamp: new Date().toISOString(),
    });
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkEntries.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        resourceType: response.request().resourceType(),
        timestamp: new Date().toISOString(),
      });
    }
  });

  page.on("websocket", (socket) => {
    const url = socket.url();
    realtimeEntries.push({
      transport: "websocket",
      direction: "connect",
      url,
      timestamp: new Date().toISOString(),
    });
    socket.on("framesent", (event) => {
      realtimeEntries.push({
        transport: "websocket",
        direction: "outbound",
        url,
        payload: payloadText(event.payload),
        timestamp: new Date().toISOString(),
      });
    });
    socket.on("framereceived", (event) => {
      realtimeEntries.push({
        transport: "websocket",
        direction: "inbound",
        url,
        payload: payloadText(event.payload),
        timestamp: new Date().toISOString(),
      });
    });
    socket.on("close", () => {
      realtimeEntries.push({
        transport: "websocket",
        direction: "close",
        url,
        timestamp: new Date().toISOString(),
      });
    });
  });

  return { consoleEntries, networkEntries, realtimeEntries };
}

async function runWithBrowser<T>(
  callback: (browser: Browser, context: BrowserContext, page: Page) => Promise<T>,
): Promise<T> {
  const launchOptions: LaunchOptions = process.env.SWARM_CHROME_CHANNEL
    ? { headless: true, channel: process.env.SWARM_CHROME_CHANNEL }
    : { headless: true };
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    return await callback(browser, context, page);
  } finally {
    await browser.close();
  }
}

export async function runBrowserScenario(
  input: BrowserScenarioInput,
): Promise<BrowserScenarioResult> {
  await mkdir(input.artifactPaths.screenshotsDir, { recursive: true });
  const allConsoleEntries: ConsoleEntry[] = [];
  const allNetworkEntries: NetworkEntry[] = [];
  const allRealtimeEntries: RealtimeEntry[] = [];
  const screenshots: string[] = [];
  const findings: Finding[] = [];
  const notes: string[] = [];
  const allActions: ActionStep[] = [];

  await runWithBrowser(async (_browser, context, page) => {
    const collectors = await attachCollectors(page);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    for (const route of input.assignment.routes) {
      const url = absoluteRouteUrl(input.baseUrl, route.path);
      const screenshotPath = path.join(
        input.artifactPaths.screenshotsDir,
        `${safeLabel(route.path || "route")}-after.png`,
      );
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
      } catch (error) {
        notes.push(
          `Navigation issue for ${route.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshots.push(screenshotPath);
      let actions: ActionStep[] = [];
      try {
        actions = await clickBoundedElements(page, input.maxRouteSteps);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actions = [{ label: "Route interaction sweep failed", status: "failed", detail: message }];
        notes.push(`Interaction sweep issue for ${route.path}: ${message}`);
      }
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
        notes.push(
          `Post-interaction screenshot issue for ${route.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      allActions.push(...actions);
      notes.push(
        `Actions for ${route.path}: ${actions.map((action) => action.label).join("; ") || "No safe interactive controls found."}`,
      );

      findings.push(
        ...collectHeuristicFindings({
          agentId: input.agentId,
          route: route.path,
          consoleEntries: collectors.consoleEntries,
          networkEntries: collectors.networkEntries,
          actions,
          screenshotPath,
          tracePath: input.artifactPaths.tracePath,
        }),
      );
    }

    try {
      await context.tracing.stop({ path: input.artifactPaths.tracePath });
    } catch (error) {
      notes.push(`Trace save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    allConsoleEntries.push(...collectors.consoleEntries);
    allNetworkEntries.push(...collectors.networkEntries);
    allRealtimeEntries.push(...collectors.realtimeEntries);
  });

  await writeFile(
    input.artifactPaths.consolePath,
    `${JSON.stringify(allConsoleEntries, null, 2)}\n`,
  );
  await writeFile(
    input.artifactPaths.networkPath,
    `${JSON.stringify(allNetworkEntries, null, 2)}\n`,
  );
  await writeFile(
    input.artifactPaths.realtimeTracePath,
    `${JSON.stringify(allRealtimeEntries, null, 2)}\n`,
  );

  return {
    screenshots,
    consoleEntries: allConsoleEntries,
    networkEntries: allNetworkEntries,
    realtimeEntries: allRealtimeEntries,
    tracePath: input.artifactPaths.tracePath,
    findings,
    notes,
    actions: allActions,
  };
}
