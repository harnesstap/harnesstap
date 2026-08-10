import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../../helpers/db.ts";
import type { TestContext } from "../../helpers/db.ts";
import { createPlugin, setPluginTags } from "../../../src/models/plugin-model.ts";
import { addDependency } from "../../../src/services/plugin-dependency.ts";
import { setPluginVersionOverride } from "../../../src/services/plugin-overrides.ts";
import { buildApManifest } from "../../../src/services/agent-plugins/manifest.ts";
import { validateApManifest } from "../../../src/services/agent-plugins/validate.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("ap-manifest-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("buildApManifest", () => {
  it("puts only AP core fields at the top level", () => {
    const plugin = createPlugin({ name: "My Plugin", version: "1.2.0", description: "d" });
    const manifest = buildApManifest(plugin.id);
    expect(Object.keys(manifest).sort()).toEqual([
      "$schema",
      "description",
      "extensions",
      "name",
      "version",
    ]);
    expect(manifest.name).toBe("my-plugin");
    expect(() => validateApManifest(manifest)).not.toThrow();
  });

  it("records the unslugged local name under the extension", () => {
    const plugin = createPlugin({ name: "My Plugin" });
    expect(buildApManifest(plugin.id).extensions?.["com.harnesstap"]?.sourceName).toBe(
      "My Plugin",
    );
  });

  it("records dependencies with constraint and source", () => {
    createPlugin({ name: "base" });
    const plugin = createPlugin({ name: "root" });
    addDependency(plugin.id, "base", { versionConstraint: "^2.0.0" });
    addDependency(plugin.id, "web-search@anthropics");
    expect(buildApManifest(plugin.id).extensions?.["com.harnesstap"]?.dependencies).toEqual([
      { name: "base", constraint: "^2.0.0", source: "local" },
      { name: "web-search", constraint: "*", source: "marketplace" },
    ]);
  });

  it("records overrides and the profile flag", () => {
    createPlugin({ name: "base", version: "2.1.0" });
    const plugin = createPlugin({ name: "root" });
    setPluginTags(plugin.id, ["profile"]);
    setPluginVersionOverride(plugin.id, "base", "2.1.0");
    const extension = buildApManifest(plugin.id).extensions?.["com.harnesstap"];
    expect(extension?.profile).toBe(true);
    expect(extension?.overrides).toEqual({ versions: { base: "2.1.0" }, resources: {} });
  });

  it("omits component pointers for types the plugin has none of", () => {
    const plugin = createPlugin({ name: "empty" });
    expect(buildApManifest(plugin.id).extensions?.["com.harnesstap"]?.components).toEqual({});
  });
});
