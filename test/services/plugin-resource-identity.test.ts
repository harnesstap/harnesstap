import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createPlugin, getPluginResources, addResourceToPlugin } from "../../src/models/plugin-model.ts";
import { createResource, listResources } from "../../src/models/resource.ts";
import { attachScannedOriginResources } from "../../src/services/plugin-origin-apply.ts";
import { syncPluginResource } from "../../src/services/resource-sync.ts";
import type { ResourceCreateInput } from "../../src/types.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

// `plugin update` and the apply-time pin sync both store a marketplace
// plugin's resources. They must land on one row, or the profile declares the
// same skill twice ("s declared by dupe and dupe").
const REF = "dupe@mkta";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("plugin-resource-identity-");
});
afterEach(async () => {
  await ctx.cleanup();
});

function linkedSkill(namespace: string, content = "# s\n") {
  return createResource({
    type: "skill",
    name: "s",
    description: "",
    content,
    metadata: {},
    source: "skills/s/SKILL.md",
    namespace,
    origin_kind: "marketplace_link",
    origin_ref: REF,
  });
}

function scanned(content: string): ResourceCreateInput {
  return { type: "skill", name: "s", description: "", content, metadata: {}, source: "skills/s/SKILL.md" };
}

function skillRows() {
  return listResources({ type: "skill", includeComposition: true }).filter((row) => row.name === "s");
}

describe("one row per marketplace plugin resource", () => {
  it("plugin update reuses the row the pin sync stored", () => {
    const synced = linkedSkill("dupe");
    const plugin = createPlugin({ name: "dupe", version: "1.1.0" });

    attachScannedOriginResources(plugin.id, [scanned("# s v2\n")], REF);

    const rows = skillRows();
    expect(rows.map((row) => [row.id, row.namespace, row.content])).toEqual([
      [synced.id, "dupe", "# s v2\n"],
    ]);
    expect(getPluginResources(plugin.id).map((row) => row.id)).toEqual([synced.id]);
  });

  it("plugin update drops a duplicate left by an earlier update", () => {
    const synced = linkedSkill("dupe");
    const stale = linkedSkill("");
    const plugin = createPlugin({ name: "dupe", version: "1.1.0" });
    addResourceToPlugin(plugin.id, synced.id);
    addResourceToPlugin(plugin.id, stale.id);

    attachScannedOriginResources(plugin.id, [scanned("# s v2\n")], REF);

    expect(skillRows().map((row) => row.id)).toEqual([synced.id]);
    expect(getPluginResources(plugin.id).map((row) => row.id)).toEqual([synced.id]);
  });

  it("the pin sync reuses the row plugin update stored", async () => {
    const updated = linkedSkill("");
    const root = join(ctx.homeDir, ".claude/plugins/cache/mkta/dupe/1.0.0");
    writeTextFile(join(root, ".claude-plugin/plugin.json"), '{"name":"dupe","version":"1.0.0"}\n');
    writeTextFile(join(root, "skills/s/SKILL.md"), "---\nname: s\ndescription: s\n---\n# s v3\n");
    writeTextFile(
      join(ctx.homeDir, ".claude/plugins/installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { [REF]: [{ scope: "user", installPath: root, version: "1.0.0" }] } }),
    );
    const pin = createResource({
      type: "plugin",
      name: "dupe",
      description: "",
      content: "{}",
      metadata: { source_kind: "marketplace", marketplace_name: "mkta" },
      source: "marketplace",
      namespace: "mkta",
      origin_kind: "marketplace_link",
      origin_ref: REF,
    });

    await syncPluginResource(pin, { homeRoot: ctx.homeDir, policy: "overwrite" });

    const rows = skillRows();
    expect(rows.map((row) => row.id)).toEqual([updated.id]);
    expect(rows[0]?.content).toContain("# s v3");
  });
});
