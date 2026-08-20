import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import {
  saveCloudAccount,
  setDefaultCloudAccount,
} from "../../src/config/cloud-accounts.ts";
import { DEFAULT_CLOUD_BASE_URL } from "../../src/config/catalog.ts";
import { isProfilePlugin, PROFILE_PLUGIN_TAG } from "../../src/constants/profile.ts";
import { createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { makeApEnvelope } from "../helpers/ap-package-fixtures.ts";

const ACME_PLUGIN = {
  orgSlug: "acme",
  catalogSlug: "default",
  slug: "focus",
  name: "Focus",
  summary: "A focused profile",
  latestVersion: "2.0.0",
  updatedAt: "2026-07-25T00:00:00.000Z",
  tags: ["profile"],
  visibility: "public" as const,
};

describe("agent catalog plugin routes", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];
  const restoreFns: Array<() => void> = [];

  afterEach(() => {
    for (const restore of restoreFns.splice(0)) restore();
    for (const server of servers.splice(0)) server.stop();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HARNESSTAP_HOME;
    else process.env.HARNESSTAP_HOME = previousHome;
  });

  function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-catalog-plugins-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  function authHeaders(token: string): HeadersInit {
    return { Authorization: `Bearer ${token}` };
  }

  function mockCatalog(plugins = [ACME_PLUGIN], bundle?: string) {
    restoreFns.push(createCatalogFetchMock({
      plugins,
      ...(bundle ? { bundle } : {}),
    }));
  }

  async function signInCloud() {
    await saveCloudAccount("test", {
      cloudBaseUrl: DEFAULT_CLOUD_BASE_URL,
      accessToken: "tok",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      refreshToken: "r",
      scopes: [],
    });
    await setDefaultCloudAccount("test");
  }

  it("returns empty plugins when no org or registered query params are present", async () => {
    const server = withServer();
    mockCatalog();

    const response = await fetch(`${server.url}/v1/catalogs/plugins?q=focus`, {
      headers: authHeaders(server.token),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ plugins: [], errors: [] });
  });

  it("searches catalog plugins for a requested org", async () => {
    const server = withServer();
    mockCatalog();

    const response = await fetch(`${server.url}/v1/catalogs/plugins?org=acme`, {
      headers: authHeaders(server.token),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      plugins: [
        {
          selector: "acme/default/focus@2.0.0",
          name: "Focus",
          orgSlug: "acme",
          catalogSlug: "default",
          version: "2.0.0",
          tags: ["profile"],
          description: "A focused profile",
        },
      ],
      errors: [],
    });
  });

  it("pulls a catalog plugin without adding the profile tag", async () => {
    const server = withServer();
    await signInCloud();
    mockCatalog(
      [{
        orgSlug: "harnesstap-cloud",
        slug: "team",
        name: "Team Plugin",
        summary: "Team plugin",
        latestVersion: "1.0.0",
        tags: [],
        visibility: "public",
      }],
      makeApEnvelope({ name: "team-from-cloud" }),
    );

    const response = await fetch(`${server.url}/v1/catalogs/plugins/pull`, {
      method: "POST",
      headers: {
        ...authHeaders(server.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ selector: "harnesstap-cloud/default/team@1.0.0" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plugin: { name: string; id: string };
      tagged: boolean;
    };
    expect(body.tagged).toBe(false);
    expect(body.plugin.name).toBe("team-from-cloud");

    const installed = getPluginByName("team-from-cloud");
    expect(installed).toBeDefined();
    expect(isProfilePlugin(installed!)).toBe(false);
    expect(installed!.tags).not.toContain(PROFILE_PLUGIN_TAG);
  });

  it("requires as when the remote name collides with a local plugin", async () => {
    const server = withServer();
    await signInCloud();
    mockCatalog();
    createPlugin({ name: "focus" });

    const response = await fetch(`${server.url}/v1/catalogs/plugins/pull`, {
      method: "POST",
      headers: {
        ...authHeaders(server.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ selector: "acme/default/focus" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "name_collision",
      message: 'A local plugin named "focus" already exists; provide as to pull under a different name',
    });
  });

  it("requires agent bearer auth", async () => {
    const server = withServer();

    const getDenied = await fetch(`${server.url}/v1/catalogs/plugins?org=acme`);
    expect(getDenied.status).toBe(401);

    const postDenied = await fetch(`${server.url}/v1/catalogs/plugins/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selector: "acme/default/focus" }),
    });
    expect(postDenied.status).toBe(401);
  });

  it("returns auth_required when no cloud token is configured on pull", async () => {
    const server = withServer();
    mockCatalog();

    const response = await fetch(`${server.url}/v1/catalogs/plugins/pull`, {
      method: "POST",
      headers: {
        ...authHeaders(server.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ selector: "acme/default/focus" }),
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("auth_required");
  });
});
