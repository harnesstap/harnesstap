import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { addResourceToPlugin, createPlugin, deletePlugin, getPluginById, getPluginByName } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import type { ApPackageFiles } from "../../src/services/agent-plugins/files.ts";
import { buildApPackageFiles } from "../../src/services/agent-plugins/files.ts";
import { importApPackageFiles } from "../../src/services/agent-plugins/import.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { listPluginExcludes, setPluginExcludes } from "../../src/services/plugin-extends.ts";
import { setPluginUpstream } from "../../src/services/plugin-upstream.ts";
import { resolveComposition } from "../../src/services/resolve/index.ts";
import type { Plugin } from "../../src/types.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("plugin-extends-package-");
});

afterEach(async () => {
  await ctx.cleanup();
});

const UPSTREAM = {
  kind: "extends",
  ref: "acme/default/backend-engineer@^1.0.0",
  version_at_link: "1.0.0",
} as const;

function skill(pluginId: string, name: string): void {
  const resource = createResource({
    type: "skill",
    name,
    description: `${name} skill`,
    content: name,
    metadata: {},
    source: "test",
  });
  addResourceToPlugin(pluginId, resource.id);
}

function catalogParent(): Plugin {
  const parent = createPlugin({
    name: "backend-engineer",
    version: "1.0.0",
    org_slug: "acme",
    catalog_slug: "default",
    origin: "catalog",
  });
  skill(parent.id, "review");
  skill(parent.id, "deploy");
  return parent;
}

function extendsChild(ref: string = UPSTREAM.ref): Plugin {
  const child = createPlugin({ name: "backend-qa", version: "1.0.0", tags: ["profile"] });
  setPluginUpstream(child.id, { kind: "extends", ref, version_at_link: "1.0.0" });
  skill(child.id, "qa-checklist");
  return child;
}

function manifestOf(files: ApPackageFiles, path = "plugin.json"): Record<string, unknown> {
  const manifest = JSON.parse(files[path]!.content) as {
    extensions: Record<string, Record<string, unknown>>;
  };
  return manifest.extensions["com.harnesstap"]!;
}

function withExtension(files: ApPackageFiles, patch: Record<string, unknown>): ApPackageFiles {
  const manifest = JSON.parse(files["plugin.json"]!.content) as {
    name: string;
    extensions: Record<string, Record<string, unknown>>;
  };
  Object.assign(manifest.extensions["com.harnesstap"]!, patch);
  return { ...files, "plugin.json": { ...files["plugin.json"]!, content: JSON.stringify(manifest) } };
}

describe("extends in the package format", () => {
  it("exports upstream (kind extends) and the root exclude, and imports both back", () => {
    catalogParent();
    const child = extendsChild();
    setPluginExcludes(child.id, ["skill:deploy", "plugin:web-search"]);

    const files = buildApPackageFiles(child.id);
    const extension = manifestOf(files);
    expect(extension.upstream).toEqual(UPSTREAM);
    expect(extension.exclude).toEqual(["plugin:web-search", "skill:deploy"]);

    const imported = importApPackageFiles(files, { as: "backend-qa-copy", installPackage: false });
    expect(getPluginById(imported.id)?.upstream).toEqual(UPSTREAM);
    expect(listPluginExcludes(imported.id)).toEqual(["plugin:web-search", "skill:deploy"]);
    expect(
      resolveComposition({ rootSelectors: ["backend-qa-copy"] })
        .resources.map((resource) => resource.name)
        .sort(),
    ).toEqual(["qa-checklist", "review"]);
  });

  it("writes the parent's catalog ref once a local parent lives in a catalog", () => {
    const parent = createPlugin({ name: "backend", version: "1.2.0", org_slug: "acme", catalog_slug: "team" });
    skill(parent.id, "review");
    const child = extendsChild("backend@^1.2.0");
    expect(manifestOf(buildApPackageFiles(child.id)).upstream).toEqual({
      kind: "extends",
      ref: "acme/team/backend@^1.2.0",
      version_at_link: "1.0.0",
    });
  });

  it("writes no link and no exclude while the parent is only local", () => {
    createPlugin({ name: "backend", version: "1.0.0" });
    const child = extendsChild("backend@^1.0.0");
    setPluginExcludes(child.id, ["skill:deploy"]);
    const extension = manifestOf(buildApPackageFiles(child.id));
    expect(extension.upstream).toBeUndefined();
    expect(extension.exclude).toBeUndefined();
  });

  it("ignores exclude on a fork and drops entries with an unknown type", () => {
    catalogParent();
    const child = extendsChild();
    const files = buildApPackageFiles(child.id);

    const fork = importApPackageFiles(
      withExtension(files, { upstream: { ...UPSTREAM, kind: "fork" }, exclude: ["skill:deploy"] }),
      { as: "fork-copy", installPackage: false },
    );
    expect(listPluginExcludes(fork.id)).toEqual([]);

    const mixed = importApPackageFiles(
      withExtension(files, { exclude: ["widget:x", "skill", 7, "skill:deploy"] }),
      { as: "mixed-copy", installPackage: false },
    );
    expect(listPluginExcludes(mixed.id)).toEqual(["skill:deploy"]);
  });

  it("keeps exclude on the root manifest only", () => {
    catalogParent();
    const embeddedChild = extendsChild();
    setPluginExcludes(embeddedChild.id, ["skill:deploy"]);
    const root = createPlugin({ name: "team-root", version: "1.0.0" });
    addDependency(root.id, "backend-qa", { embedOnExport: true });

    const files = buildApPackageFiles(root.id);
    const nestedPath = "com.harnesstap/embedded/backend-qa/plugin.json";
    expect(manifestOf(files, nestedPath).upstream).toEqual(UPSTREAM);
    expect(manifestOf(files, nestedPath).exclude).toBeUndefined();

    // A hand-written nested exclude is ignored on import.
    const nested = JSON.parse(files[nestedPath]!.content) as {
      extensions: Record<string, Record<string, unknown>>;
    };
    nested.extensions["com.harnesstap"]!.exclude = ["skill:deploy"];
    const tampered = { ...files, [nestedPath]: { ...files[nestedPath]!, content: JSON.stringify(nested) } };
    deletePlugin(embeddedChild.id);
    importApPackageFiles(tampered, { as: "team-root-copy", installPackage: false });
    const nestedImport = getPluginByName("backend-qa");
    expect(nestedImport?.upstream).toEqual(UPSTREAM);
    expect(listPluginExcludes(nestedImport!.id)).toEqual([]);
  });

  it("refuses a package that would extend itself, before writing anything", () => {
    const parent = catalogParent();
    setPluginUpstream(parent.id, { kind: "extends", ref: "acme/default/backend-qa@^1.0.0", version_at_link: "1.0.0" });
    const child = extendsChild();
    const files = buildApPackageFiles(child.id);
    expect(() => importApPackageFiles(files, { installPackage: false })).toThrow("is a cycle");
  });
});
