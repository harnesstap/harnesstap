import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { createAgentFetchHandler } from "../../src/agent/routes.ts";
import { writeAgentTokenFile } from "../../src/agent/token.ts";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";

describe("agent profile stash routes", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = previousHome;
    }
  });

  function withHandler() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-stash-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    process.env.HOME = dir;
    initializeSchema(getDb());
    const token = "test-token";
    writeAgentTokenFile(join(dir, ".harnesstap"), token);
    return {
      token,
      fetch: createAgentFetchHandler(token, 7474),
      homeDir: dir,
    };
  }

  it("lists, stashes untracked resources, and pops them back", async () => {
    const { token, fetch, homeDir } = withHandler();

    const profile = createPlugin({ name: "work" });
    setPluginTags(profile.id, ["profile"]);
    addResourceToPlugin(
      profile.id,
      createResource({
        type: "skill",
        name: "demo",
        description: "demo",
        content: "# Demo",
        metadata: {},
        source: "manual",
      }).id,
    );
    await applyProfilePlugin("work", {
      harness: "claude-code",
      conflictPolicy: "replace",
    });
    setActiveProfileName("work");
    mkdirSync(join(homeDir, ".claude/skills/manual-skill"), { recursive: true });
    writeFileSync(
      join(homeDir, ".claude/skills/manual-skill/SKILL.md"),
      "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
      "utf-8",
    );

    const emptyList = await fetch(
      new Request("http://127.0.0.1/v1/profiles/stash", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(emptyList.status).toBe(200);
    await expect(emptyList.json()).resolves.toEqual({ entries: [] });

    const stashed = await fetch(
      new Request("http://127.0.0.1/v1/profiles/stash", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ harness: "claude-code" }),
      }),
    );
    expect(stashed.status).toBe(200);
    const stashBody = (await stashed.json()) as {
      entry: { profile_name: string; contents: { resources: Array<{ name: string }> } };
    };
    expect(stashBody.entry.profile_name).toBe("work");
    expect(stashBody.entry.contents.resources.map((resource) => resource.name)).toEqual([
      "manual-skill",
    ]);
    expect(existsSync(join(homeDir, ".claude/skills/manual-skill/SKILL.md"))).toBe(false);
    expect(existsSync(join(homeDir, ".claude/skills/demo/SKILL.md"))).toBe(true);

    const listed = await fetch(
      new Request("http://127.0.0.1/v1/profiles/stash", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { entries: Array<{ profile_name: string }> };
    expect(listBody.entries).toHaveLength(1);

    const restored = await fetch(
      new Request("http://127.0.0.1/v1/profiles/stash/pop", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ harness: "claude-code" }),
      }),
    );
    expect(restored.status).toBe(200);
    expect(existsSync(join(homeDir, ".claude/skills/manual-skill/SKILL.md"))).toBe(true);
  });
});
