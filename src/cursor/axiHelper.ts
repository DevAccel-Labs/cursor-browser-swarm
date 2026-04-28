import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentArtifactPaths } from "../types.js";

export async function writeAxiHelper(paths: AgentArtifactPaths): Promise<void> {
  const script = `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const artifactDir = process.env.SWARM_ARTIFACT_DIR || ${JSON.stringify(paths.agentDir)};
const screenshotsDir = path.join(artifactDir, "screenshots");
const perfDir = path.join(artifactDir, "performance");
const heapDir = path.join(artifactDir, "memory");
const realtimePath = path.join(artifactDir, "realtime-trace.json");
const scriptsDir = process.env.SWARM_BROWSER_SCRIPTS_DIR || path.join(artifactDir, "scripts");
const tempDir = process.env.SWARM_BROWSER_TEMP_DIR || path.join(artifactDir, "tmp");
const browserHome = process.env.SWARM_BROWSER_HOME;
const npmCacheDir = process.env.SWARM_NPM_CACHE_DIR || process.env.npm_config_cache || (process.env.HOME ? path.join(process.env.HOME, ".npm") : undefined);

const passthroughCommands = new Set([
  "open", "snapshot", "scroll", "back", "wait", "eval", "run",
  "click", "fill", "fillform", "type", "press", "hover", "drag", "dialog", "upload",
  "pages", "newpage", "selectpage", "closepage", "resize", "emulate",
  "console-get", "network-get", "lighthouse", "perf-insight", "start", "stop",
]);

function slug(value) {
  return (value || "screenshot").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "screenshot";
}

function runAxi(args, outputPath, options = {}) {
  const input = options.stdin ? readFileSync(0, "utf8") : undefined;
  const result = spawnSync("npx", ["-y", "chrome-devtools-axi", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...(browserHome ? { HOME: browserHome } : {}),
      ...(npmCacheDir ? { npm_config_cache: npmCacheDir } : {}),
      TMPDIR: tempDir,
      TEMP: tempDir,
      TMP: tempDir,
      CHROME_DEVTOOLS_AXI_DISABLE_HOOKS: "1",
    },
    input,
    stdio: outputPath ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (outputPath) {
    writeFileSync(outputPath, result.stdout || "[]\\n");
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function showHome() {
  console.log(\`bin: \${process.argv[1]}\`);
  console.log("description: Swarm-scoped AXI helper for browser validation artifacts");
  console.log(\`artifactDir: \${artifactDir}\`);
  console.log(\`browserSession: \${process.env.SWARM_BROWSER_SESSION_ID || "default"}\`);
  console.log(\`axiPort: \${process.env.CHROME_DEVTOOLS_AXI_PORT || "9224"}\`);
  console.log(\`scriptsDir: \${scriptsDir}\`);
  if (npmCacheDir) {
    console.log(\`npmCacheDir: \${npmCacheDir}\`);
  }
  console.log("commands[33]{name,purpose}:");
  console.log("  open,navigate + snapshot");
  console.log("  snapshot,capture current page state");
  console.log("  screenshot,save screenshot under screenshots/");
  console.log("  click,click uid; forwards --query and other AXI flags");
  console.log("  fill,fill one field; forwards --submit and other AXI flags");
  console.log("  fillform,fill multiple fields");
  console.log("  console,save error console output to console.json");
  console.log("  network,save network output to network.json");
  console.log("  realtime-start,install page-level WebSocket probe for future sockets");
  console.log("  realtime-save,save WebSocket probe output to realtime-trace.json");
  console.log("  realtime-cdp-record,record native CDP WebSocket frames when a debugging endpoint is configured");
  console.log("  pages,list tabs");
  console.log("  newpage,open new tab");
  console.log("  selectpage,switch tab");
  console.log("  closepage,close tab");
  console.log("  back,navigate back");
  console.log("  wait,wait for text or milliseconds");
  console.log("  scroll,scroll page");
  console.log("  eval,evaluate JavaScript");
  console.log("  run,execute AXI script from stdin");
  console.log("  type,type at focus");
  console.log("  press,press key");
  console.log("  hover,hover uid");
  console.log("  drag,drag uid to uid");
  console.log("  dialog,accept or dismiss dialog");
  console.log("  upload,upload file");
  console.log("  resize,resize viewport");
  console.log("  emulate,emulate device/network/viewport");
  console.log("  lighthouse,write Lighthouse report under performance/");
  console.log("  perf-start,start trace under performance/");
  console.log("  perf-stop,stop trace under performance/");
  console.log("  perf-insight,analyze trace insight");
  console.log("  heap,write heap snapshot under memory/");
  console.log("help[5]:");
  console.log(\`  Run \\\`node \${process.argv[1]} open <url> --query "<text>"\\\`\`);
  console.log(\`  Run \\\`node \${process.argv[1]} click @<uid> --query "<text>"\\\`\`);
  console.log(\`  Run \\\`node \${process.argv[1]} fill @<uid> "<value>" --submit\\\`\`);
  console.log(\`  Run \\\`node \${process.argv[1]} screenshot "<label>"\\\`\`);
  console.log(\`  Run \\\`node \${process.argv[1]} --help\\\`\`);
}

function showHelp() {
  showHome();
  console.log("usage: node swarm-axi.mjs <command> [...args]");
  console.log("notes[3]:");
  console.log("  Most commands pass through to chrome-devtools-axi with all extra flags.");
  console.log("  Artifact shortcuts save console/network/screenshots/perf/heap output under this agent directory.");
  console.log("  stdout is command output; stderr is reserved for debug output from wrapped tools.");
  console.log("  Write any temporary validation scripts only under scriptsDir.");
}

const [command, ...args] = process.argv.slice(2);
mkdirSync(screenshotsDir, { recursive: true });
mkdirSync(perfDir, { recursive: true });
mkdirSync(heapDir, { recursive: true });
mkdirSync(scriptsDir, { recursive: true });
mkdirSync(tempDir, { recursive: true });
if (browserHome) {
  mkdirSync(browserHome, { recursive: true });
}

if (!command) {
  showHome();
  process.exit(0);
}

if (command === "--help" || command === "help") {
  showHelp();
  process.exit(0);
}

const realtimeStartSource = [
  "(() => {",
  "  const w = window;",
  "  if (w.__swarmRealtimeProbeInstalled) return 'swarm realtime probe already installed';",
  "  const NativeWebSocket = w.WebSocket;",
  "  const events = w.__swarmRealtimeEvents || [];",
  "  const record = (event) => events.push({ transport: 'websocket', timestamp: new Date().toISOString(), ...event });",
  "  const payload = (data) => {",
  "    try {",
  "      if (typeof data === 'string') return data;",
  "      if (data && typeof data === 'object' && 'byteLength' in data) return '[binary ' + data.byteLength + ' bytes]';",
  "      return String(data);",
  "    } catch {",
  "      return '[unserializable payload]';",
  "    }",
  "  };",
  "  function SwarmWebSocket(url, protocols) {",
  "    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);",
  "    const socketUrl = String(url);",
  "    record({ direction: 'connect', url: socketUrl });",
  "    const nativeSend = socket.send.bind(socket);",
  "    socket.send = (data) => {",
  "      record({ direction: 'outbound', url: socketUrl, payload: payload(data) });",
  "      return nativeSend(data);",
  "    };",
  "    socket.addEventListener('message', (event) => record({ direction: 'inbound', url: socketUrl, payload: payload(event.data) }));",
  "    socket.addEventListener('close', () => record({ direction: 'close', url: socketUrl }));",
  "    socket.addEventListener('error', () => record({ direction: 'error', url: socketUrl }));",
  "    return socket;",
  "  }",
  "  SwarmWebSocket.prototype = NativeWebSocket.prototype;",
  "  Object.setPrototypeOf(SwarmWebSocket, NativeWebSocket);",
  "  w.__swarmRealtimeEvents = events;",
  "  w.__swarmRealtimeProbeInstalled = true;",
  "  w.WebSocket = SwarmWebSocket;",
  "  return 'swarm realtime probe installed for sockets created after this point';",
  "})()",
].join("\\n");

const realtimeReadSource = [
  "(() => JSON.stringify({",
  "  installed: Boolean(window.__swarmRealtimeProbeInstalled),",
  "  note: 'Page-level probe captures WebSockets created after realtime-start; empty events may mean no sockets were created after installation or the browser tool cannot expose frames.',",
  "  events: window.__swarmRealtimeEvents || []",
  "}, null, 2))()",
].join("\\n");

function cdpBaseCandidates() {
  const values = [
    process.env.SWARM_CDP_URL,
    process.env.CHROME_REMOTE_DEBUGGING_URL,
    process.env.CHROME_DEBUGGING_URL,
    process.env.SWARM_CDP_PORT ? \`http://127.0.0.1:\${process.env.SWARM_CDP_PORT}\` : undefined,
    process.env.CHROME_REMOTE_DEBUGGING_PORT ? \`http://127.0.0.1:\${process.env.CHROME_REMOTE_DEBUGGING_PORT}\` : undefined,
    process.env.CHROME_DEBUGGING_PORT ? \`http://127.0.0.1:\${process.env.CHROME_DEBUGGING_PORT}\` : undefined,
  ].filter(Boolean);
  return [...new Set(values)];
}

async function discoverCdpTarget() {
  for (const base of cdpBaseCandidates()) {
    try {
      const response = await fetch(\`\${String(base).replace(/\\/$/, "")}/json/list\`);
      if (!response.ok) continue;
      const targets = await response.json();
      const page = Array.isArray(targets) ? targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) : undefined;
      if (page?.webSocketDebuggerUrl) {
        return { base, webSocketDebuggerUrl: page.webSocketDebuggerUrl, title: page.title, url: page.url };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

async function recordCdpRealtime(durationMs) {
  const target = await discoverCdpTarget();
  if (!target) {
    writeFileSync(realtimePath, JSON.stringify({
      captureMethod: "cdp",
      status: "unavailable",
      note: "Set SWARM_CDP_URL or SWARM_CDP_PORT to a Chrome remote debugging endpoint to record native WebSocket frames.",
      events: [],
    }, null, 2) + "\\n");
    console.log(realtimePath);
    return;
  }

  const events = [];
  let id = 0;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out connecting to CDP WebSocket")), 5000);
    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve(undefined);
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("CDP WebSocket connection failed"));
    }, { once: true });
  });
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  ws.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.method === "Network.webSocketFrameSent" || message.method === "Network.webSocketFrameReceived") {
        events.push({
          transport: "websocket",
          direction: message.method.endsWith("Sent") ? "outbound" : "inbound",
          url: target.url || "",
          payload: message.params?.response?.payloadData,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // Ignore non-JSON CDP messages.
    }
  });
  send("Network.enable");
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  ws.close();
  writeFileSync(realtimePath, JSON.stringify({
    captureMethod: "cdp",
    status: "captured",
    target,
    events,
  }, null, 2) + "\\n");
  console.log(realtimePath);
}

switch (command) {
  case "screenshot": {
    const filePath = path.join(screenshotsDir, \`\${Date.now()}-\${slug(args[0])}.png\`);
    runAxi(["screenshot", filePath, ...args.slice(1)]);
    console.log(filePath);
    break;
  }
  case "console":
    runAxi(["console", ...(args.length > 0 ? args : ["--type", "error", "--limit", "50"])], path.join(artifactDir, "console.json"));
    console.log(path.join(artifactDir, "console.json"));
    break;
  case "network":
    runAxi(["network", ...(args.length > 0 ? args : ["--limit", "200"])], path.join(artifactDir, "network.json"));
    console.log(path.join(artifactDir, "network.json"));
    break;
  case "realtime-start":
    runAxi(["eval", realtimeStartSource]);
    console.log("swarm realtime probe installed for future WebSocket connections");
    break;
  case "realtime-save":
    runAxi(["eval", realtimeReadSource], realtimePath);
    console.log(realtimePath);
    break;
  case "realtime-cdp-record":
    await recordCdpRealtime(Number.parseInt(args[0] || "5000", 10));
    break;
  case "lighthouse": {
    const outputDir = path.join(perfDir, \`\${Date.now()}-lighthouse\`);
    mkdirSync(outputDir, { recursive: true });
    runAxi(["lighthouse", "--output-dir", outputDir, ...args]);
    console.log(outputDir);
    break;
  }
  case "perf-start": {
    const filePath = path.join(perfDir, \`\${Date.now()}-trace-start.json\`);
    runAxi(["perf-start", "--file", filePath, ...args]);
    console.log(filePath);
    break;
  }
  case "perf-stop": {
    const filePath = path.join(perfDir, \`\${Date.now()}-trace-stop.json\`);
    runAxi(["perf-stop", "--file", filePath, ...args]);
    console.log(filePath);
    break;
  }
  case "heap": {
    const filePath = path.join(heapDir, \`\${Date.now()}-heap.heapsnapshot\`);
    runAxi(["heap", filePath, ...args]);
    console.log(filePath);
    break;
  }
  case "run":
    runAxi(["run", ...args], undefined, { stdin: true });
    break;
  default:
    if (passthroughCommands.has(command)) {
      runAxi([command, ...args]);
      break;
    }
    console.log(\`error: unknown command "\${command}"\`);
    console.log("help[1]: Run \`node swarm-axi.mjs --help\` for supported commands");
    process.exit(2);
}
`;
  await mkdir(path.dirname(paths.axiHelperPath), { recursive: true });
  await writeFile(paths.axiHelperPath, script, "utf8");
  await chmod(paths.axiHelperPath, 0o755);
}
