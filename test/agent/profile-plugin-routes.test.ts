import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createProfileCommand } from "../../src/services/profile-commands.ts";

describe("agent profile plugin routes", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HARNESSTAP_HOME;
    else process.env.HARNESSTAP_HOME = previousHome;
  });

  async function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-profile-plugin-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    const server = await startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  function makeLocalMarketplaceGitRepo(): string {
    const root = mkdtempSync(join(tmpdir(), "ht-mkt-repo-"));
    tempDirs.push(root);
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(root, ".claude-plugin/marketplace.json"),
      JSON.stringify({
        name: "e2e-market",
        plugins: [{ name: "demo-plugin", version: "1.0.0", description: "E2E demo" }],
      }),
    );
    spawnSync("git", ["init"], { cwd: root, stdio: "ignore" });
    spawnSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
    spawnSync(
      "git",
      ["-c", "user.email=e2e@test", "-c", "user.name=e2e", "commit", "-m", "init"],
      { cwd: root, stdio: "ignore" },
    );
    return root;
  }

  async function addMarketplace(server: { url: string; token: string }) {
    const repo = makeLocalMarketplaceGitRepo();
    const add = await fetch(`${server.url}/v1/marketplaces`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: repo,
        name: "e2e-market",
        platforms: ["claude-code"],
      }),
    });
    expect(add.status).toBe(200);
    return repo;
  }

  it("pins a marketplace plugin onto a profile plugin", async () => {
    const server = await withServer();
    createProfileCommand({ name: "base" });
    await addMarketplace(server);

    const pin = await fetch(`${server.url}/v1/profiles/base/plugins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "demo-plugin@e2e-market" }),
    });
    expect(pin.status).toBe(200);
    const body = (await pin.json()) as { status: string; ref: string; pluginName: string };
    expect(body.status).toBe("attached");
    expect(body.ref).toBe("demo-plugin@e2e-market");
    expect(body.pluginName).toBe("base");
  });

  it("returns 401 without bearer auth", async () => {
    const server = await withServer();
    createProfileCommand({ name: "base" });

    const pin = await fetch(`${server.url}/v1/profiles/base/plugins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "demo-plugin@e2e-market" }),
    });
    expect(pin.status).toBe(401);
  });

  it("returns 400 when ref is missing", async () => {
    const server = await withServer();
    createProfileCommand({ name: "base" });

    const pin = await fetch(`${server.url}/v1/profiles/base/plugins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(pin.status).toBe(400);
    await expect(pin.json()).resolves.toEqual({
      error: "invalid_ref",
      message: "ref is required",
    });
  });
});
