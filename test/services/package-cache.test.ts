import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("package cache (option C)", () => {
  it("ingests host plugin trees into ~/.harnesstap/cache/packages and resolves from canonical root", async () => {
    const context = await createInitializedTestContext("package-cache-ingest");
    try {
      const home = context.homeDir;
      const hostTree = join(
        home,
        ".claude",
        "plugins",
        "cache",
        "demo-mkt",
        "demo-plugin",
        "1.0.0",
      );
      mkdirSync(join(hostTree, "skills", "hello"), { recursive: true });
      writeTextFile(
        join(hostTree, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "demo-plugin", version: "1.0.0" }),
      );
      writeTextFile(
        join(hostTree, "skills", "hello", "SKILL.md"),
        "---\nname: hello\n---\nbody\n",
      );

      const { ingestHostPluginTreeIntoCache, resolveCanonicalHostPluginRoot } =
        await import("../../src/services/package-cache/host-plugin.ts");
      const harnesstapDir = join(home, ".harnesstap");
      mkdirSync(harnesstapDir, { recursive: true });
      const canonical = ingestHostPluginTreeIntoCache({
        harnesstapDir,
        homeRoot: home,
        originRef: "demo-plugin@demo-mkt",
        sourceInstallRoot: hostTree,
        version: "1.0.0",
      });

      expect(canonical).not.toBe(hostTree);
      expect(existsSync(join(canonical, "skills", "hello", "SKILL.md"))).toBe(true);
      expect(
        resolveCanonicalHostPluginRoot({
          harnesstapDir,
          originRef: "demo-plugin@demo-mkt",
          version: "1.0.0",
        }),
      ).toBe(canonical);
    } finally {
      await context.cleanup();
    }
  });

  it("scanner skips plugin-translated skills recorded in plugin_pin_materializations", async () => {
    const context = await createInitializedTestContext("package-cache-scan");
    try {
      const root = context.homeDir;
      const skillDir = join(root, ".agents", "skills", "translated");
      mkdirSync(skillDir, { recursive: true });
      writeTextFile(
        join(skillDir, "SKILL.md"),
        "---\nname: translated\n---\nfrom plugin\n",
      );

      const { upsertPluginPinMaterialization } = await import(
        "../../src/models/plugin-pin-materialization.ts"
      );
      upsertPluginPinMaterialization({
        scope: "global",
        root_path: root,
        relative_path: ".agents/skills/translated",
        origin_ref: "demo@demo-mkt",
        resource_type: "skill",
        resource_name: "translated",
      });

      const { isPluginTranslatedResource } = await import(
        "../../src/services/plugin-translation-marker.ts"
      );
      expect(
        isPluginTranslatedResource(root, {
          type: "skill",
          name: "translated",
          source: ".agents/skills/translated/SKILL.md",
        }),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
