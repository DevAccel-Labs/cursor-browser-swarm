import { execa, type ResultPromise } from "execa";

export interface OwnedDevServer {
  process: ResultPromise;
  stop: () => Promise<void>;
}

export async function spawnLocalDevServer(command: string, cwd: string): Promise<OwnedDevServer> {
  const child = execa(command, {
    cwd,
    shell: true,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      FORCE_COLOR: "1",
    },
  });

  const stop = async (): Promise<void> => {
    if (child.killed || child.exitCode !== undefined) {
      return;
    }
    child.kill("SIGTERM");
    try {
      await child;
    } catch {
      // Dev server shutdown can reject when terminated.
    }
  };

  return { process: child, stop };
}
