import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { initGitRepo } from "../helpers/git.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI cloud preset workflows", () => {
  it("search, install, publish, apply cloud-installed preset, and conflict handling", async () => {
    const context = await createTestContext("cli-preset-cloud");
    try {
      await runCli(["init"]);

      // configure cloud profile and stub fetch
      const cloudProfiles = await import("../../src/config/cloud-profiles.ts");
      await cloudProfiles.saveCloudProfile("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudProfiles.setDefaultCloudProfile("test");

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        // token refresh (safety)
        if (url.endsWith("/oauth/token") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ access_token: "tok", refresh_token: "r", expires_in: 3600 }),
          };
        }
        if (url.startsWith("https://mock/libraries/search")) {
          return {
            ok: true,
            json: async () => ([{ id: "acme/team", org_slug: "acme", library_slug: "team", name: "team" }]),
          };
        }
        if (/\/libraries\/.+\/meta$/.test(url)) {
          return { ok: true, json: async () => ({ latest_version: "1.0" }) };
        }
        if (/\/libraries\/.+\/bundle\/.+$/.test(url)) {
          const bundle = JSON.stringify({
            $schema: "urn:harnessdeck:bundle:v1",
            version: 1,
            preset: { name: "remote-team", description: "from cloud", tags: [] },
            resources: [{ type: "instruction", name: "r", description: "", content: "#x", metadata: {} }],
          });
          return { ok: true, text: async () => bundle };
        }
        if (url.endsWith("/presets/publish")) {
          return { ok: true, json: async () => ({ id: "pub-1", version: "1.2.3", url: "https://mock/presets/pub-1" }) };
        }
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      // preset search should emit JSON when requested and return remote results
      const search = await runCli(["preset", "search", "team", "--profile", "test", "--format", "json"]);
      const searchJson = JSON.parse(search.stdout);
      expect(Array.isArray(searchJson)).toBe(true);
      expect(searchJson[0]).toEqual(expect.objectContaining({ org_slug: "acme", library_slug: "team" }));

      // install from a remote selector; use --as to pick local name
      const install = await runCli([
        "preset",
        "install",
        "acme/team@1.0",
        "--as",
        "team-cloud",
        "--profile",
        "test",
        "--format",
        "json",
      ]);
      const installPayload = JSON.parse(install.stdout);
      expect(installPayload).toEqual(
        expect.objectContaining({
          preset_name: "team-cloud",
          org_slug: "acme",
          library_slug: "team",
          version: "1.0",
        }),
      );

      // publish should return JSON when requested
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "pubtest" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "r", content: "#x" }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const publish = await runCli(["preset", "publish", "pubtest", "--profile", "test", "--format", "json"]);
      expect(JSON.parse(publish.stdout)).toEqual(expect.objectContaining({ id: "pub-1", version: "1.2.3", url: expect.any(String) }));

      // applying a cloud-installed preset through project apply
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-cloud.git");
      const dryRun = await runCli([
        "project",
        "apply",
        "team-cloud",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(JSON.parse(dryRun.stdout)).toEqual(
        expect.objectContaining({ preset: "team-cloud" }),
      );

      // install conflict when local preset name exists and --as missing
      const _conflictPreset = presetModel.createPreset({ name: "conflict" });
      const conflict = await runCli(["preset", "install", "org/conflict@1.0"]);
      expect(conflict.stderr).toContain("Preset name already exists");

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("rejects malformed remote library selectors before contacting the cloud", async () => {
    const context = await createTestContext("cli-preset-cloud-selector");
    try {
      await runCli(["init"]);

      const result = await runCli(["preset", "install", "missing-slash"]);

      expect(result.stderr).toContain(
        "Invalid library selector: missing-slash. Use org/library[@version]",
      );
    } finally {
      await context.cleanup();
    }
  });
});
