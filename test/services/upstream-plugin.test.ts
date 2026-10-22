import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as pluginInstall from "../../src/services/plugin-install.ts";
import { syncPluginPinsForApply } from "../../src/services/plugin-pin-apply.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import { createPlugin, getPluginById, getPluginByName, getPluginResources } from "../../src/models/plugin-model.ts";
import { getPluginOrigin } from "../../src/services/plugin-origin.ts";
import { listResources } from "../../src/models/resource.ts";
import { syncPluginResource } from "../../src/services/resource-sync.ts";
import { materializeUpstreamPlugin } from "../../src/services/upstream-plugin.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("upstream-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function linkedSkill(name: string, ref: string): void {
  createResource({
    type: "skill",
    name,
    description: "",
    content: `# ${name}`,
    metadata: {},
    source: "plugin",
    namespace: ref,
    origin_kind: "marketplace_link",
    origin_ref: ref,
  });
}

describe("materializeUpstreamPlugin", () => {
  it("groups an install tree's resources into an upstream plugin", () => {
    linkedSkill("search", "web-search@anthropics");
    linkedSkill("summarize", "web-search@anthropics");

    const plugin = materializeUpstreamPlugin({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });

    expect(plugin.name).toBe("web-search");
    expect(plugin.version).toBe("1.2.0");
    expect(getPluginOrigin(plugin.id)).toBe("upstream");
    expect(getPluginResources(plugin.id).map((r) => r.name).sort()).toEqual([
      "search",
      "summarize",
    ]);
    expect(getPluginById(plugin.id)?.origin_locator).toBe("web-search@anthropics");
  });

  it("is idempotent for the same ref and version", () => {
    linkedSkill("search", "web-search@anthropics");
    const first = materializeUpstreamPlugin({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });
    const second = materializeUpstreamPlugin({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });
    expect(second.id).toBe(first.id);
  });

  it("creates a separate row for a new upstream version", () => {
    linkedSkill("search", "web-search@anthropics");
    const v1 = materializeUpstreamPlugin({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });
    const v2 = materializeUpstreamPlugin({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.3.0",
    });
    expect(v2.id).not.toBe(v1.id);
    expect(getPluginByName("web-search", "1.2.0")).toBeDefined();
    expect(getPluginByName("web-search", "1.3.0")).toBeDefined();
  });

  it("refuses to overwrite an authored plugin of the same name", () => {
    createResource({
      type: "skill",
      name: "search",
      description: "",
      content: "x",
      metadata: {},
      source: "plugin",
      namespace: "web-search@anthropics",
      origin_kind: "marketplace_link",
      origin_ref: "web-search@anthropics",
    });
    // An authored plugin already owns the name at that version.
    createPlugin({ name: "web-search", version: "1.2.0" });

    expect(() =>
      materializeUpstreamPlugin({
        ref: "web-search@anthropics",
        name: "web-search",
        version: "1.2.0",
      }),
    ).toThrow(/authored/);
  });

  describe("two marketplaces shipping the same plugin name", () => {
    function pluginPin(ref: string, namespace: string) {
      return createResource({
        type: "plugin",
        name: "dup",
        description: "",
        content: "",
        metadata: { source_kind: "marketplace", resolved_version: "1.0.0" },
        source: "marketplace",
        namespace,
        origin_kind: "marketplace_link",
        origin_ref: ref,
      });
    }

    it("refuses the second marketplace and keeps the first one's resources", async () => {
      pluginPin("dup@mkta", "mkta");
      linkedSkill("dup-skill", "dup@mkta");
      const first = materializeUpstreamPlugin({ ref: "dup@mkta", name: "dup", version: "1.0.0" });
      const second = pluginPin("dup@mktb", "mktb");

      expect(() =>
        materializeUpstreamPlugin({ ref: "dup@mktb", name: "dup", version: "1.0.0" }),
      ).toThrow('dup@mktb and dup@mkta are both named "dup"');
      await expect(syncPluginResource(second, { policy: "overwrite" })).rejects.toThrow(
        "Delete dup@mkta from the library first to use dup@mktb.",
      );

      expect(getPluginById(first.id)?.origin_locator).toBe("dup@mkta");
      const skills = listResources({ type: "skill", includeComposition: true })
        .filter((row) => row.name === "dup-skill");
      expect(skills.map((row) => row.origin_ref)).toEqual(["dup@mkta"]);
    });

    it("refuses the second marketplace before installing it", async () => {
      pluginPin("dup@mkta", "mkta");
      linkedSkill("dup-skill", "dup@mkta");
      materializeUpstreamPlugin({ ref: "dup@mkta", name: "dup", version: "1.0.0" });
      const install = spyOn(pluginInstall, "installPluginPins");
      try {
        await expect(
          syncPluginPinsForApply({
            pins: [{ ref: "dup@mktb", version_constraint: "1.0.0" }],
            homeRoot: ctx.homeDir,
            yes: true,
          }),
        ).rejects.toThrow('dup@mktb and dup@mkta are both named "dup"');
        expect(install).not.toHaveBeenCalled();
      } finally {
        install.mockRestore();
      }
    });

    it("lets the second marketplace take the name once the first pin is deleted", () => {
      linkedSkill("dup-skill", "dup@mkta");
      materializeUpstreamPlugin({ ref: "dup@mkta", name: "dup", version: "1.0.0" });
      pluginPin("dup@mktb", "mktb");

      const plugin = materializeUpstreamPlugin({ ref: "dup@mktb", name: "dup", version: "1.0.0" });
      expect(getPluginById(plugin.id)?.origin_locator).toBe("dup@mktb");
    });
  });
});
