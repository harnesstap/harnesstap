import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryHandle } from "../../src/agent/parity-handlers/marketplace-remove.ts";
import { startAgentServer } from "../../src/agent/serve.ts";

describe("DELETE /v1/marketplaces/:name", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-mkt-rm-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  function makeLocalMarketplaceGitRepo(): string {
    const root = mkdtempSync(join(tmpdir(), "ht-mkt-rm-repo-"));
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

  async function addMarketplace(
    server: { url: string; token: string },
    name: string,
    url: string,
  ) {
    const add = await fetch(`${server.url}/v1/marketplaces`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, name, platforms: ["claude-code"] }),
    });
    expect(add.status).toBe(200);
  }

  it("returns null from tryHandle for unrelated methods and paths", async () => {
    const request = new Request("http://127.0.0.1/v1/marketplaces/demo");
    const result = await tryHandle(request, "token", {
      isAgentSwitchInProgress: () => true,
    });
    expect(result).toBeNull();
  });

  it("returns 401 without bearer", async () => {
    const server = withServer();
    const denied = await fetch(`${server.url}/v1/marketplaces/demo`, {
      method: "DELETE",
    });
    expect(denied.status).toBe(401);
  });

  it("removes a registered marketplace without a JSON body", async () => {
    const server = withServer();
    const keepRepo = makeLocalMarketplaceGitRepo();
    const removeRepo = makeLocalMarketplaceGitRepo();
    await addMarketplace(server, "keep-me", keepRepo);
    await addMarketplace(server, "e2e-market", removeRepo);

    const removed = await fetch(`${server.url}/v1/marketplaces/e2e-market`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(removed.status).toBe(200);
    const body = (await removed.json()) as {
      status: string;
      entry: { name: string; url: string; platforms: string[] };
    };
    expect(body).toEqual({
      status: "removed",
      entry: {
        name: "e2e-market",
        url: removeRepo,
        platforms: ["claude-code"],
      },
    });

    const list = await fetch(`${server.url}/v1/marketplaces`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    const listed = (await list.json()) as { marketplaces: Array<{ name: string }> };
    expect(listed.marketplaces.map((m) => m.name)).toEqual(["keep-me"]);
  });

  it("returns 404 for an unknown name", async () => {
    const server = withServer();
    const missing = await fetch(`${server.url}/v1/marketplaces/no-such-market`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: "not_found",
      message: "Marketplace not found: no-such-market",
    });
  });

  it("returns 400 when the decoded name is empty", async () => {
    const server = withServer();
    const empty = await fetch(`${server.url}/v1/marketplaces/${encodeURIComponent("  ")}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toEqual({
      error: "invalid_name",
      message: "name is required",
    });
  });

  it("does not treat /plugins as a marketplace name", async () => {
    const request = new Request(
      "http://127.0.0.1/v1/marketplaces/demo/plugins",
      { method: "DELETE" },
    );
    const result = await tryHandle(request, "token", {
      isAgentSwitchInProgress: () => false,
    });
    expect(result).toBeNull();
  });
});
