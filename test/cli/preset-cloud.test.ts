import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { initGitRepo } from "../helpers/git.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI cloud preset workflows", () => {
  it("search, add (remote install), publish, apply cloud-installed preset, and conflict handling", async () => {
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

      // add (remote install) from a remote selector; use --as to pick local name
      const add = await runCli([
        "preset",
        "add",
        "acme/team@1.0",
        "--as",
        "team-cloud",
        "--profile",
        "test",
        "--format",
        "json",
      ]);
      const addPayload = JSON.parse(add.stdout);
      expect(addPayload).toEqual(
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

      // Mock /orgs endpoint for auto-select
      const oldFetch = globalThis.fetch;
      globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/oauth/token") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ access_token: "tok", refresh_token: "r", expires_in: 3600 }),
          };
        }
        if (url.endsWith("/orgs")) {
          return {
            ok: true,
            json: async () => ([{ slug: "acme", name: "Acme Corp" }]),
          };
        }
        if (url.endsWith("/presets/publish")) {
          return { ok: true, json: async () => ({ id: "pub-1", version: "1.2.3", url: "https://mock/presets/pub-1" }) };
        }
        return oldFetch(input, init);
      }) as typeof fetch;

      const publish = await runCli(["preset", "publish", "pubtest", "--profile", "test", "--format", "json"]);
      expect(JSON.parse(publish.stdout)).toEqual(expect.objectContaining({ id: "pub-1", version: "1.2.3", url: expect.any(String) }));

      globalThis.fetch = oldFetch;

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

      // add conflict when local preset name exists and --as missing
      const _conflictPreset = presetModel.createPreset({ name: "conflict" });
      const conflict = await runCli(["preset", "add", "org/conflict@1.0"]);
      expect(conflict.stderr).toContain("Preset name already exists");

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("preset install (deprecated) warns and forwards to preset add", async () => {
    const context = await createTestContext("cli-preset-install-deprecated");
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
        if (url.endsWith("/oauth/token") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ access_token: "tok", refresh_token: "r", expires_in: 3600 }),
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
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      const install = await runCli([
        "preset",
        "install",
        "acme/legacy@1.0",
        "--as",
        "legacy-installed",
        "--profile",
        "test",
      ]);

      expect(install.stdout).toContain("`preset install` is deprecated; use `preset add` instead.");
      expect(install.stdout).toContain("Installed preset");

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("preset add accepts --org and --version helpers to complete partial selectors", async () => {
    const context = await createTestContext("cli-preset-add-helpers");
    try {
      await runCli(["init"]);

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
        if (url.endsWith("/oauth/token") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ access_token: "tok", refresh_token: "r", expires_in: 3600 }),
          };
        }
        if (/\/libraries\/.+\/meta$/.test(url)) {
          // Return different latest versions for different libraries
          if (url.includes("other-org/other-lib")) {
            return { ok: true, json: async () => ({ latest_version: "1.5.0" }) };
          }
          if (url.includes("team/combined-lib")) {
            return { ok: true, json: async () => ({ latest_version: "2.1.0" }) };
          }
          return { ok: true, json: async () => ({ latest_version: "2.5.1" }) };
        }
        if (/\/libraries\/.+\/bundle\/.+$/.test(url)) {
          const bundle = JSON.stringify({
            $schema: "urn:harnessdeck:bundle:v1",
            version: 1,
            preset: { name: "remote-lib", description: "from cloud", tags: [] },
            resources: [{ type: "instruction", name: "r", description: "", content: "#x", metadata: {} }],
          });
          return { ok: true, text: async () => bundle };
        }
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      // Test --org helper fills missing org
      const withOrg = await runCli([
        "preset",
        "add",
        "my-library",
        "--org",
        "acme",
        "--as",
        "installed-with-org",
        "--profile",
        "test",
        "--format",
        "json",
      ]);
      const withOrgPayload = JSON.parse(withOrg.stdout);
      expect(withOrgPayload).toEqual(
        expect.objectContaining({
          org_slug: "acme",
          library_slug: "my-library",
          version: "2.5.1",
        }),
      );

      // Test --version helper fills missing version
      const withVersion = await runCli([
        "preset",
        "add",
        "other-org/other-lib",
        "--version",
        "^1.0.0",
        "--as",
        "installed-with-version",
        "--profile",
        "test",
        "--format",
        "json",
      ]);
      
      if (withVersion.exitCode !== 0 && withVersion.exitCode !== undefined) {
        throw new Error(`withVersion command failed: exitCode=${withVersion.exitCode}, stderr=${withVersion.stderr}, stdout=${withVersion.stdout}`);
      }
      
      if (!withVersion.stdout || withVersion.stdout.trim() === "") {
        throw new Error(`withVersion returned empty stdout. stderr: ${withVersion.stderr}`);
      }
      
      const withVersionPayload = JSON.parse(withVersion.stdout);
      expect(withVersionPayload).toEqual(
        expect.objectContaining({
          org_slug: "other-org",
          library_slug: "other-lib",
          version: "^1.0.0", // version passed as-is to cloud
        }),
      );

      // Test both helpers together
      const withBoth = await runCli([
        "preset",
        "add",
        "combined-lib",
        "--org",
        "team",
        "--version",
        "~2.0.0",
        "--as",
        "installed-with-both",
        "--profile",
        "test",
        "--format",
        "json",
      ]);
      
      if (withBoth.exitCode !== 0 && withBoth.exitCode !== undefined) {
        throw new Error(`withBoth command failed: ${withBoth.stderr}`);
      }
      
      if (!withBoth.stdout || withBoth.stdout.trim() === "") {
        throw new Error(`withBoth returned empty stdout. stderr: ${withBoth.stderr}`);
      }
      
      const withBothPayload = JSON.parse(withBoth.stdout);
      expect(withBothPayload).toEqual(
        expect.objectContaining({
          org_slug: "team",
          library_slug: "combined-lib",
          version: "~2.0.0", // version passed as-is to cloud
        }),
      );

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("preset add rejects --org when org is already in selector", async () => {
    const context = await createTestContext("cli-preset-add-org-conflict");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "preset",
        "add",
        "acme/library",
        "--org",
        "other-org",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--org conflicts with org in selector");
    } finally {
      await context.cleanup();
    }
  });

  it("preset add rejects --version when version is already in selector", async () => {
    const context = await createTestContext("cli-preset-add-version-conflict");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "preset",
        "add",
        "acme/library@1.0.0",
        "--version",
        "^2.0.0",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--version conflicts with version in selector");
    } finally {
      await context.cleanup();
    }
  });

  it("preset add requires org from selector or --org", async () => {
    const context = await createTestContext("cli-preset-add-missing-org");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "preset",
        "add",
        "library-name",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("org is required");
      expect(result.stderr).toContain("--org");
    } finally {
      await context.cleanup();
    }
  });

  // ── Task 4: Interactive remote preset search ──────────────────────────────

  it("preset add with no selector on TTY launches interactive remote search", async () => {
    const context = await createTestContext("cli-preset-add-interactive-search");
    try {
      await runCli(["init"]);

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
        if (url.endsWith("/oauth/token") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ access_token: "tok", refresh_token: "r", expires_in: 3600 }),
          };
        }
        if (url.startsWith("https://mock/libraries/search")) {
          return {
            ok: true,
            json: async () => ([
              { id: "acme/team", org_slug: "acme", library_slug: "team", name: "Team Preset" },
              { id: "acme/dev", org_slug: "acme", library_slug: "dev", name: "Dev Preset" },
            ]),
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
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      // Simulate TTY environment with interactive search choice
      const result = await runCli(
        ["preset", "add", "--profile", "test"],
        { 
          isTTY: true,
          promptResponses: [{ choice: "acme/team" }]
        }
      );

      expect(result.stdout).toContain("Installed preset");
      expect(result.stdout).toContain("team");

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("preset add with no selector on non-TTY fails with clear error", async () => {
    const context = await createTestContext("cli-preset-add-no-selector-non-tty");
    try {
      await runCli(["init"]);

      const cloudProfiles = await import("../../src/config/cloud-profiles.ts");
      await cloudProfiles.saveCloudProfile("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudProfiles.setDefaultCloudProfile("test");

      // Non-TTY environment
      const result = await runCli(
        ["preset", "add", "--profile", "test"],
        { isTTY: false }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("selector is required");
    } finally {
      await context.cleanup();
    }
  });

  // ── Task 4: Publish org resolution ─────────────────────────────────────────

  it("preset publish with no --org auto-selects when user has exactly one org", async () => {
    const context = await createTestContext("cli-preset-publish-one-org");
    try {
      await runCli(["init"]);

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
        if (url.endsWith("/oauth/token") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ access_token: "tok", refresh_token: "r", expires_in: 3600 }),
          };
        }
        if (url.endsWith("/orgs")) {
          return {
            ok: true,
            json: async () => ([{ slug: "acme", name: "Acme Corp" }]),
          };
        }
        if (url.endsWith("/presets/publish")) {
          return { ok: true, json: async () => ({ id: "pub-1", version: "1.0.0", url: "https://mock/presets/pub-1" }) };
        }
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      const presetModel = await import("../../src/models/preset.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "my-preset" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        })
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const result = await runCli(["preset", "publish", "my-preset", "--profile", "test", "--format", "json"]);

      expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
      const payload = JSON.parse(result.stdout);
      expect(payload).toEqual(expect.objectContaining({ id: "pub-1", version: "1.0.0" }));

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("preset publish with no --org prompts when user has multiple orgs", async () => {
    const context = await createTestContext("cli-preset-publish-multi-org");
    try {
      await runCli(["init"]);

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
        if (url.endsWith("/oauth/token") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ access_token: "tok", refresh_token: "r", expires_in: 3600 }),
          };
        }
        if (url.endsWith("/orgs")) {
          return {
            ok: true,
            json: async () => ([
              { slug: "acme", name: "Acme Corp" },
              { slug: "widgets", name: "Widgets Inc" },
            ]),
          };
        }
        if (url.endsWith("/presets/publish")) {
          return { ok: true, json: async () => ({ id: "pub-2", version: "1.0.0", url: "https://mock/presets/pub-2" }) };
        }
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      const presetModel = await import("../../src/models/preset.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "multi-org-preset" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        })
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const result = await runCli(
        ["preset", "publish", "multi-org-preset", "--profile", "test"],
        {
          isTTY: true,
          promptResponses: [{ value: "widgets" }]
        }
      );

      if (result.stderr) {
        throw new Error(`Command failed with stderr: ${result.stderr}`);
      }
      expect(result.stdout).toContain("Published preset");

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("preset publish with no --org errors when user has zero orgs", async () => {
    const context = await createTestContext("cli-preset-publish-zero-org");
    try {
      await runCli(["init"]);

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
        if (url.endsWith("/oauth/token") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ access_token: "tok", refresh_token: "r", expires_in: 3600 }),
          };
        }
        if (url.endsWith("/orgs")) {
          return { ok: true, json: async () => ([]) };
        }
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      const presetModel = await import("../../src/models/preset.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "zero-org-preset" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        })
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const result = await runCli(["preset", "publish", "zero-org-preset", "--profile", "test"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No organizations found");

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("preset publish detects existing library slug and errors clearly", async () => {
    const context = await createTestContext("cli-preset-publish-slug-exists");
    try {
      await runCli(["init"]);

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
        if (url.endsWith("/oauth/token") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ access_token: "tok", refresh_token: "r", expires_in: 3600 }),
          };
        }
        if (url.endsWith("/orgs")) {
          return {
            ok: true,
            json: async () => ([{ slug: "acme", name: "Acme Corp" }]),
          };
        }
        if (url.endsWith("/presets/publish")) {
          return { 
            ok: false, 
            status: 409,
            text: async () => "Library slug already exists"
          };
        }
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      const presetModel = await import("../../src/models/preset.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "existing-slug" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        })
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const result = await runCli(["preset", "publish", "existing-slug", "--profile", "test"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("already exists");

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  // ── Task 4: from-project conflict resolution ──────────────────────────────

  it("preset from-project errors when preset exists without interactive mode", async () => {
    const context = await createTestContext("cli-preset-from-project-exists");
    try {
      await runCli(["init"]);

      // Create an existing preset
      const presetModel = await import("../../src/models/preset.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingPreset = presetModel.createPreset({ name: "existing" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "res",
          description: "original",
          content: "#original",
        })
      );
      presetModel.addResourceToPreset(existingPreset.id, existingResource.id);

      // Create a project directory
      const { mkdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-project");
      mkdirSync(projectDir, { recursive: true });

      // Try to create preset with same name in non-interactive mode
      const result = await runCli(
        ["preset", "from-project", "existing", "--project", projectDir],
        { isTTY: false }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("already exists");
    } finally {
      await context.cleanup();
    }
  });
});
