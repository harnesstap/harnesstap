import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import {
  createLayer,
  getLayerResources,
} from "../../src/models/layer-model.ts";
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

  function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-profile-edit-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    process.env.HOME = dir;
    const server = startAgentServer({ port: 0 });
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
    const server = withServer();
    const profile = createLayer({
      name: "focus",
      description: "before",
      tags: ["profile"],
    });
    const dep = createLayer({ name: "shared-layer", tags: [] });
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

    const attachLayer = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}/attachments`,
      {
        method: "POST",
        headers: authHeaders(server.token),
        body: JSON.stringify({ layerId: dep.id }),
      },
    );
    expect(attachLayer.status).toBe(200);
    const withLayer = (await attachLayer.json()) as {
      dependencies: Array<{ dependency_name: string }>;
    };
    expect(withLayer.dependencies.map((row) => row.dependency_name)).toContain(
      "shared-layer",
    );

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

    const plugin = createResource({
      type: "plugin_pin",
      name: "superpowers",
      description: "plugin",
      content: "",
      metadata: {},
      source: "test",
      namespace: "obra",
    });
    const attachPlugin = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}/attachments`,
      {
        method: "POST",
        headers: authHeaders(server.token),
        body: JSON.stringify({ resourceId: plugin.id }),
      },
    );
    expect(attachPlugin.status).toBe(200);
    const withPlugin = (await attachPlugin.json()) as {
      resources: Array<{ id: string; type: string; name: string }>;
    };
    expect(
      withPlugin.resources.some(
        (row) => row.id === plugin.id && row.type === "plugin_pin",
      ),
    ).toBe(true);

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
      getLayerResources(profile.id).some((row) => row.id === skill.id),
    ).toBe(false);

    const detachLayer = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}/attachments`,
      {
        method: "DELETE",
        headers: authHeaders(server.token),
        body: JSON.stringify({ dependencyName: "shared-layer" }),
      },
    );
    expect(detachLayer.status).toBe(200);
    const afterDetach = (await detachLayer.json()) as {
      dependencies: unknown[];
    };
    expect(afterDetach.dependencies).toEqual([]);
  });

  it("returns not_a_profile for plain layers", async () => {
    const server = withServer();
    createLayer({ name: "plain", tags: [] });
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
