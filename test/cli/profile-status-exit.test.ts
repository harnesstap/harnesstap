import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const BIN = join(import.meta.dir, "..", "..", "src", "bin.ts");

describe("ht profile status", () => {
  it("exits after printing instead of waiting on the status refresh worker", async () => {
    const home = mkdtempSync(join(tmpdir(), "ht-status-exit-"));
    try {
      const child = Bun.spawn([process.execPath, BIN, "--no-interactive", "profile", "status", "--format", "json"], {
        env: { ...process.env, HOME: home, USERPROFILE: home, HARNESSTAP_HOME: join(home, ".harnesstap"), DO_NOT_TRACK: "1" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const timer = setTimeout(() => child.kill(), 15_000);
      const code = await child.exited;
      clearTimeout(timer);
      const stdout = await new Response(child.stdout).text();
      expect(child.signalCode).toBeNull();
      expect(code).toBe(0);
      expect(JSON.parse(stdout).active_profile).toBeDefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});
