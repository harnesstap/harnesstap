import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  createAgentFetchHandler,
  createDefaultAgentRouteDeps,
} from "../../src/agent/routes.ts";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createLayer } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { isProfileLayer } from "../../src/constants/profile.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("agent profile create routes", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-profile-create-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    process.env.HOME = dir;
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return { ...server, home: dir };
  }

  it("previews home imports with bearer auth", async () => {
    const server = withServer();
    writeTextFile(
      join(server.home, ".claude", "skills", "research", "SKILL.md"),
      "---\nname: research\ndescription: Research\n---\n# Research",
    );

    const response = await postJson(
      `${server.url}/v1/profiles/preview`,
      server.token,
      {
        source: "home",
        name: "home-profile",
        conflictPolicy: "skip",
        platform: "claude-code",
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      source: "home",
      name: "home-profile",
      totalImports: 1,
      conflicts: [],
      warnings: [],
    });
  });

  it("creates a composed profile", async () => {
    const server = withServer();
    const resource = createResource({
      type: "skill",
      name: "review",
      description: "Review changes",
      content: "# Review",
      metadata: {},
      source: "manual",
    });

    const response = await postJson(`${server.url}/v1/profiles`, server.token, {
      source: "compose",
      name: "work",
      resourceIds: [resource.id],
      use: true,
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      profile: {
        name: "work",
        id: expect.any(String),
        version: "1.0.0",
      },
      imported_count: 1,
      used: false,
    });
  });

  it("returns layer_exists when a profile name is already used", async () => {
    const server = withServer();
    const resource = createResource({
      type: "skill",
      name: "review",
      description: "Review changes",
      content: "# Review",
      metadata: {},
      source: "manual",
    });
    createLayer({ name: "duplicate" });

    const response = await postJson(`${server.url}/v1/profiles`, server.token, {
      source: "compose",
      name: "duplicate",
      resourceIds: [resource.id],
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "layer_exists" });
  });

  it("returns layer_exists for project overwrite requests", async () => {
    const server = withServer();
    createLayer({ name: "duplicate-project" });

    const response = await postJson(`${server.url}/v1/profiles`, server.token, {
      source: "project",
      name: "duplicate-project",
      projectPath: server.home,
      conflictPolicy: "overwrite",
      platform: "claude-code",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "layer_exists" });
  });

  it("rejects unauthenticated profile creation requests", async () => {
    const server = withServer();
    const response = await fetch(`${server.url}/v1/profiles/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "compose",
        name: "work",
        resourceIds: ["resource-id"],
      }),
    });

    expect(response.status).toBe(401);
  });

  it("tags an existing layer as a profile", async () => {
    const server = withServer();
    const layer = createLayer({ name: "promote-me" });

    const response = await postJson(
      `${server.url}/v1/profiles/promote-me/tag`,
      server.token,
      {},
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { layer_id: string; tags: string[] };
    expect(body.layer_id).toBe(layer.id);
    expect(body.tags).toContain("profile");
    expect(isProfileLayer({ ...layer, tags: body.tags })).toBe(true);
  });

  it("renames a profile", async () => {
    const server = withServer();
    createLayer({ name: "work", tags: ["profile"] });

    const response = await postJson(
      `${server.url}/v1/profiles/work/rename`,
      server.token,
      { name: "focus" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      old_name: "work",
      name: "focus",
      layer_id: expect.any(String),
      was_active: false,
    });
  });

  it("returns layer_exists when rename target is taken", async () => {
    const server = withServer();
    createLayer({ name: "alpha", tags: ["profile"] });
    createLayer({ name: "beta", tags: ["profile"] });

    const response = await postJson(
      `${server.url}/v1/profiles/alpha/rename`,
      server.token,
      { name: "beta" },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "layer_exists" });
  });

  it("blocks profile creation while a switch is in progress", async () => {
    const handler = createAgentFetchHandler("secret", 7474, {
      ...createDefaultAgentRouteDeps(),
      isAgentSwitchInProgress: () => true,
    });

    const response = await handler(
      new Request("http://127.0.0.1:7474/v1/profiles", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          source: "compose",
          name: "work",
          resourceIds: ["resource-id"],
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "switch_in_progress",
    });
  });
});

function postJson(url: string, token: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
