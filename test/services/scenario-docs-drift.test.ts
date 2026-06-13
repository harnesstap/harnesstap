import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const repoRoot = resolve(import.meta.dirname, "../..");

describe("scenario docs drift check", () => {
  it("rejects stale CLI command names in scenario detail pages", () => {
    const result = spawnSync("bash", ["scripts/check-scenario-docs.sh"], {
      cwd: repoRoot,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Scenario docs drift check passed.");
  });
});
