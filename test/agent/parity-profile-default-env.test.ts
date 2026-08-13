import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { tryHandle } from "../../src/agent/parity-handlers/profile-default-env.ts";
import { getDb } from "../../src/db/connection.ts";
import { createEnvironment } from "../../src/models/environment.ts";
import { createPlugin, setPluginDefaultEnvironment } from "../../src/models/plugin-model.ts";

describe("parity profile default environment", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-profile-default-env-"));
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

  function envPath(name: string): string {
    return `/v1/profiles/${encodeURIComponent(name)}/default-environment`;
  }

  it("returns null from tryHandle for unrelated paths", async () => {
    const request = new Request("http://127.0.0.1/v1/health");
    const result = await tryHandle(request, "token", {
      isAgentSwitchInProgress: () => false,
    });
    expect(result).toBeNull();
  });

  it("GET returns defaultEnvironment null when unset", async () => {
    const server = withServer();
    const profile = createPlugin({
      name: "focus",
      description: "before",
      tags: ["profile"],
    });
    const response = await fetch(`${server.url}${envPath(profile.name)}`, {
      headers: authHeaders(server.token),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { defaultEnvironment: string | null };
    expect(body.defaultEnvironment).toBeNull();
  });

  it("PATCH sets by name, dirties the profile, and GET hydrates the name", async () => {
    const server = withServer();
    const profile = createPlugin({ name: "focus", tags: ["profile"] });
    createEnvironment({ name: "staging" });

    const patchResponse = await fetch(`${server.url}${envPath(profile.name)}`, {
      method: "PATCH",
      headers: authHeaders(server.token),
      body: JSON.stringify({ defaultEnvironment: "staging" }),
    });
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as {
      defaultEnvironment: string | null;
    };
    expect(patched.defaultEnvironment).toBe("staging");

    const detailResponse = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}`,
      { headers: authHeaders(server.token) },
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      profile: { dirty: boolean };
    };
    expect(detail.profile.dirty).toBe(true);

    const getResponse = await fetch(`${server.url}${envPath(profile.name)}`, {
      headers: authHeaders(server.token),
    });
    expect(getResponse.status).toBe(200);
    const got = (await getResponse.json()) as { defaultEnvironment: string | null };
    expect(got.defaultEnvironment).toBe("staging");
  });

  it("PATCH null clears the binding", async () => {
    const server = withServer();
    const profile = createPlugin({ name: "focus", tags: ["profile"] });
    createEnvironment({ name: "staging" });
    await fetch(`${server.url}${envPath(profile.name)}`, {
      method: "PATCH",
      headers: authHeaders(server.token),
      body: JSON.stringify({ defaultEnvironment: "staging" }),
    });

    const clearResponse = await fetch(`${server.url}${envPath(profile.name)}`, {
      method: "PATCH",
      headers: authHeaders(server.token),
      body: JSON.stringify({ defaultEnvironment: null }),
    });
    expect(clearResponse.status).toBe(200);
    const cleared = (await clearResponse.json()) as {
      defaultEnvironment: string | null;
    };
    expect(cleared.defaultEnvironment).toBeNull();
  });

  it("PATCH missing name returns 404 environment_not_found", async () => {
    const server = withServer();
    const profile = createPlugin({ name: "focus", tags: ["profile"] });
    const response = await fetch(`${server.url}${envPath(profile.name)}`, {
      method: "PATCH",
      headers: authHeaders(server.token),
      body: JSON.stringify({ defaultEnvironment: "missing" }),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("environment_not_found");
  });

  it("PATCH empty string returns 400 invalid_body", async () => {
    const server = withServer();
    const profile = createPlugin({ name: "focus", tags: ["profile"] });
    const response = await fetch(`${server.url}${envPath(profile.name)}`, {
      method: "PATCH",
      headers: authHeaders(server.token),
      body: JSON.stringify({ defaultEnvironment: "" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string; message?: string };
    expect(body.error).toBe("invalid_body");
    expect(body.message).toBe(
      "defaultEnvironment must be a non-empty string or null",
    );
  });

  it("PATCH empty object returns 400 invalid_body", async () => {
    const server = withServer();
    const profile = createPlugin({ name: "focus", tags: ["profile"] });
    const response = await fetch(`${server.url}${envPath(profile.name)}`, {
      method: "PATCH",
      headers: authHeaders(server.token),
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("invalid_body");
  });

  it("PATCH only defaultEnvironment succeeds without description or tags", async () => {
    const server = withServer();
    const profile = createPlugin({
      name: "focus",
      description: "keep-me",
      tags: ["profile"],
    });
    createEnvironment({ name: "staging" });
    const response = await fetch(`${server.url}${envPath(profile.name)}`, {
      method: "PATCH",
      headers: authHeaders(server.token),
      body: JSON.stringify({ defaultEnvironment: "staging" }),
    });
    expect(response.status).toBe(200);
    const detailResponse = await fetch(
      `${server.url}/v1/profiles/${encodeURIComponent(profile.name)}`,
      { headers: authHeaders(server.token) },
    );
    const detail = (await detailResponse.json()) as {
      profile: { description: string };
    };
    expect(detail.profile.description).toBe("keep-me");
  });

  it("unauthenticated PATCH returns 401", async () => {
    const server = withServer();
    const profile = createPlugin({ name: "focus", tags: ["profile"] });
    const response = await fetch(`${server.url}${envPath(profile.name)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultEnvironment: "staging" }),
    });
    expect(response.status).toBe(401);
  });

  it("GET returns null when the stored environment id is orphaned", async () => {
    const server = withServer();
    const profile = createPlugin({ name: "focus", tags: ["profile"] });
    const environment = createEnvironment({ name: "staging" });
    setPluginDefaultEnvironment(profile.id, environment.id);
    const db = getDb();
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("DELETE FROM environments WHERE id = ?").run(environment.id);
    db.exec("PRAGMA foreign_keys = ON");
    const response = await fetch(`${server.url}${envPath(profile.name)}`, {
      headers: authHeaders(server.token),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { defaultEnvironment: string | null };
    expect(body.defaultEnvironment).toBeNull();
  });

  it("GET unknown profile returns 404 not_found", async () => {
    const server = withServer();
    const response = await fetch(`${server.url}${envPath("missing")}`, {
      headers: authHeaders(server.token),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("not_found");
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
