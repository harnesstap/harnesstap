import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createProfileCommand } from "../../src/services/profile-commands.ts";
import { cutPluginVersion } from "../../src/services/plugin-versioning.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
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

  async function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-routes-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    const server = await startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  it("lists profiles and serves status without auth", async () => {
    const server = await withServer();

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
    const server = await withServer();

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
      profiles: Array<{ name: string; scopes: string[]; dirty: boolean }>;
    };
    const byName = new Map(
      body.profiles.map((profile) => [profile.name, profile]),
    );
    expect(byName.get("work")?.scopes).toEqual(["home", "project"]);
    expect(byName.get("work")?.dirty).toBe(false);
    expect(byName.get("side")?.scopes).toEqual(["home"]);
    expect(byName.get("side")?.dirty).toBe(false);
    expect(byName.has("empty")).toBe(false);
  });

  it("lists profile head semver version instead of lexicographic sort", async () => {
    const server = await withServer();

    const profile = createPlugin({ name: "versioned", version: "1.9.0", tags: ["profile"] });
    setPluginTags(profile.id, ["profile"]);
    cutPluginVersion({ pluginId: profile.id, newVersion: "1.10.0" });

    const response = await fetch(`${server.url}/v1/profiles`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      profiles: Array<{ name: string; version: string }>;
    };
    const listed = body.profiles.find((entry) => entry.name === "versioned");
    expect(listed?.version).toBe("1.10.0");
  });

  it("does not list the removed empty builtin profile", async () => {
    const server = await withServer();
    const response = await fetch(`${server.url}/v1/profiles`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      profiles: Array<{ name: string }>;
    };
    expect(body.profiles.some((profile) => profile.name === "empty")).toBe(false);
  });

  it("rejects switch without bearer token", async () => {
    const server = await withServer();
    const response = await fetch(`${server.url}/v1/switch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: "work", scope: "home" }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects legacy persona field on switch", async () => {
    const server = await withServer();
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

  it("bootstraps a project by seeding project default from local resources", async () => {
    const server = await withServer();
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
    expect(body.default_profile).toBe("project default");
    expect(body.profiles).toEqual(["project default"]);
    expect(body.config_path).toContain(".harnesstap/config.toml");
  });

  it("returns existing project config without re-init on bootstrap", async () => {
    const server = await withServer();
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
    expect(body.profiles).toEqual(expect.arrayContaining(["work", "project default"]));
    expect(body.config_path).toContain(".harnesstap/config.toml");
  });

  it("keeps project default off the home profile list", async () => {
    const server = await withServer();
    const projectDir = mkdtempSync(join(tmpdir(), "ht-agent-bootstrap-home-"));
    tempDirs.push(projectDir);

    await fetch(`${server.url}/v1/bootstrap`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectPath: projectDir }),
    });

    const home = await fetch(`${server.url}/v1/profiles`);
    const homeBody = (await home.json()) as {
      profiles: Array<{ name: string; scopes: string[] }>;
    };
    expect(homeBody.profiles.some((profile) => profile.name === "project default")).toBe(
      false,
    );

    const project = await fetch(
      `${server.url}/v1/profiles?projectPath=${encodeURIComponent(projectDir)}`,
    );
    const projectBody = (await project.json()) as {
      profiles: Array<{ name: string; scopes: string[] }>;
    };
    const byName = new Map(
      projectBody.profiles.map((profile) => [profile.name, profile]),
    );
    expect(byName.get("project default")?.scopes).toEqual(["project"]);
    expect(byName.get("global default")?.scopes).toEqual(["home"]);
  });
});
