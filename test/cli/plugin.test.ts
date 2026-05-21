import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { runCli } from "../helpers/cli.js";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

describe("plugin CLI", () => {
  let harnessdeckHome: string;
  let previousHarnessdeckHome: string | undefined;
  let previousHome: string | undefined;

  beforeEach(() => {
    harnessdeckHome = mkdtempSync(join(tmpdir(), "hd-cli-plugin-"));
    previousHarnessdeckHome = process.env.HARNESSDECK_HOME;
    previousHome = process.env.HOME;
    process.env.HARNESSDECK_HOME = harnessdeckHome;
    process.env.HOME = fixtureHome;
  });

  afterEach(() => {
    if (previousHarnessdeckHome === undefined) {
      delete process.env.HARNESSDECK_HOME;
    } else {
      process.env.HARNESSDECK_HOME = previousHarnessdeckHome;
    }
    if (previousHome === undefined) {
      process.env.HOME = homedir();
    } else {
      process.env.HOME = previousHome;
    }
  });

  it("lists plugins as JSON via provider scan", async () => {
    const result = await runCli([
      "plugin",
      "installed",
      "--platform",
      "claude-code",
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout) as {
      installs: { ref: string }[];
    };
    expect(parsed.installs.some((i) => i.ref === "demo@demo-market")).toBe(true);
  });

  it("check exits with code 1 when outdated", async () => {
    const result = await runCli([
      "plugin",
      "check",
      "--platform",
      "claude-code",
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout) as {
      summary: { outdated: number };
    };
    expect(parsed.summary.outdated).toBeGreaterThan(0);
    expect(result.exitCode).toBe(1);
  });
});
