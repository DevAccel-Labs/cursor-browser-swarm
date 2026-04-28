import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { ConsoleEntry, NetworkEntry } from "../types.js";

export class PlaywrightSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private readonly consoleEntries: ConsoleEntry[] = [];
  private readonly networkEntries: NetworkEntry[] = [];
  private traceStarted = false;

  public constructor(
    private readonly baseUrl: string,
    private readonly artifactDir: string,
  ) {}

  public async ensurePage(): Promise<Page> {
    if (this.page) {
      return this.page;
    }
    await mkdir(this.artifactDir, { recursive: true });
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    this.traceStarted = true;
    this.page = await this.context.newPage();
    this.attachCollectors(this.page);
    return this.page;
  }

  public async open(routeOrUrl: string): Promise<string> {
    const page = await this.ensurePage();
    const url = URL.canParse(routeOrUrl)
      ? routeOrUrl
      : new URL(routeOrUrl, this.baseUrl).toString();
    await page.goto(url, { waitUntil: "networkidle" });
    return page.url();
  }

  public async observe(): Promise<Record<string, unknown>> {
    const page = await this.ensurePage();
    const elements = await page
      .locator("button, a, input, textarea, select, [role='button']")
      .evaluateAll((nodes) =>
        nodes.slice(0, 40).map((node, index) => ({
          index,
          tag: node.tagName.toLowerCase(),
          text: node.textContent?.trim().slice(0, 120) ?? "",
          ariaLabel: node.getAttribute("aria-label"),
        })),
      );
    return {
      url: page.url(),
      title: await page.title(),
      headings: await page.locator("h1,h2,h3").allTextContents(),
      interactiveElements: elements,
    };
  }

  public async clickText(text: string): Promise<string> {
    const page = await this.ensurePage();
    await page.getByText(text, { exact: false }).first().click();
    return `Clicked text: ${text}`;
  }

  public async clickRole(role: Parameters<Page["getByRole"]>[0], name: string): Promise<string> {
    const page = await this.ensurePage();
    await page.getByRole(role, { name }).click();
    return `Clicked role ${role}: ${name}`;
  }

  public async typeInto(label: string, value: string): Promise<string> {
    const page = await this.ensurePage();
    await page.getByLabel(label).fill(value);
    return `Typed into ${label}`;
  }

  public getConsoleErrors(): ConsoleEntry[] {
    return this.consoleEntries.filter(
      (entry) => entry.type === "error" || entry.type === "pageerror",
    );
  }

  public getFailedRequests(): NetworkEntry[] {
    return this.networkEntries;
  }

  public async screenshot(label: string): Promise<string> {
    const page = await this.ensurePage();
    const fileName = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "screenshot"}.png`;
    const screenshotPath = path.join(this.artifactDir, fileName);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  }

  public async saveTrace(): Promise<string> {
    const tracePath = path.join(this.artifactDir, "trace.zip");
    if (this.context && this.traceStarted) {
      await this.context.tracing.stop({ path: tracePath });
      this.traceStarted = false;
    }
    return tracePath;
  }

  public async close(): Promise<void> {
    if (this.context && this.traceStarted) {
      await this.context.tracing
        .stop({ path: path.join(this.artifactDir, "trace.zip") })
        .catch(() => undefined);
      this.traceStarted = false;
    }
    await this.browser?.close();
  }

  private attachCollectors(page: Page): void {
    page.on("console", (message) => {
      this.consoleEntries.push({
        type: message.type(),
        text: message.text(),
        timestamp: new Date().toISOString(),
      });
    });
    page.on("pageerror", (error) => {
      this.consoleEntries.push({
        type: "pageerror",
        text: error.message,
        timestamp: new Date().toISOString(),
      });
    });
    page.on("requestfailed", (request) => {
      const entry: NetworkEntry = {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        timestamp: new Date().toISOString(),
      };
      const failureText = request.failure()?.errorText;
      if (failureText) {
        entry.failureText = failureText;
      }
      this.networkEntries.push(entry);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        this.networkEntries.push({
          url: response.url(),
          method: response.request().method(),
          status: response.status(),
          resourceType: response.request().resourceType(),
          timestamp: new Date().toISOString(),
        });
      }
    });
  }
}
