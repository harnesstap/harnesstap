import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../../helpers/db.ts";
import type { TestContext } from "../../helpers/db.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  getPluginResources,
} from "../../../src/models/plugin-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import {
  addDependency,
  listDependencies,
} from "../../../src/services/plugin-dependency.ts";
import {
  buildApPackageFiles,
  writeApPackageFiles,
} from "../../../src/services/agent-plugins/files.ts";
import {
  importApPackageFiles,
  parseApPackageFiles,
  readApPackage,
} from "../../../src/services/agent-plugins/import.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("ap-import-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function seedSource(): string {
  const plugin = createPlugin({ name: "My Plugin", version: "1.2.0", description: "d" });
  addResourceToPlugin(
    plugin.id,
    createResource({
      type: "skill",
      name: "deploy",
      description: "Deployment workflow",
      content: "# Deploy",
      metadata: {},
      source: "test",
    }).id,
  );
  addResourceToPlugin(
    plugin.id,
    createResource({
      type: "rule",
      name: "style",
      description: "Style rule",
      content: "Use tabs.",
      metadata: { globs: ["**/*.ts"], always_apply: false },
      source: "test",
    }).id,
  );
  return plugin.id;
}

describe("parseApPackageFiles", () => {
  it("round-trips a plugin through build and parse", () => {
    const parsed = parseApPackageFiles(buildApPackageFiles(seedSource()));
    expect(parsed.name).toBe("my-plugin");
    expect(parsed.sourceName).toBe("My Plugin");
    expect(parsed.version).toBe("1.2.0");
    expect(parsed.resources.map((r) => `${r.type}:${r.name}`).sort()).toEqual([
      "rule:style",
      "skill:deploy",
    ]);
    expect(parsed.resources.find((r) => r.type === "rule")?.metadata).toMatchObject({
      globs: ["**/*.ts"],
      always_apply: false,
    });
  });

  it("restores dependencies from the extension", () => {
    createPlugin({ name: "base" });
    const source = createPlugin({ name: "root" });
    addDependency(source.id, "base", { versionConstraint: "^2.0.0" });
    expect(parseApPackageFiles(buildApPackageFiles(source.id)).dependencies).toEqual([
      { name: "base", constraint: "^2.0.0", source: "local" },
    ]);
  });

  it("reads a third-party package with no HarnessTap extension", () => {
    const parsed = parseApPackageFiles({
      "plugin.json": {
        encoding: "utf8",
        content: JSON.stringify({
          $schema: "https://agentplugins.org/schema/v1/plugin.schema.json",
          name: "hello",
          version: "1.0.0",
        }),
      },
      "skills/hello/SKILL.md": {
        encoding: "utf8",
        content: "---\nname: hello\ndescription: Says hi\n---\n\n# Hello\n",
      },
    });
    expect(parsed.sourceName).toBe("hello");
    expect(parsed.dependencies).toEqual([]);
    expect(parsed.profile).toBe(false);
    expect(parsed.overrides).toEqual({ versions: {}, resources: {} });
    expect(parsed.resources).toHaveLength(1);
    expect(parsed.resources[0]).toMatchObject({ type: "skill", name: "hello" });
  });

  it("rejects a package whose manifest fails validation", () => {
    expect(() =>
      parseApPackageFiles({
        "plugin.json": { encoding: "utf8", content: JSON.stringify({ name: "x" }) },
      }),
    ).toThrow(/\$schema/);
  });

  it("rejects a package with no plugin.json", () => {
    expect(() =>
      parseApPackageFiles({
        "skills/a/SKILL.md": { encoding: "utf8", content: "---\nname: a\n---\n" },
      }),
    ).toThrow(/plugin\.json/);
  });

  it("ignores a component path the manifest declares but the package omits", () => {
    const files = buildApPackageFiles(seedSource());
    delete files["com.harnesstap/rules/style.md"];
    const parsed = parseApPackageFiles(files);
    expect(parsed.resources.map((r) => r.type)).toEqual(["skill"]);
  });
});

describe("readApPackage", () => {
  it("reads from a directory", () => {
    const dir = join(ctx.projectDir, "pkg");
    writeApPackageFiles(buildApPackageFiles(seedSource()), dir);
    expect(readApPackage(dir).sourceName).toBe("My Plugin");
  });

  it("rejects a directory with a symlink escaping the root", () => {
    const dir = join(ctx.projectDir, "leaky");
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(
      join(dir, "plugin.json"),
      JSON.stringify({
        $schema: "https://agentplugins.org/schema/v1/plugin.schema.json",
        name: "leaky",
        version: "1.0.0",
      }),
    );
    symlinkSync(ctx.homeDir, join(dir, "skills", "leak"));
    expect(() => readApPackage(dir)).toThrow(/escapes the package root/);
  });
});

describe("importApPackageFiles", () => {
  it("creates an authored plugin with resources and dependencies", () => {
    createPlugin({ name: "base" });
    const source = createPlugin({ name: "My Plugin", version: "1.2.0" });
    addDependency(source.id, "base", { versionConstraint: "^1.0.0" });
    addResourceToPlugin(
      source.id,
      createResource({
        type: "skill",
        name: "deploy",
        description: "d",
        content: "# D",
        metadata: {},
        source: "test",
      }).id,
    );
    const files = buildApPackageFiles(source.id);

    const imported = importApPackageFiles(files, { as: "imported" });
    expect(imported.name).toBe("imported");
    expect(getPluginByName("imported")).toBeDefined();
    expect(getPluginResources(imported.id).map((r) => r.name)).toContain("deploy");
    expect(listDependencies(imported.id).map((d) => d.name)).toEqual(["base"]);
  });

  it("restores the local name when no override is given", () => {
    const files = buildApPackageFiles(seedSource());
    // Re-import into a fresh context so the name is free.
    expect(importApPackageFiles(files, { as: "restored" }).name).toBe("restored");
    expect(parseApPackageFiles(files).sourceName).toBe("My Plugin");
  });

  it("marks the imported plugin authored by default", () => {
    const imported = importApPackageFiles(buildApPackageFiles(seedSource()), {
      as: "authored-copy",
    });
    expect(imported.origin).toBe("authored");
  });

  it("honors an explicit origin", () => {
    const imported = importApPackageFiles(buildApPackageFiles(seedSource()), {
      as: "catalog-copy",
      origin: "catalog",
    });
    expect(imported.origin).toBe("catalog");
  });
});
