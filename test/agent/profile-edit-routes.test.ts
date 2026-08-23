import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import {
  createPlugin,
  getPluginResources,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";

describe("agent profile edit routes", () => {
  const previousHarnessTapHome = process.env.HARNESSTAP_HOME;
  const previousHome = process.env.HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.stop();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    restoreEnv("HARNESSTAP_HOME", previousHarnessTapHome);
    restoreEnv("HOME", previousHome);
  });

  async function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-profile-edit-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    process.env.HOME = dir;
    const server = await startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  function authHeaders(token: string): HeadersInit {
    return {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
  }

  it("gets, patches, attaches, and detaches profile composition", async () => {
    const server = await withServer();
    const profile = createPlugin({
      name: "focus",
      description: "before",
      tags: ["profile"],
    });
    const dep = createPlugin({ name: "shared-plugin", tags: [] });
    const skill = createResource({
      type: "skill",
      name: "demo-skill",
      description: "demo",
      content: "# demo",
      metadata: {},
      source: "test",
    });

    const detailResponse = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}`,
      { headers: authHeaders(server.token) },
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      profile: { description: string; tags: string[]; dirty: boolean };
      resources: unknown[];
      dependencies: unknown[];
    };
    expect(detail.profile.description).toBe("before");
    expect(detail.profile.dirty).toBe(false);
    expect(detail.resources).toEqual([]);
    expect(detail.dependencies).toEqual([]);

    const patchResponse = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}`,
      {
        method: "PATCH",
        headers: authHeaders(server.token),
        body: JSON.stringify({
          description: "after",
          tags: ["focus", "profile"],
        }),
      },
    );
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as {
      profile: { description: string; tags: string[]; dirty: boolean };
    };
    expect(patched.profile.description).toBe("after");
    expect(patched.profile.dirty).toBe(true);
    expect(patched.profile.tags).toContain("focus");
    expect(patched.profile.tags).toContain("profile");

    const attachDependency = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}/attachments`,
      {
        method: "POST",
        headers: authHeaders(server.token),
        body: JSON.stringify({ pluginId: dep.id }),
      },
    );
    expect(attachDependency.status).toBe(200);
    const withDependency = (await attachDependency.json()) as {
      dependencies: Array<{ dependency_name: string }>;
    };
    expect(
      withDependency.dependencies.map((row) => row.dependency_name),
    ).toContain("shared-plugin");

    const attachResource = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}/attachments`,
      {
        method: "POST",
        headers: authHeaders(server.token),
        body: JSON.stringify({ resourceId: skill.id }),
      },
    );
    expect(attachResource.status).toBe(200);
    const withResource = (await attachResource.json()) as {
      resources: Array<{ id: string; name: string }>;
    };
    expect(withResource.resources.some((row) => row.id === skill.id)).toBe(true);

    const detachResource = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}/attachments`,
      {
        method: "DELETE",
        headers: authHeaders(server.token),
        body: JSON.stringify({ resourceId: skill.id }),
      },
    );
    expect(detachResource.status).toBe(200);
    expect(
      getPluginResources(profile.id).some((row) => row.id === skill.id),
    ).toBe(false);

    const detachPlugin = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}/attachments`,
      {
        method: "DELETE",
        headers: authHeaders(server.token),
        body: JSON.stringify({ dependencyName: "shared-plugin" }),
      },
    );
    expect(detachPlugin.status).toBe(200);
    const afterDetach = (await detachPlugin.json()) as {
      dependencies: unknown[];
    };
    expect(afterDetach.dependencies).toEqual([]);
  });

  it("returns not_a_profile for plain plugins", async () => {
    const server = await withServer();
    createPlugin({ name: "plain", tags: [] });
    const response = await fetch(`${server.url}/v1/profiles/plain`, {
      headers: authHeaders(server.token),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("not_a_profile");
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
