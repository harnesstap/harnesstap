import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { makeResourceInput } from "../helpers/resources.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

describe("CLI output format", () => {
  it("emits JSON for preset, status, history, platform, init, and apply dry-run commands", async () => {
    const context = await createTestContext("cli-output-format");
    try {
      await runCli(["init"]);
      const platforms = await runCli(["platform", "list", "--format", "json"]);
      expect(JSON.parse(platforms.stdout)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "claude-code" })]),
      );

      const initResult = await runCli(["init", "--format", "json"]);
      expect(JSON.parse(initResult.stdout)).toEqual(
        expect.objectContaining({
          database_path: expect.any(String),
          built_in_presets: expect.anything(),
        }),
      );

      const presetList = await runCli(["preset", "list", "--format", "json"]);
      expect(Array.isArray(JSON.parse(presetList.stdout))).toBe(true);

      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-output.git");
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "dry-run-preset" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "dry-run",
          content: "# Dry run",
        }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const dryRun = await runCli([
        "project",
        "apply",
        "dry-run-preset",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(JSON.parse(dryRun.stdout)).toEqual(
        expect.objectContaining({
          preset: "dry-run-preset",
          project_root: expect.any(String),
          platforms: expect.any(Array),
        }),
      );

      await runCli([
        "project",
        "apply",
        "dry-run-preset",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
      ]);

      const status = await runCli([
        "project",
        "status",
        context.projectDir,
        "--format",
        "json",
      ]);
      expect(JSON.parse(status.stdout)).toEqual(
        expect.objectContaining({
          project_root: expect.any(String),
          git_origin: expect.any(String),
          platforms: expect.any(Array),
        }),
      );

      const history = await runCli([
        "project",
        "history",
        "--project",
        context.projectDir,
        "--format",
        "json",
      ]);
      const historyPayload = JSON.parse(history.stdout);
      expect(Array.isArray(historyPayload)).toBe(true);
      expect(historyPayload[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          label: expect.any(String),
        }),
      );

      const cloudWhoami = await runCli(["cloud", "whoami", "--format", "json"]);
      expect(JSON.parse(cloudWhoami.stdout)).toBeDefined();

      const cloudOrgs = await runCli(["cloud", "orgs", "--format", "json"]);
      expect(Array.isArray(JSON.parse(cloudOrgs.stdout))).toBe(true);

      const cloudProfiles = await import("../../src/config/cloud-profiles.ts");
      await cloudProfiles.saveCloudProfile("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudProfiles.setDefaultCloudProfile("test");

      const originalFetch = (globalThis as { fetch?: typeof fetch }).fetch;
      (globalThis as { fetch?: typeof fetch }).fetch = async (
        input: RequestInfo | URL,
      ) => {
        const url = String(input);
        if (url.startsWith("https://mock/libraries/search")) {
          return {
            ok: true,
            json: async () => [],
          } as Response;
        }
        if (/\/libraries\/.+\/meta$/.test(url)) {
          return {
            ok: true,
            json: async () => ({ latest_version: "1.0" }),
          } as Response;
        }
        if (/\/libraries\/.+\/bundle\/.+$/.test(url)) {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                $schema: "urn:harnessdeck:bundle:v1",
                version: 1,
                preset: { name: "remote-lib" },
                resources: [],
              }),
          } as Response;
        }
        if (url.endsWith("/presets/publish")) {
          return {
            ok: true,
            json: async () => ({
              id: "pub-1",
              version: "1.0.0",
              url: "https://mock/presets/pub-1",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 404,
          text: async () => "not found",
        } as Response;
      };

      try {
        const search = await runCli([
          "preset",
          "search",
          "x",
          "--profile",
          "test",
          "--format",
          "json",
        ]);
        expect(Array.isArray(JSON.parse(search.stdout))).toBe(true);

        const install = await runCli([
          "preset",
          "install",
          "acme/lib@1.0",
          "--as",
          "lib-local",
          "--profile",
          "test",
          "--format",
          "json",
        ]);
        expect(JSON.parse(install.stdout)).toEqual(
          expect.objectContaining({
            preset_name: expect.any(String),
            org_slug: expect.any(String),
            library_slug: expect.any(String),
            version: expect.anything(),
          }),
        );

        const publishPreset = presetModel.createPreset({ name: "pub1" });
        const publishResource = resourceModel.createResource(
          makeResourceInput({ name: "x", content: "#" }),
        );
        presetModel.addResourceToPreset(publishPreset.id, publishResource.id);

        const publish = await runCli([
          "preset",
          "publish",
          "pub1",
          "--profile",
          "test",
          "--format",
          "json",
        ]);
        expect(JSON.parse(publish.stdout)).toBeDefined();
      } finally {
        (globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
      }
    } finally {
      await context.cleanup();
    }
  });

  it("plugin installed and plugin check preserve JSON output after table migration", async () => {
    const harnessdeckHome = mkdtempSync(join(tmpdir(), "hd-of-plugin-"));
    const previousHarnessdeckHome = process.env.HARNESSDECK_HOME;
    const previousHome = process.env.HOME;
    process.env.HARNESSDECK_HOME = harnessdeckHome;
    process.env.HOME = fixtureHome;
    try {
      const installed = await runCli([
        "plugin",
        "installed",
        "--platform",
        "claude-code",
        "--format",
        "json",
      ]);
      const parsedInstalled = JSON.parse(installed.stdout) as {
        installs: { ref: string; platformId: string }[];
      };
      expect(Array.isArray(parsedInstalled.installs)).toBe(true);
      expect(
        parsedInstalled.installs.some((install) => install.ref === "demo@demo-market"),
      ).toBe(true);

      const check = await runCli([
        "plugin",
        "check",
        "--platform",
        "claude-code",
        "--format",
        "json",
      ]);
      const parsedCheck = JSON.parse(check.stdout) as {
        summary: { outdated: number; current: number; unknown: number };
        results: { ref: string; status: string }[];
      };
      expect(typeof parsedCheck.summary.outdated).toBe("number");
      expect(typeof parsedCheck.summary.current).toBe("number");
      expect(Array.isArray(parsedCheck.results)).toBe(true);
    } finally {
      if (previousHarnessdeckHome === undefined) {
        delete process.env.HARNESSDECK_HOME;
      } else {
        process.env.HARNESSDECK_HOME = previousHarnessdeckHome;
      }
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      rmSync(harnessdeckHome, { recursive: true, force: true });
    }
  });
});
