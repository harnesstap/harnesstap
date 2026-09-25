import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("agent harness sync route", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) delete process.env.HARNESSTAP_HOME;
    else process.env.HARNESSTAP_HOME = previousHome;
  });

  async function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-harness-sync-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    const server = await startAgentServer({ port: 0 });
    servers.push(server);
    return { server, dir };
  }

  it("POST /v1/harness/sync requires two configured harnesses", async () => {
    const { server } = await withServer();
    setHarnessPreference({
      main_harness: "claude-code",
      alias_harnesses: [],
    });
    const response = await fetch(`${server.url}/v1/harness/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("need_two_harnesses");
  });

  it("POST /v1/harness/sync dry-run unions configured home harnesses", async () => {
    const { server, dir } = await withServer();
    setHarnessPreference({
      main_harness: "claude-code",
      alias_harnesses: ["cursor"],
    });
    writeTextFile(
      join(dir, ".claude/skills/alpha/SKILL.md"),
      "---\nname: alpha\n---\nfrom claude\n",
    );
    const response = await fetch(`${server.url}/v1/harness/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ dry_run: true }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { platforms_synced: string[] };
    expect(body.platforms_synced.sort()).toEqual(["claude-code", "cursor"]);
  });
});
