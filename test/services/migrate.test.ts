import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createEnvironment } from "../../src/models/environment.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  exportMigrationState,
  importMigrationState,
} from "../../src/services/migrate.ts";
import { assertArchiveMembersContained } from "../../src/utils/path-containment.ts";

describe("migrate archive containment", () => {
  it("rejects path-traversal members listed in the archive before extract", () => {
    // Host tar (bsdtar) often refuses to *create* `../` members, so assert the
    // pre-extract member check directly — that is the hardening that closes the
    // hole a post-walk cannot see.
    const dest = mkdtempSync(join(tmpdir(), "migrate-dest-"));
    try {
      expect(() =>
        assertArchiveMembersContained(dest, ["manifest.json", "../escape.txt"]),
      ).toThrow(/escapes the package root/);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it("refuses an archive containing a symlink that escapes the destination", () => {
    // Post-extract walk still catches in-tree symlink escapes.
    const parent = mkdtempSync(join(tmpdir(), "evil-parent-"));
    const staging = join(parent, "pkg");
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "s");
    writeFileSync(join(staging, "manifest.json"), "{}");
    mkdirSync(join(staging, "nested"), { recursive: true });
    writeFileSync(join(staging, "nested", "ok.txt"), "ok");
    symlinkSync(outside, join(staging, "leak"));
    const archive = join(parent, "evil.tar.gz");
    execSync(`tar -czf ${archive} -C ${staging} .`);

    expect(() => importMigrationState({ archivePath: archive })).toThrow(
      /escapes the package root/,
    );
    rmSync(parent, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("migrate workspace AP packages", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createInitializedTestContext("migrate-ap-");
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("stores each plugin as an AP package inside the archive", () => {
    const plugin = createPlugin({ name: "planner", version: "1.0.0" });
    addResourceToPlugin(
      plugin.id,
      createResource({
        type: "skill",
        name: "plan",
        description: "Planning",
        content: "# Plan",
        metadata: {},
        source: "test",
      }).id,
    );

    const archive = join(ctx.projectDir, "backup.tar.gz");
    const manifest = exportMigrationState({ outputPath: archive, includePlugins: false });
    expect(manifest.plugins).toContain("planner");

    const extracted = mkdtempSync(join(tmpdir(), "extract-"));
    execSync(`tar -xzf ${archive} -C ${extracted}`);
    expect(existsSync(join(extracted, "plugins", "planner", "plugin.json"))).toBe(true);
    expect(existsSync(join(extracted, "plugins", "planner", "skills", "plan", "SKILL.md"))).toBe(
      true,
    );
    expect(existsSync(join(extracted, "manifest.json"))).toBe(true);
    rmSync(extracted, { recursive: true, force: true });
  });

  it("round-trips plugins and environments through the archive", async () => {
    createEnvironment({ name: "work", description: "Work env" });
    const plugin = createPlugin({ name: "planner", version: "1.0.0" });
    addResourceToPlugin(
      plugin.id,
      createResource({
        type: "skill",
        name: "plan",
        description: "Planning",
        content: "# Plan",
        metadata: {},
        source: "test",
      }).id,
    );
    const archive = join(ctx.projectDir, "backup.tar.gz");
    exportMigrationState({ outputPath: archive, includePlugins: false });

    ctx.connection.closeDb();
    const fresh = await createInitializedTestContext("migrate-restore-");
    try {
      const result = importMigrationState({ archivePath: archive });
      expect(result.plugins_imported).toBe(1);
      expect(result.environments_imported).toBe(1);
      expect(getPluginByName("planner")).toBeDefined();
    } finally {
      await fresh.cleanup();
    }
  });

  it("refuses an archive whose plugin directory has no plugin.json", () => {
    const staging = mkdtempSync(join(tmpdir(), "bad-archive-"));
    mkdirSync(join(staging, "plugins", "broken"), { recursive: true });
    writeFileSync(join(staging, "plugins", "broken", "notes.md"), "x");
    writeFileSync(
      join(staging, "manifest.json"),
      JSON.stringify({ version: 2, plugins: ["broken"], environments: [] }),
    );
    const archive = join(ctx.projectDir, "broken.tar.gz");
    execSync(`tar -czf ${archive} -C ${staging} .`);

    expect(() => importMigrationState({ archivePath: archive })).toThrow(/plugin\.json/);
    rmSync(staging, { recursive: true, force: true });
  });
});
