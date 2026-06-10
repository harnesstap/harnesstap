import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { initGitRepo } from "../helpers/git.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI cloud layer workflows", () => {
  it("search, add (remote install), publish, apply cloud-installed layer, and conflict handling", async () => {
    const context = await createTestContext("cli-layer-cloud");
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

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        libraries: [{
          orgSlug: "harnessdeck-cloud",
          slug: "team",
          name: "Team Layer",
          summary: "Team layer",
          latestVersion: "1.0.0",
          updatedAt: new Date().toISOString(),
          tags: [],
          visibility: "public",
        }],
      });

      // layer search should emit JSON when requested and return remote results
      const search = await runCli([
        "layer",
        "search",
        "team",
        "--profile",
        "test",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);
      const searchJson = JSON.parse(search.stdout);
      expect(Array.isArray(searchJson)).toBe(true);
      expect(searchJson[0]).toEqual(expect.objectContaining({
        orgSlug: "harnessdeck-cloud",
        catalogSlug: "default",
        slug: "team",
      }));

      // add (remote install) from a remote selector; use --as to pick local name
      const add = await runCli([
        "layer",
        "add",
        "harnessdeck-cloud/team@1.0",
        "--as",
        "team-cloud",
        "--profile",
        "test",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);
      const addPayload = JSON.parse(add.stdout);
      expect(addPayload).toEqual(
        expect.objectContaining({
          layer_name: "team-cloud",
          org_slug: "harnessdeck-cloud",
          catalog_slug: "default",
          library_slug: "team",
          version: "1.0",
        }),
      );

      // publish should return JSON when requested
      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "pubtest" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "r", content: "#x" }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

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
        if (url.endsWith("/layers/publish")) {
          return { ok: true, json: async () => ({ id: "pub-1", version: "1.2.3", url: "https://mock/layers/pub-1" }) };
        }
        return oldFetch(input, init);
      }) as typeof fetch;

      const publish = await runCli(["layer", "publish", "pubtest", "--profile", "test", "--format", "json"]);
      expect(JSON.parse(publish.stdout)).toEqual(expect.objectContaining({ id: "pub-1", version: "1.2.3", url: expect.any(String) }));

      globalThis.fetch = oldFetch;

      // applying a cloud-installed layer through project apply
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
        expect.objectContaining({ layer: "team-cloud" }),
      );

      // add conflict when local layer name exists and --as missing
      const _conflictLayer = layerModel.createLayer({ name: "conflict" });
      const conflict = await runCli(["layer", "add", "org/conflict@1.0"]);
      expect(conflict.stderr).toContain("Layer name already exists");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("project apply fetches a published selector when the layer is not installed locally", async () => {
    const context = await createTestContext("cli-project-apply-remote-fetch");
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

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        libraries: [{
          orgSlug: "harnessdeck-cloud",
          slug: "team",
          name: "Team Layer",
          summary: "Team layer",
          latestVersion: "1.0.0",
          updatedAt: new Date().toISOString(),
          tags: [],
          visibility: "public",
        }],
      });

      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-cloud.git");

      const humanRun = await runCli([
        "project",
        "apply",
        "harnessdeck-cloud/team@1.0",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--dry-run",
      ]);
      expect(humanRun.stdout).toContain("Fetched harnessdeck-cloud/team@1.0 from catalog");

      const dryRun = await runCli([
        "project",
        "apply",
        "harnessdeck-cloud/team@1.0",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(dryRun.exitCode).toBeUndefined();
      const dryRunPayload = JSON.parse(dryRun.stdout);
      expect(dryRunPayload).toEqual(
        expect.objectContaining({
          layer: "remote-team",
          layers: ["harnessdeck-cloud/team@1.0"],
        }),
      );

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("layer add accepts --org and --version helpers to complete partial selectors", async () => {
    const context = await createTestContext("cli-layer-add-helpers");
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

      const restoreFetch = createCatalogFetchMock({ baseUrl: "https://mock" });

      // Test --org helper fills missing org
      const withOrg = await runCli([
        "layer",
        "add",
        "my-library",
        "--org",
        "harnessdeck-cloud",
        "--as",
        "installed-with-org",
        "--profile",
        "test",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);
      const withOrgPayload = JSON.parse(withOrg.stdout);
      expect(withOrgPayload).toEqual(
        expect.objectContaining({
          org_slug: "harnessdeck-cloud",
          library_slug: "my-library",
          version: "latest",
        }),
      );

      // Test --version helper fills missing version
      await runCli([
        "layer",
        "catalog",
        "connect",
        "org",
        "other-org",
        "--base-url",
        "https://mock",
      ]);

      const withVersion = await runCli([
        "layer",
        "add",
        "other-org/other-lib",
        "--version",
        "^1.0.0",
        "--as",
        "installed-with-version",
        "--profile",
        "test",
        "--base-url",
        "https://mock",
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
        "layer",
        "add",
        "combined-lib",
        "--org",
        "harnessdeck-cloud",
        "--version",
        "~2.0.0",
        "--as",
        "installed-with-both",
        "--profile",
        "test",
        "--base-url",
        "https://mock",
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
          org_slug: "harnessdeck-cloud",
          library_slug: "combined-lib",
          version: "~2.0.0", // version passed as-is to cloud
        }),
      );

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("layer add rejects --org when org is already in selector", async () => {
    const context = await createTestContext("cli-layer-add-org-conflict");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "layer",
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

  it("layer add rejects --version when version is already in selector", async () => {
    const context = await createTestContext("cli-layer-add-version-conflict");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "layer",
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

  it("layer add requires org from selector or --org", async () => {
    const context = await createTestContext("cli-layer-add-missing-org");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "layer",
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

  it("rejects malformed remote library selectors before contacting the cloud", async () => {
    const context = await createTestContext("cli-layer-cloud-selector");
    try {
      await runCli(["init"]);

      const result = await runCli(["layer", "add", "@broken"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid library selector");
    } finally {
      await context.cleanup();
    }
  });

  // ── Task 4: Interactive remote layer search ──────────────────────────────

  it("layer add with no selector on TTY launches interactive remote search", async () => {
    const context = await createTestContext("cli-layer-add-interactive-search");
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

      const restoreFetch = createCatalogFetchMock({ baseUrl: "https://mock" });

      const result = await runCli(
        ["layer", "add", "--profile", "test", "--base-url", "https://mock"],
        {
          isTTY: true,
          promptResponses: [{ choice: "harnessdeck-cloud/team" }],
        },
      );

      expect(result.stdout).toContain("Installed layer");
      expect(result.stdout).toContain("team");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("layer add with no selector on non-TTY fails with clear error", async () => {
    const context = await createTestContext("cli-layer-add-no-selector-non-tty");
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
        ["layer", "add", "--profile", "test"],
        { isTTY: false }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("selector is required");
    } finally {
      await context.cleanup();
    }
  });

  // ── Task 4: Publish org resolution ─────────────────────────────────────────

  it("layer publish with no --org auto-selects when user has exactly one org", async () => {
    const context = await createTestContext("cli-layer-publish-one-org");
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
        if (url.endsWith("/layers/publish")) {
          return { ok: true, json: async () => ({ id: "pub-1", version: "1.0.0", url: "https://mock/layers/pub-1" }) };
        }
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      const layerModel = await import("../../src/models/layer.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "my-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        })
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const result = await runCli(["layer", "publish", "my-layer", "--profile", "test", "--format", "json"]);

      expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
      const payload = JSON.parse(result.stdout);
      expect(payload).toEqual(expect.objectContaining({ id: "pub-1", version: "1.0.0" }));

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("layer publish with no --org prompts when user has multiple orgs", async () => {
    const context = await createTestContext("cli-layer-publish-multi-org");
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
        if (url.endsWith("/layers/publish")) {
          return { ok: true, json: async () => ({ id: "pub-2", version: "1.0.0", url: "https://mock/layers/pub-2" }) };
        }
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      const layerModel = await import("../../src/models/layer.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "multi-org-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        })
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const result = await runCli(
        ["layer", "publish", "multi-org-layer", "--profile", "test"],
        {
          isTTY: true,
          promptResponses: [{ value: "widgets" }]
        }
      );

      const stderr = result.stderr
        ?.replace(/^Warning: exportLayer writes bundle v1[^\n]*\n?/m, "")
        .trim();
      if (stderr) {
        throw new Error(`Command failed with stderr: ${stderr}`);
      }
      expect(result.stdout).toContain("Published layer");

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("layer publish with no --org errors when user has zero orgs", async () => {
    const context = await createTestContext("cli-layer-publish-zero-org");
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

      const layerModel = await import("../../src/models/layer.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "zero-org-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        })
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const result = await runCli(["layer", "publish", "zero-org-layer", "--profile", "test"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No organizations found");

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("layer publish detects existing library slug and errors clearly", async () => {
    const context = await createTestContext("cli-layer-publish-slug-exists");
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
        if (url.endsWith("/layers/publish")) {
          return { 
            ok: false, 
            status: 409,
            text: async () => "Library slug already exists"
          };
        }
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      const layerModel = await import("../../src/models/layer.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "existing-slug" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        })
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const result = await runCli(["layer", "publish", "existing-slug", "--profile", "test"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("already exists");

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("layer add resolves three-part selectors against the catalog API", async () => {
    const context = await createTestContext("cli-layer-add-three-part");
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

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        libraries: [{
          orgSlug: "acme",
          catalogSlug: "personas",
          slug: "frontend",
          name: "Frontend Persona",
          summary: "Frontend persona layer",
          latestVersion: "2.0.0",
          updatedAt: new Date().toISOString(),
          tags: [],
          visibility: "public",
        }],
      });

      const result = await runCli([
        "layer",
        "add",
        "acme/personas/frontend@2.0.0",
        "--as",
        "persona-frontend",
        "--profile",
        "test",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);

      expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({
          layer_name: "persona-frontend",
          org_slug: "acme",
          catalog_slug: "personas",
          library_slug: "frontend",
          version: "2.0.0",
        }),
      );

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("layer publish passes catalog_slug to the cloud publish API", async () => {
    const context = await createTestContext("cli-layer-publish-catalog");
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

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "catalog-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "r", content: "#x" }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      let publishMetadata: Record<string, unknown> | undefined;
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
        if (url.endsWith("/layers/publish") && init?.method === "POST") {
          const form = init.body as FormData;
          publishMetadata = JSON.parse(String(form.get("metadata"))) as Record<string, unknown>;
          return { ok: true, json: async () => ({ id: "pub-cat", version: "1.0.0" }) };
        }
        return { ok: false, status: 404, text: async () => "not found" };
      }) as typeof fetch;

      const result = await runCli([
        "layer",
        "publish",
        "catalog-layer",
        "--org",
        "acme",
        "--catalog",
        "platform-personas",
        "--profile",
        "test",
        "--format",
        "json",
      ]);

      expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
      expect(publishMetadata).toEqual(
        expect.objectContaining({
          layer_name: "catalog-layer",
          org_slug: "acme",
          catalog_slug: "platform-personas",
        }),
      );

      globalThis.fetch = originalFetch;
    } finally {
      await context.cleanup();
    }
  });

  it("layer add installs a public default-catalog library without a cloud profile", async () => {
    const context = await createTestContext("cli-layer-add-anonymous");
    try {
      await runCli(["init"]);
      const restoreFetch = createCatalogFetchMock({ baseUrl: "https://harnessdeck.kayrnt.fr" });

      const result = await runCli([
        "layer",
        "add",
        "harnessdeck-cloud/team@1.0",
        "--as",
        "oss-team",
        "--format",
        "json",
      ]);

      expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({
          layer_name: "oss-team",
          org_slug: "harnessdeck-cloud",
          library_slug: "team",
        }),
      );

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("layer catalog connect org expands the saved catalog scope", async () => {
    const context = await createTestContext("cli-layer-catalog-connect-org");
    try {
      await runCli(["init"]);
      const restoreFetch = createCatalogFetchMock({ baseUrl: "https://mock" });

      const connect = await runCli([
        "layer",
        "catalog",
        "connect",
        "org",
        "acme",
        "--base-url",
        "https://mock",
      ]);
      expect(connect.stdout).toContain("Connected catalog org");

      const list = await runCli(["layer", "catalog", "list", "--format", "json"]);
      const payload = JSON.parse(list.stdout);
      expect(payload.connectedOrgs).toEqual(["acme"]);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  // ── Task 4: from-project conflict resolution ──────────────────────────────

  it("layer from-project errors when layer exists without interactive mode", async () => {
    const context = await createTestContext("cli-layer-from-project-exists");
    try {
      await runCli(["init"]);

      // Create an existing layer
      const layerModel = await import("../../src/models/layer.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingLayer = layerModel.createLayer({ name: "existing" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "res",
          description: "original",
          content: "#original",
        })
      );
      layerModel.addResourceToLayer(existingLayer.id, existingResource.id);

      // Create a project directory
      const { mkdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-project");
      mkdirSync(projectDir, { recursive: true });

      // Try to create layer with same name in non-interactive mode
      const result = await runCli(
        ["layer", "from-project", "existing", "--project", projectDir],
        { isTTY: false }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("already exists");
    } finally {
      await context.cleanup();
    }
  });

  it("layer from-project with conflict shows preview and allows overwrite", async () => {
    const context = await createTestContext("cli-layer-from-project-overwrite");
    try {
      await runCli(["init"]);

      // Create an existing layer with a resource
      const layerModel = await import("../../src/models/layer.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingLayer = layerModel.createLayer({ name: "mylayer" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "cursorrules",
          description: "old cursor rules",
          content: "# OLD CONTENT",
        })
      );
      layerModel.addResourceToLayer(existingLayer.id, existingResource.id);

      // Verify initial state
      const initialResources = layerModel.getLayerResources(existingLayer.id);
      expect(initialResources.length).toBe(1);
      expect(initialResources[0].content).toBe("# OLD CONTENT");

      // Create a project directory with a file that will be scanned
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-project-over");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, ".cursorrules"), "# NEW CONTENT\nThis is updated");

      // Run from-project with interactive mode and choose overwrite
      const result = await runCli(
        ["layer", "from-project", "mylayer", "--project", projectDir],
        {
          isTTY: true,
          promptResponses: [{ value: "overwrite" }]
        }
      );

      // Should show preview information
      expect(result.stdout).toContain("already exists");
      expect(result.stdout).toMatch(/conflict|Conflict/i);

      // Should complete successfully
      expect(result.stdout).toMatch(/Created layer|Updated layer/i);

      // Verify the layer was updated (not just content changed)
      const updatedLayer = layerModel.getLayer("mylayer");
      expect(updatedLayer).toBeTruthy();
      if (!updatedLayer) throw new Error("Expected updated layer to exist");
      const updatedResources = layerModel.getLayerResources(updatedLayer.id);
      
      // Should have new content
      const cursorRulesResource = updatedResources.find(r => r.name === "cursorrules");
      expect(cursorRulesResource).toBeTruthy();
      if (!cursorRulesResource) throw new Error("Expected cursor rules resource to exist");
      expect(cursorRulesResource.content).toContain("NEW CONTENT");
    } finally {
      await context.cleanup();
    }
  });

  it("layer from-project with conflict shows preview and allows rename", async () => {
    const context = await createTestContext("cli-layer-from-project-rename");
    try {
      await runCli(["init"]);

      // Create an existing layer
      const layerModel = await import("../../src/models/layer.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingLayer = layerModel.createLayer({ name: "original" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "cursorrules",
          description: "original rules",
          content: "# ORIGINAL",
        })
      );
      layerModel.addResourceToLayer(existingLayer.id, existingResource.id);

      // Verify initial state
      const initialResources = layerModel.getLayerResources(existingLayer.id);
      expect(initialResources.length).toBe(1);
      expect(initialResources[0].content).toBe("# ORIGINAL");

      // Create a project directory with new content
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-project-rename");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, ".cursorrules"), "# RENAMED CONTENT");

      // Run from-project and choose rename
      const result = await runCli(
        ["layer", "from-project", "original", "--project", projectDir],
        {
          isTTY: true,
          promptResponses: [
            { value: "rename" },
            { value: "original-renamed" }
          ]
        }
      );

      // Should show preview
      expect(result.stdout).toContain("already exists");
      
      // Should complete successfully
      expect(result.stdout).toMatch(/Created layer/i);

      // Verify original layer is unchanged
      const originalLayer = layerModel.getLayer("original");
      expect(originalLayer).toBeTruthy();
      if (!originalLayer) throw new Error("Expected original layer to exist");
      const originalResources = layerModel.getLayerResources(originalLayer.id);
      expect(originalResources[0].content).toBe("# ORIGINAL");

      // Verify new layer was created
      const renamedLayer = layerModel.getLayer("original-renamed");
      expect(renamedLayer).toBeTruthy();
      if (!renamedLayer) throw new Error("Expected renamed layer to exist");
      const renamedResources = layerModel.getLayerResources(renamedLayer.id);
      const renamedCursorRules = renamedResources.find(r => r.name === "cursorrules");
      expect(renamedCursorRules).toBeTruthy();
      if (!renamedCursorRules) throw new Error("Expected cursor rules resource to exist");
      expect(renamedCursorRules.content).toContain("RENAMED CONTENT");
    } finally {
      await context.cleanup();
    }
  });

  it("layer from-project with conflict shows preview and allows cancel", async () => {
    const context = await createTestContext("cli-layer-from-project-cancel");
    try {
      await runCli(["init"]);

      // Create an existing layer
      const layerModel = await import("../../src/models/layer.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingLayer = layerModel.createLayer({ name: "tocancel" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "cursorrules",
          description: "original",
          content: "# SHOULD NOT CHANGE",
        })
      );
      layerModel.addResourceToLayer(existingLayer.id, existingResource.id);

      // Record initial state
      const initialLayerCount = layerModel.listLayers().length;
      const initialResources = layerModel.getLayerResources(existingLayer.id);
      expect(initialResources.length).toBe(1);
      expect(initialResources[0].content).toBe("# SHOULD NOT CHANGE");

      // Create a project directory
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-project-cancel");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, ".cursorrules"), "# THIS SHOULD NOT BE IMPORTED");

      // Run from-project and choose cancel
      const result = await runCli(
        ["layer", "from-project", "tocancel", "--project", projectDir],
        {
          isTTY: true,
          promptResponses: [{ value: "cancel" }]
        }
      );

      // Should show preview
      expect(result.stdout).toContain("already exists");
      
      // Should indicate cancellation
      expect(result.stdout).toMatch(/cancel|Cancel/i);

      // Verify no changes were made to the layer
      const unchangedLayer = layerModel.getLayer("tocancel");
      expect(unchangedLayer).toBeTruthy();
      if (!unchangedLayer) throw new Error("Expected unchanged layer to exist");
      const unchangedResources = layerModel.getLayerResources(unchangedLayer.id);
      expect(unchangedResources.length).toBe(1);
      expect(unchangedResources[0].content).toBe("# SHOULD NOT CHANGE");

      // Verify no new layers were created
      expect(layerModel.listLayers().length).toBe(initialLayerCount);
    } finally {
      await context.cleanup();
    }
  });

  it("layer from-project with only new resources (no conflicts) errors clearly in non-interactive mode", async () => {
    const context = await createTestContext("cli-layer-from-project-new-only");
    try {
      await runCli(["init"]);

      // Create an existing layer with a resource
      const layerModel = await import("../../src/models/layer.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingLayer = layerModel.createLayer({ name: "existing" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "other-resource",
          description: "unrelated",
          content: "# UNRELATED",
        })
      );
      layerModel.addResourceToLayer(existingLayer.id, existingResource.id);

      // Create a project directory with a NEW resource (not conflicting)
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-project-new");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, ".cursorrules"), "# NEW RESOURCE");

      // Try to create layer in non-interactive mode
      const result = await runCli(
        ["layer", "from-project", "existing", "--project", projectDir],
        { isTTY: false }
      );

      expect(result.exitCode).toBe(1);
      // Should mention new resources, not conflicting resources
      expect(result.stderr).toContain("already exists");
      expect(result.stderr).not.toContain("0 conflicting");
      expect(result.stderr).toMatch(/1 new resource/i);
      expect(result.stderr).not.toMatch(/conflicting/i);
    } finally {
      await context.cleanup();
    }
  });

  it("layer from-project with only new resources shows accurate preview in interactive mode", async () => {
    const context = await createTestContext("cli-layer-from-project-new-interactive");
    try {
      await runCli(["init"]);

      // Create an existing layer with a resource
      const layerModel = await import("../../src/models/layer.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingLayer = layerModel.createLayer({ name: "existing-new" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "existing-res",
          description: "existing",
          content: "# EXISTING",
        })
      );
      layerModel.addResourceToLayer(existingLayer.id, existingResource.id);

      // Create a project directory with a NEW resource
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-new-interactive");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, ".cursorrules"), "# NEW");

      // Interactive mode with cancel to check messaging
      const result = await runCli(
        ["layer", "from-project", "existing-new", "--project", projectDir],
        {
          isTTY: true,
          promptResponses: [{ value: "cancel" }]
        }
      );

      // Should show accurate preview
      expect(result.stdout).toContain("already exists");
      expect(result.stdout).toMatch(/New resources: 1 would be added/);
      // Should NOT show conflicts when there are none
      expect(result.stdout).not.toMatch(/Conflicts:/);
      expect(result.stdout).not.toMatch(/0.*overwritten/);
    } finally {
      await context.cleanup();
    }
  });
});
