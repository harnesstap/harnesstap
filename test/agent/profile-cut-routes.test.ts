import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  dirtyPluginsConflictResponse,
  pluginVersionErrorResponse,
} from "../../src/agent/profile-cut-handlers.ts";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { markPluginDirty } from "../../src/services/plugin-versioning.ts";

describe("agent profile cut routes", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-profile-cut-"));
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

  it("cuts a profile version and returns updated profile summary", async () => {
    const server = await withServer();
    const profile = createPlugin({
      name: "focus",
      version: "1.0.0",
      tags: ["profile"],
    });
    markPluginDirty(profile.id);

    const response = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}/cut`,
      {
        method: "POST",
        headers: authHeaders(server.token),
        body: JSON.stringify({ version: "1.1.0" }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      profile: { name: string; version: string; dirty: boolean };
    };
    expect(body.profile).toEqual({
      name: "focus",
      version: "1.1.0",
      dirty: false,
    });
  });

  it("rejects cut without bearer token", async () => {
    const server = await withServer();
    createPlugin({ name: "focus", version: "1.0.0", tags: ["profile"] });

    const response = await fetch(
      `${server.url}/v1/profiles/focus/cut`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: "1.1.0" }),
      },
    );
    expect(response.status).toBe(401);
  });

  it("returns plugin version errors as 400", async () => {
    const server = await withServer();
    createPlugin({ name: "focus", version: "1.0.0", tags: ["profile"] });

    const response = await fetch(
      `${server.url}/v1/profiles/focus/cut`,
      {
        method: "POST",
        headers: authHeaders(server.token),
        body: JSON.stringify({ version: "1.0.0" }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string; message?: string };
    expect(body.error).toBe("same_version");
    expect(body.message).toContain("must differ");
  });

  it("includes dirty on profile list and detail payloads", async () => {
    const server = await withServer();
    const profile = createPlugin({
      name: "focus",
      version: "1.0.0",
      tags: ["profile"],
    });
    markPluginDirty(profile.id);

    const listResponse = await fetch(`${server.url}/v1/profiles`);
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as {
      profiles: Array<{ name: string; dirty: boolean }>;
    };
    expect(listBody.profiles.find((row) => row.name === "focus")?.dirty).toBe(true);

    const detailResponse = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}`,
      { headers: authHeaders(server.token) },
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      profile: { dirty: boolean };
    };
    expect(detail.profile.dirty).toBe(true);
  });
});

describe("profile cut handler helpers", () => {
  it("dirtyPluginsConflictResponse returns 409 with dirty plugin list", async () => {
    const response = dirtyPluginsConflictResponse([
      { name: "focus", version: "1.0.0" },
    ]);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "dirty_plugins",
      message: "Cannot share plugins with unpublished edits: focus@1.0.0",
      dirty_plugins: [{ name: "focus", version: "1.0.0" }],
    });
  });

  it("pluginVersionErrorResponse maps dirty_plugins code with list", async () => {
    const { PluginVersionError } = await import(
      "../../src/services/plugin-versioning.ts"
    );
    const response = pluginVersionErrorResponse(
      new PluginVersionError(
        "dirty_plugins",
        "Cannot share plugins with unpublished edits: focus@1.0.0",
        { dirtyPlugins: [{ name: "focus", version: "1.0.0" }] },
      ),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "dirty_plugins",
      message: "Cannot share plugins with unpublished edits: focus@1.0.0",
      dirty_plugins: [{ name: "focus", version: "1.0.0" }],
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
