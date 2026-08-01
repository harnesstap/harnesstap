import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createProfileCommand } from "../../src/services/profile-commands.ts";
import { writeStarterProjectConfig } from "../../src/services/project-config-write.ts";

describe("agent routes", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.stop();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = previousHome;
    }
  });

  function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-routes-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  it("lists profiles and serves status without auth", async () => {
    const server = withServer();

    const profiles = await fetch(`${server.url}/v1/profiles`);
    expect(profiles.status).toBe(200);
    await expect(profiles.json()).resolves.toEqual({ profiles: expect.any(Array) });

    const legacy = await fetch(`${server.url}/v1/personas`);
    expect(legacy.status).toBe(404);

    const status = await fetch(`${server.url}/v1/status?depth=fast`);
    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body.panel).toBeDefined();
    expect(body.depth).toBe("fast");
    expect(body.switching).toBe(false);
  });

  it("marks local profiles as home and project-config profiles as project", async () => {
    const server = withServer();

    createProfileCommand({ name: "work" });
    createProfileCommand({ name: "side" });

    const projectDir = mkdtempSync(join(tmpdir(), "ht-agent-project-"));
    tempDirs.push(projectDir);
    writeStarterProjectConfig({
      projectPath: projectDir,
      defaultProfile: "work",
      profileNames: ["work"],
    });

    const response = await fetch(
      `${server.url}/v1/profiles?projectPath=${encodeURIComponent(projectDir)}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      profiles: Array<{ name: string; scopes: string[] }>;
    };
    const byName = new Map(body.profiles.map((profile) => [profile.name, profile.scopes]));
    expect(byName.get("empty")).toEqual(["home", "project"]);
    expect(byName.get("work")).toEqual(["home", "project"]);
    expect(byName.get("side")).toEqual(["home"]);
  });

  it("lists empty builtin profile with home and project scopes even without projectPath", async () => {
    const server = withServer();
    const response = await fetch(`${server.url}/v1/profiles`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      profiles: Array<{ name: string; scopes: string[]; description: string | null }>;
    };
    const empty = body.profiles.find((profile) => profile.name === "empty");
    expect(empty).toEqual({
      name: "empty",
      version: "",
      tags: ["profile"],
      description: "No resources",
      scopes: ["home", "project"],
    });
  });

  it("rejects switch without bearer token", async () => {
    const server = withServer();
    const response = await fetch(`${server.url}/v1/switch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: "work", scope: "home" }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects legacy persona field on switch", async () => {
    const server = withServer();
    const response = await fetch(`${server.url}/v1/switch`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ persona: "work", scope: "home" }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_profile" });
  });

  it("bootstraps a project with no prior profiles by seeding default", async () => {
    const server = withServer();
    const projectDir = mkdtempSync(join(tmpdir(), "ht-agent-bootstrap-"));
    tempDirs.push(projectDir);

    const response = await fetch(`${server.url}/v1/bootstrap`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectPath: projectDir }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      default_profile: string;
      profiles: string[];
      config_path: string;
    };
    expect(body.default_profile).toBe("default");
    expect(body.profiles).toEqual(["default"]);
    expect(body.config_path).toContain(".harnesstap/config.toml");
  });

  it("returns existing project config without re-init on bootstrap", async () => {
    const server = withServer();
    const projectDir = mkdtempSync(join(tmpdir(), "ht-agent-bootstrap-exists-"));
    tempDirs.push(projectDir);

    createProfileCommand({ name: "work" });
    writeStarterProjectConfig({
      projectPath: projectDir,
      defaultProfile: "work",
      profileNames: ["work"],
    });

    const response = await fetch(`${server.url}/v1/bootstrap`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectPath: projectDir }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      default_profile: string;
      profiles: string[];
      config_path: string;
      already_existed?: boolean;
    };
    expect(body.already_existed).toBe(true);
    expect(body.default_profile).toBe("work");
    expect(body.profiles).toEqual(["work"]);
    expect(body.config_path).toContain(".harnesstap/config.toml");
  });
});
