import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createPlugin, getPluginById } from "../../src/models/plugin-model.ts";
import { buildApPackageFiles } from "../../src/services/agent-plugins/files.ts";
import { importApPackageFiles } from "../../src/services/agent-plugins/import.ts";
import { forkPlugin } from "../../src/services/plugin-fork.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";
import { parseUpstream } from "../../src/services/plugin-upstream.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("plugin-upstream-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function extensionOf(pluginId: string): Record<string, unknown> {
  const files = buildApPackageFiles(pluginId);
  const manifest = JSON.parse(files["plugin.json"]!.content) as {
    extensions: Record<string, Record<string, unknown>>;
  };
  return manifest.extensions["com.harnesstap"]!;
}

describe("upstream link in the package format", () => {
  it("exports a catalog fork as extensions[com.harnesstap].upstream and imports it back", () => {
    createPlugin({
      name: "backend-engineer",
      version: "1.0.0",
      org_slug: "harnesstap-cloud",
      catalog_slug: "default",
      origin: "catalog",
    });
    const { plugin } = forkPlugin("backend-engineer", "backend-qa");

    const upstream = {
      kind: "fork",
      ref: "harnesstap-cloud/default/backend-engineer@^1.0.0",
      version_at_link: "1.0.0",
    };
    expect(extensionOf(plugin.id).upstream).toEqual(upstream);

    const files = buildApPackageFiles(plugin.id);
    const imported = importApPackageFiles(files, { as: "backend-qa-copy", installPackage: false });
    expect(getPluginById(imported.id)?.upstream).toEqual(upstream);
  });

  it("keeps a non-catalog upstream local", () => {
    const source = createPlugin({ name: "web-search", version: "1.2.0" });
    setPluginOrigin(source.id, "upstream");
    const { plugin } = forkPlugin("web-search");
    expect(plugin.upstream?.ref).toBe("web-search@^1.2.0");
    expect(extensionOf(plugin.id).upstream).toBeUndefined();
  });

  it("drops malformed upstream values on import", () => {
    expect(parseUpstream({ kind: "fork", ref: "a/b/c@^1.0.0", version_at_link: "1.0.0" })).toEqual({
      kind: "fork",
      ref: "a/b/c@^1.0.0",
      version_at_link: "1.0.0",
    });
    expect(parseUpstream({ kind: "copy", ref: "a/b/c@^1.0.0", version_at_link: "1.0.0" })).toBeUndefined();
    expect(parseUpstream({ kind: "fork", ref: "c@^1.0.0", version_at_link: "1.0.0" })).toBeUndefined();
    expect(parseUpstream({ kind: "fork", ref: "a/b/c@^1.0.0", version_at_link: "latest" })).toBeUndefined();
    expect(parseUpstream({ kind: "fork", ref: "a/b/c@^1.0.0", versionAtLink: "1.0.0" })).toBeUndefined();
  });
});
