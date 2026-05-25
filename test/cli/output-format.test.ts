import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

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

      // cloud whoami/orgs should also support JSON output (may be empty when not configured)
      const cloudWhoami = await runCli(["cloud", "whoami", "--format", "json"]);
      expect(JSON.parse(cloudWhoami.stdout)).toBeDefined();
      const cloudOrgs = await runCli(["cloud", "orgs", "--format", "json"]);
      expect(Array.isArray(JSON.parse(cloudOrgs.stdout))).toBe(true);

      // preset cloud commands should support JSON output
      const s = await runCli(["preset", "search", "x", "--profile", "test", "--format", "json"]);
      expect(Array.isArray(JSON.parse(s.stdout))).toBe(true);

      // configure cloud profile and stub fetch for install/publish
      const cloudProfiles = await import("../../src/config/cloud-profiles.ts");
      await cloudProfiles.saveCloudProfile("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudProfiles.setDefaultCloudProfile("test");
      const originalFetch = (globalThis as any).fetch;
      (globalThis as any).fetch = async (input: any, init?: any) => {
        const url = String(input);
        if (url.startsWith("https://mock/libraries/search")) return { ok: true, json: async () => [] };
        if (/\/libraries\/.+\/meta$/.test(url)) return { ok: true, json: async () => ({ latest_version: "1.0" }) };
        if (/\/libraries\/.+\/bundle\/.+$/.test(url)) return { ok: true, text: async () => JSON.stringify({ $schema: "urn:harnessdeck:bundle:v1", version: 1, preset: { name: "remote-lib" }, resources: [] }) };
        if (url.endsWith("/presets/publish")) return { ok: true, json: async () => ({ id: "pub-1", version: "1.0.0", url: "https://mock/presets/pub-1" }) };
        return { ok: false, status: 404, text: async () => "not found" };
      };

      const i = await runCli(["preset", "install", "acme/lib@1.0", "--as", "lib-local", "--profile", "test", "--format", "json"]);
      expect(JSON.parse(i.stdout)).toEqual(expect.objectContaining({ preset_name: expect.any(String), org_slug: expect.any(String), library_slug: expect.any(String), version: expect.anything() }));

      // publish
      const presetModel2 = await import("../../src/models/preset.ts");
      const rModel = await import("../../src/models/resource.ts");
      const p = presetModel2.createPreset({ name: "pub1" });
      const r = rModel.createResource(makeResourceInput({ name: "x", content: "#" }));
      presetModel2.addResourceToPreset(p.id, r.id);
      const pub = await runCli(["preset", "publish", "pub1", "--profile", "test", "--format", "json"]);
      expect(JSON.parse(pub.stdout)).toBeDefined();
      // restore fetch
      (globalThis as any).fetch = originalFetch;
        } finally {
          await context.cleanup();
        }
      });
});
