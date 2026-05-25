import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { runCli } from "../helpers/cli.ts";

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

  it(
    "renders plugin check as a shared table with STATUS, VERSION and SCOPE columns",
    async () => {
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
    },
    15000,
  );

  it(
    "check exits with code 1 when outdated",
    async () => {
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
    },
    15000,
  );

  it(
    "renders plugin check --refresh as verdict output instead of table",
    async () => {
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
      // Verdict text must contain the summary counts (may be in stderr via spinner)
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/current/);
      expect(combined).toMatch(/outdated/);
      // Should still detect the outdated plugin and exit 1
      expect(result.exitCode).toBe(1);
    },
    15000,
  );

  it(
    "check --refresh --format json returns full report (no table mode change)",
    async () => {
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
    },
    15000,
  );

  // ── plugin refresh ───────────────────────────────────────────────────

  it(
    "refresh renders a Refreshed verdict in human mode",
    async () => {
      const result = await runCli([
        "plugin",
        "refresh",
        "--platform",
        "claude-code",
      ]);
      // Must show a verdict line — no table headers
      expect(result.stdout).not.toContain("STATUS");
      // Verdict text: "✔ Refreshed N source(s)" — may be in stderr via ora spinner
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/Refreshed \d+ sources?/);
    },
    15000,
  );

  it(
    "refresh --format json returns refreshed_sources array",
    async () => {
      const result = await runCli([
        "plugin",
        "refresh",
        "--platform",
        "claude-code",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout) as { refreshed_sources: string[] };
      expect(Array.isArray(parsed.refreshed_sources)).toBe(true);
    },
    15000,
  );

  // ── plugin update ────────────────────────────────────────────────────

  it("update renders a success verdict and detail rows in human mode", async () => {
    const lifecycle = await import("../../src/services/plugin-lifecycle.ts");
    const spy = spyOn(lifecycle, "updatePlugins")
      .mockResolvedValue({
        results: [
          {
            ref: "demo@demo-market",
            platformId: "claude-code",
            scope: "user",
            status: "updated",
            message: "Updated to 2.0.0",
            previousVersion: "1.0.0",
          },
        ],
        summary: { updated: 1, skipped: 0, failed: 0, unsupported: 0 },
      });
    try {
      const result = await runCli([
        "plugin",
        "update",
        "--platform",
        "claude-code",
        "--all",
      ]);
      // Aggregate success verdict (may be in stderr via ora spinner)
      const combined = result.stdout + result.stderr;
      expect(combined).toContain("1 plugin updated");
      // Detail row indented under the verdict — always in stdout via console.log
      expect(result.stdout).toContain("demo@demo-market");
      expect(result.stdout).toContain("updated");
      // Old bare-line format ("ref: status — msg" as primary output) must be gone
      expect(result.stdout).not.toMatch(/^demo@demo-market:/m);
    } finally {
      spy.mockRestore();
    }
  });

  it("update renders a failure verdict when plugins fail", async () => {
    const lifecycle = await import("../../src/services/plugin-lifecycle.ts");
    const spy = spyOn(lifecycle, "updatePlugins")
      .mockResolvedValue({
        results: [
          {
            ref: "demo@demo-market",
            platformId: "claude-code",
            scope: "user",
            status: "failed",
            message: "claude not found",
          },
        ],
        summary: { updated: 0, skipped: 0, failed: 1, unsupported: 0 },
      });
    try {
      const result = await runCli([
        "plugin",
        "update",
        "--platform",
        "claude-code",
        "--all",
      ]);
      // Failure verdict goes to stderr via spin.fail
      const combined = result.stdout + result.stderr;
      expect(combined).toContain("failed");
      expect(combined).toContain("demo@demo-market");
      expect(result.exitCode).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("update reports nothing to update when results are empty", async () => {
    const lifecycle = await import("../../src/services/plugin-lifecycle.ts");
    const spy = spyOn(lifecycle, "updatePlugins")
      .mockResolvedValue({
        results: [],
        summary: { updated: 0, skipped: 0, failed: 0, unsupported: 0 },
      });
    try {
      const result = await runCli([
        "plugin",
        "update",
        "--platform",
        "claude-code",
        "--all",
      ]);
      expect(result.stdout + result.stderr).toContain("No plugins to update");
    } finally {
      spy.mockRestore();
    }
  });

  it("update --format json returns raw report without verdict rendering", async () => {
    const lifecycle = await import("../../src/services/plugin-lifecycle.ts");
    const spy = spyOn(lifecycle, "updatePlugins")
      .mockResolvedValue({
        results: [
          {
            ref: "demo@demo-market",
            platformId: "claude-code",
            scope: "user",
            status: "updated",
            message: "ok",
          },
        ],
        summary: { updated: 1, skipped: 0, failed: 0, unsupported: 0 },
      });
    try {
      const result = await runCli([
        "plugin",
        "update",
        "--platform",
        "claude-code",
        "--all",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout) as {
        results: unknown[];
        summary: { updated: number };
      };
      expect(parsed.summary.updated).toBe(1);
      expect(Array.isArray(parsed.results)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
