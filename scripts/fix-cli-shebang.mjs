import { chmod, readFile, writeFile } from "node:fs/promises";

const cliPath = new URL("../dist/cli.js", import.meta.url);
const text = await readFile(cliPath, "utf8");
if (!text.startsWith("#!/usr/bin/env node\n")) {
  await writeFile(cliPath, `#!/usr/bin/env node\n${text}`);
}
await chmod(cliPath, 0o755);
