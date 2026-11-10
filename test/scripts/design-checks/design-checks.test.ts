import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

describe("design system check fixtures", () => {
  it("passes the design-checks fixture suite", () => {
    const result = spawnSync("bash", [join(import.meta.dir, "run.sh")], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(
        `design-checks run.sh failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`,
      );
    }
    expect(result.stdout).toContain("passed, 0 failed");
  });
});
