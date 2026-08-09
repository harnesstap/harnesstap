import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
      plugins: Array<{ name: string; ref: string }>;
    };
    expect(pluginBody.plugins.some((p) => p.ref === "demo-plugin@e2e-market")).toBe(true);
  });
});
