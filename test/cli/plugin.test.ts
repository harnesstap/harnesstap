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

  it("renders plugin installed list as a shared table", async () => {
    const result = await runCli([
      "plugin",
      "installed",
      "--platform",
      "claude-code",
    ]);
    expect(result.stdout).toContain("PLATFORM");
    expect(result.stdout).toContain("REF");
    expect(result.stdout).toContain("VERSION");
    expect(result.stdout).toContain("SCOPE");
  });

  it("renders plugin check as a shared table with STATUS, VERSION and SCOPE columns", async () => {
    const result = await runCli([
      "plugin",
      "check",
      "--platform",
      "claude-code",
    ]);
    expect(result.stdout).toContain("STATUS");
    expect(result.stdout).toContain("PLATFORM");
    expect(result.stdout).toContain("REF");
    expect(result.stdout).toContain("VERSION");
    expect(result.stdout).toContain("LATEST");
    expect(result.stdout).toContain("SCOPE");
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

  it("renders plugin check --refresh as verdict output instead of table", async () => {
    const result = await runCli([
      "plugin",
      "check",
      "--platform",
      "claude-code",
      "--refresh",
    ]);
    // Progress/verdict mode: table headers must not appear
    expect(result.stdout).not.toContain("STATUS");
    expect(result.stdout).not.toContain("PLATFORM");
    // Should still detect the outdated plugin and exit 1
    expect(result.exitCode).toBe(1);
  });

  it("check --refresh --format json returns full report (no table mode change)", async () => {
    const result = await runCli([
      "plugin",
      "check",
      "--platform",
      "claude-code",
      "--refresh",
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout) as {
      summary: { outdated: number };
      refreshed_sources: string[];
    };
    expect(typeof parsed.summary.outdated).toBe("number");
    expect(Array.isArray(parsed.refreshed_sources)).toBe(true);
  });
});
