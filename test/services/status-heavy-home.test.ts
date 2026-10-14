import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { addResourceToPlugin } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { bootstrapLocalLibrary } from "../../src/services/bootstrap-local-library.ts";
import { loadGlobalProfileStatusSnapshot } from "../../src/services/global-profile-drift.ts";
import { clearLiveReadCaches } from "../../src/services/live-read-cache.ts";
import { setStatusComputationSlotsDisabledForTests } from "../../src/services/status-computation.ts";
import { createTestContext } from "../helpers/db.ts";

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function writePlugin(dir: string, name: string, version: string, manifestDir: string): void {
  write(join(dir, manifestDir, "plugin.json"), JSON.stringify({ name, version, description: `${name} plugin` }));
  for (let index = 0; index < 2; index += 1) {
    const skill = `${name}-s${index}`;
    write(join(dir, "skills", skill, "SKILL.md"), `---\nname: ${skill}\ndescription: Skill ${skill}.\n---\n# ${skill}\n`);
    write(join(dir, "skills", skill, "ref.md"), "# ref\n");
  }
  write(join(dir, "agents", `${name}-agent.md`), `---\nname: ${name}-agent\ndescription: agent\n---\nHello.\n`);
  write(join(dir, "commands", `${name}-cmd.md`), "---\ndescription: cmd\n---\nRun.\n");
  write(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { [`${name}-mcp`]: { command: "npx", args: [name] } } }));
}

/** Several marketplaces, two versions per plugin, Cursor caches, and home resources. */
function writeHeavyHome(home: string): void {
  const claude = join(home, ".claude", "plugins");
  const installed: Record<string, unknown[]> = {};
  const known: Record<string, unknown> = {};
  const enabled: Record<string, boolean> = {};
  for (let market = 0; market < 3; market += 1) {
    const marketplace = `mkt${market}`;
    known[marketplace] = {
      source: { source: "github", repo: `org/${marketplace}` },
      installLocation: join(claude, "marketplaces", marketplace),
    };
    const listed: unknown[] = [];
    for (let index = 0; index < 8; index += 1) {
      const name = `p${market}-${index}`;
      listed.push({ name, source: `./plugins/${name}` });
      for (const version of ["1.0.0", "1.1.0"]) {
        writePlugin(join(claude, "cache", marketplace, name, version), name, version, ".claude-plugin");
      }
      installed[`${name}@${marketplace}`] = [
        { scope: "user", installPath: join(claude, "cache", marketplace, name, "1.1.0"), version: "1.1.0" },
      ];
      enabled[`${name}@${marketplace}`] = index % 3 !== 0;
    }
    write(
      join(claude, "marketplaces", marketplace, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ name: marketplace, owner: { name: "o" }, plugins: listed }),
    );
  }
  write(join(claude, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: installed }));
  write(join(claude, "known_marketplaces.json"), JSON.stringify(known));
  write(join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: enabled }));
  write(join(home, ".claude", "CLAUDE.md"), "# guide\n");
  for (let index = 0; index < 6; index += 1) {
    write(join(home, ".claude", "skills", `home-${index}`, "SKILL.md"), `---\nname: home-${index}\ndescription: h\n---\n# h\n`);
  }
  const cursor = join(home, ".cursor", "plugins");
  for (let index = 0; index < 6; index += 1) {
    writePlugin(join(cursor, "cache", "cursor-public", `c-${index}`, `abc12${index}def456`), `c-${index}`, "1.0.0", ".cursor-plugin");
  }
  writePlugin(join(cursor, "local", "homemade"), "homemade", "0.1.0", ".cursor-plugin");
  write(join(home, ".cursor", "projects", "mcps", "plugin-c-0-c-0", "tools", "t.json"), "{}");
  write(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { local: { command: "npx", args: ["x"] } } }));
}

function stable(value: unknown): string {
  const copy = structuredClone(value) as { as_of?: string };
  copy.as_of = "";
  return JSON.stringify(copy);
}

describe("status on a heavy home", () => {
  afterEach(() => {
    setStatusComputationSlotsDisabledForTests(false);
    clearLiveReadCaches();
  });

  it("returns the same status with shared reads as without them", async () => {
    const context = await createTestContext("status-heavy-home");
    try {
      writeHeavyHome(context.homeDir);
      await bootstrapLocalLibrary();
      setHarnessPreference({ registered_harnesses: ["claude-code", "cursor", "codex"] });
      const db = getDb();
      const profile = db.prepare<{ id: string }>("SELECT id FROM plugins WHERE name = ?").get("global default");
      expect(profile).toBeDefined();
      const pins = db.prepare<{ id: string }>("SELECT id FROM resources WHERE type = 'plugin'").all();
      expect(pins.length).toBeGreaterThanOrEqual(24);
      for (const pin of pins) addResourceToPlugin(profile!.id, pin.id);
      // The first read creates upstream plugin rows. Compare steady state.
      await loadGlobalProfileStatusSnapshot({ depth: "full" });

      setStatusComputationSlotsDisabledForTests(true);
      const uncached = await loadGlobalProfileStatusSnapshot({ depth: "full" });
      setStatusComputationSlotsDisabledForTests(false);
      const shared = await loadGlobalProfileStatusSnapshot({ depth: "full" });
      expect(stable(shared.value)).toBe(stable(uncached.value));
      expect([...shared.watchedPaths].sort()).toEqual([...uncached.watchedPaths].sort());

      // A profile link changes the status the same way on both paths.
      addResourceToPlugin(
        profile!.id,
        createResource({ type: "skill", name: "linked", description: "", content: "# linked\n", metadata: {}, source: "manual" }).id,
      );
      setStatusComputationSlotsDisabledForTests(true);
      const uncachedAfter = await loadGlobalProfileStatusSnapshot({ depth: "full" });
      setStatusComputationSlotsDisabledForTests(false);
      const sharedAfter = await loadGlobalProfileStatusSnapshot({ depth: "full" });
      expect(stable(sharedAfter.value)).toBe(stable(uncachedAfter.value));
      expect(stable(sharedAfter.value)).not.toBe(stable(shared.value));
    } finally {
      await context.cleanup();
    }
  });

  it("does not write the database on a steady-state status read", async () => {
    const context = await createTestContext("status-heavy-home-writes");
    try {
      writeHeavyHome(context.homeDir);
      await bootstrapLocalLibrary();
      setHarnessPreference({ registered_harnesses: ["claude-code", "cursor"] });
      const db = getDb();
      const profile = db.prepare<{ id: string }>("SELECT id FROM plugins WHERE name = ?").get("global default");
      for (const pin of db.prepare<{ id: string }>("SELECT id FROM resources WHERE type = 'plugin'").all()) {
        addResourceToPlugin(profile!.id, pin.id);
      }
      await loadGlobalProfileStatusSnapshot({ depth: "full" });
      const { readStatusWriteGeneration } = await import("../../src/db/write-generation.ts");
      const before = readStatusWriteGeneration();
      await loadGlobalProfileStatusSnapshot({ depth: "full" });
      expect(readStatusWriteGeneration()).toBe(before);
    } finally {
      await context.cleanup();
    }
  });
});
