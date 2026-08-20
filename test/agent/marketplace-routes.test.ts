import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { spawnSync } from "node:child_process";

describe("agent marketplace routes", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HARNESSTAP_HOME;
    else process.env.HARNESSTAP_HOME = previousHome;
  });

  function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-mkt-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    const server = startAgentServer({ port: 0 });
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

  it("lists empty marketplaces with bearer auth", async () => {
    const server = withServer();
    const denied = await fetch(`${server.url}/v1/marketplaces`);
    expect(denied.status).toBe(401);

    const ok = await fetch(`${server.url}/v1/marketplaces`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ marketplaces: [] });
  });

  it("adds a marketplace from a local git path and refreshes catalog", async () => {
    const server = withServer();
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
    const addBody = (await add.json()) as {
      status: string;
      entry: { name: string; url: string };
      refresh: { ok: boolean };
    };
    expect(addBody.status).toBe("added");
    expect(addBody.entry.name).toBe("e2e-market");
    expect(addBody.refresh.ok).toBe(true);

    const list = await fetch(`${server.url}/v1/marketplaces`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    const listed = (await list.json()) as { marketplaces: Array<{ name: string }> };
    expect(listed.marketplaces.map((m) => m.name)).toContain("e2e-market");

    const plugins = await fetch(`${server.url}/v1/marketplaces/e2e-market/plugins`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(plugins.status).toBe(200);
    const pluginBody = (await plugins.json()) as {
      marketplace: string;
      plugins: Array<{ name: string; ref: string }>;
    };
    expect(pluginBody.marketplace).toBe("e2e-market");
    expect(pluginBody.plugins.some((p) => p.ref === "demo-plugin@e2e-market")).toBe(true);
  });

  it("returns 404 for plugins on unknown marketplace", async () => {
    const server = withServer();

    const plugins = await fetch(`${server.url}/v1/marketplaces/no-such-market/plugins`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(plugins.status).toBe(404);
    await expect(plugins.json()).resolves.toEqual({
      error: "not_found",
      message: "Marketplace not found: no-such-market",
    });
  });

  it("defaults platforms to claude-code when omitted", async () => {
    const server = withServer();
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
      }),
    });
    expect(add.status).toBe(200);
    const addBody = (await add.json()) as {
      entry: { platforms: string[] };
    };
    expect(addBody.entry.platforms).toEqual(["claude-code"]);
  });

  it("returns 400 for invalid platform", async () => {
    const server = withServer();
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
        platforms: ["not-a-platform"],
      }),
    });
    expect(add.status).toBe(400);
    await expect(add.json()).resolves.toEqual({
      error: "invalid_platform",
      message: "Each platform must be claude-code, cursor, goose, or copilot-cli",
    });
  });

  it("patches marketplace name and platforms", async () => {
    const server = withServer();
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

    const patch = await fetch(`${server.url}/v1/marketplaces/e2e-market`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "renamed",
        platforms: ["cursor"],
      }),
    });
    expect(patch.status).toBe(200);
    const patchBody = (await patch.json()) as {
      status: string;
      entry: { name: string; platforms: string[] };
    };
    expect(patchBody.status).toBe("updated");
    expect(patchBody.entry.name).toBe("renamed");
    expect(patchBody.entry.platforms).toEqual(["cursor"]);
  });

  it("keeps catalog plugins after a rename-only PATCH", async () => {
    const server = withServer();
    const repo = makeLocalMarketplaceGitRepo();
    const home = process.env.HARNESSTAP_HOME ?? "";

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

    const before = await fetch(`${server.url}/v1/marketplaces/e2e-market/plugins`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as {
      plugins: Array<{ name: string }>;
    };
    expect(beforeBody.plugins.some((p) => p.name === "demo-plugin")).toBe(true);

    const patch = await fetch(`${server.url}/v1/marketplaces/e2e-market`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(patch.status).toBe(200);

    const after = await fetch(`${server.url}/v1/marketplaces/renamed/plugins`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as {
      marketplace: string;
      plugins: Array<{ name: string }>;
    };
    expect(afterBody.marketplace).toBe("renamed");
    expect(afterBody.plugins.some((p) => p.name === "demo-plugin")).toBe(true);
    expect(existsSync(join(home, "cache", "marketplaces", "e2e-market"))).toBe(false);
    expect(existsSync(join(home, "cache", "marketplaces", "renamed"))).toBe(true);
  });

  it("returns 404 when patching an unknown marketplace", async () => {
    const server = withServer();

    const patch = await fetch(`${server.url}/v1/marketplaces/missing`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "x" }),
    });
    expect(patch.status).toBe(404);
    const body = (await patch.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns 409 when renaming onto an existing marketplace name", async () => {
    const server = withServer();
    const firstRepo = makeLocalMarketplaceGitRepo();
    const secondRepo = makeLocalMarketplaceGitRepo();

    const addFirst = await fetch(`${server.url}/v1/marketplaces`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: firstRepo,
        name: "first",
        platforms: ["claude-code"],
      }),
    });
    expect(addFirst.status).toBe(200);

    const addSecond = await fetch(`${server.url}/v1/marketplaces`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: secondRepo,
        name: "second",
        platforms: ["claude-code"],
      }),
    });
    expect(addSecond.status).toBe(200);

    const patch = await fetch(`${server.url}/v1/marketplaces/first`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "second" }),
    });
    expect(patch.status).toBe(409);
    const body = (await patch.json()) as { error: string };
    expect(body.error).toBe("name_conflict");
  });

  it("returns 409 when changing url onto an existing marketplace url", async () => {
    const server = withServer();
    const firstRepo = makeLocalMarketplaceGitRepo();
    const secondRepo = makeLocalMarketplaceGitRepo();

    const addFirst = await fetch(`${server.url}/v1/marketplaces`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: firstRepo,
        name: "first",
        platforms: ["claude-code"],
      }),
    });
    expect(addFirst.status).toBe(200);

    const addSecond = await fetch(`${server.url}/v1/marketplaces`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: secondRepo,
        name: "second",
        platforms: ["claude-code"],
      }),
    });
    expect(addSecond.status).toBe(200);

    const patch = await fetch(`${server.url}/v1/marketplaces/first`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: secondRepo }),
    });
    expect(patch.status).toBe(409);
    const body = (await patch.json()) as { error: string };
    expect(body.error).toBe("url_conflict");
  });

  it("rejects unauthenticated PATCH", async () => {
    const server = withServer();

    const denied = await fetch(`${server.url}/v1/marketplaces/e2e-market`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(denied.status).toBe(401);
  });
});
