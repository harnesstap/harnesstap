import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { gitCommandEnv } from "../../src/utils/spawn-command.ts";

describe("resource detail while git refresh hangs", () => {
  it("keeps detail fast and logs request timing while clone sleeps", async () => {
    const worker = join(import.meta.dirname, "resource-detail-git-hang.worker.ts");
    const bun = process.execPath;
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(bun, [worker], {
          cwd: join(import.meta.dirname, "../.."),
          env: process.env,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
          resolve({ code: code ?? 1, stdout, stderr });
        });
      },
    );
    expect(result.code, result.stderr || result.stdout).toBe(0);
    const match = result.stdout.match(/ensureMs=([0-9.]+) detailMs=([0-9.]+)/);
    expect(match).not.toBeNull();
    const ensureMs = Number(match?.[1]);
    const detailMs = Number(match?.[2]);
    expect(ensureMs).toBeLessThan(500);
    expect(detailMs).toBeLessThan(500);
  });
});

describe("unattended git environment", () => {
  it("sets a non-interactive ssh connect timeout", () => {
    const env = gitCommandEnv({ unattended: true });
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GCM_INTERACTIVE).toBe("never");
    expect(env.GIT_SSH_COMMAND).toContain("ConnectTimeout=15");
    expect(env.GIT_SSH_COMMAND).toContain("BatchMode=yes");
  });
});
