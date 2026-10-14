import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const DRIFT = join(import.meta.dir, "..", "..", "src", "services", "global-profile-drift.ts");
const SCRIPT = `const { loadGlobalProfileStatusSnapshot } = await import(${JSON.stringify(DRIFT)});
await loadGlobalProfileStatusSnapshot({ depth: "full" });`;

async function runStatus(debug: boolean): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "ht-status-trace-"));
  try {
    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HARNESSTAP_HOME: join(home, ".harnesstap"),
      DO_NOT_TRACK: "1",
    };
    if (debug) env.HARNESSTAP_STATUS_CACHE_DEBUG = "1";
    else delete env.HARNESSTAP_STATUS_CACHE_DEBUG;
    const child = Bun.spawn([process.execPath, "-e", SCRIPT], { env, stdout: "pipe", stderr: "pipe" });
    const stderr = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    return stderr;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("status trace", () => {
  it("prints one line per phase when HARNESSTAP_STATUS_CACHE_DEBUG=1", async () => {
    const stderr = await runStatus(true);
    const lines = stderr.split("\n").filter((line) => line.startsWith("[status-trace] "));
    expect(lines.some((line) => /^\[status-trace\] run=1 phase=total ms=\d+\.\d label=depth=full/.test(line))).toBe(true);
    expect(lines.some((line) => / phase=drift-core ms=\d+\.\d n=1 self=/.test(line))).toBe(true);
    expect(lines.some((line) => / phase=finalize ms=/.test(line))).toBe(true);
  }, 30_000);

  it("prints nothing when the flag is off", async () => {
    const stderr = await runStatus(false);
    expect(stderr).not.toContain("[status-trace]");
  }, 30_000);
});
