import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { addResourceToPlugin, createPlugin } from "../../../src/models/plugin-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import {
  AP_PACKAGE_SCHEMA,
  buildApPackageFiles,
  readApPackageFiles,
  writeApPackageFiles,
} from "../../../src/services/agent-plugins/files.ts";
import { validateApManifest } from "../../../src/services/agent-plugins/validate.ts";
import type { TestContext } from "../../helpers/db.ts";
import { createInitializedTestContext } from "../../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("ap-files-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function attach(pluginId: string, input: Parameters<typeof createResource>[0]): void {
  addResourceToPlugin(pluginId, createResource(input).id);
}

function seed(): string {
  const plugin = createPlugin({ name: "my-plugin", version: "1.2.0", description: "d" });
  attach(plugin.id, {
    type: "skill",
    name: "deploy",
    description: "Deployment workflow",
    content: "# Deploy\n\nSteps.",
    metadata: {},
    source: "test",
  });
  attach(plugin.id, {
    type: "mcp_server",
    name: "search",
    description: "",
    content: "",
    metadata: { transport: "stdio", command: "npx", args: ["-y", "search"] },
    source: "test",
  });
  attach(plugin.id, {
    type: "rule",
    name: "style",
    description: "Style rule",
    content: "Use tabs.",
    metadata: { globs: ["**/*.ts"], always_apply: false },
    source: "test",
  });
  attach(plugin.id, {
    type: "env_var",
    name: "TOKEN",
    description: "",
    content: "",
    metadata: { key: "TOKEN", value: "${TOKEN}" },
    source: "test",
  });
  return plugin.id;
}

describe("AP_PACKAGE_SCHEMA", () => {
  it("is the envelope and wire URN", () => {
    expect(AP_PACKAGE_SCHEMA).toBe("urn:harnesstap:ap-package:v1");
  });
});

describe("buildApPackageFiles", () => {
  it("keys every package path by relative path", () => {
    expect(Object.keys(buildApPackageFiles(seed())).sort()).toEqual([
      "com.harnesstap/env.toml",
      "com.harnesstap/rules/style.md",
      "mcp.json",
      "plugin.json",
      "skills/deploy/SKILL.md",
    ]);
  });

  it("writes a valid manifest", () => {
    const manifest = JSON.parse(
      buildApPackageFiles(seed())["plugin.json"]!.content,
    ) as Record<string, unknown>;
    expect(() => validateApManifest(manifest)).not.toThrow();
  });

  it("writes skills in the standard layout with frontmatter", () => {
    const skill = buildApPackageFiles(seed())["skills/deploy/SKILL.md"]!.content;
    expect(skill.startsWith("---")).toBe(true);
    expect(skill).toContain("name: deploy");
    expect(skill).toContain("description: Deployment workflow");
    expect(skill).toContain("# Deploy");
  });

  it("writes mcp.json in the Agent Plugins 1.0.0 shape", () => {
    const files = buildApPackageFiles(seed());
    const mcp = JSON.parse(files["mcp.json"]!.content) as Record<string, unknown>;
    expect(mcp).toEqual({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { search: { type: "stdio", command: "npx", args: ["-y", "search"] } },
    });
    expect(files["com.harnesstap/mcp.toml"]).toBeUndefined();
  });

  it("stores env vars as references, never resolved values", () => {
    const env = parseToml(
      buildApPackageFiles(seed())["com.harnesstap/env.toml"]!.content,
    ) as { vars?: Record<string, string> };
    expect(env.vars?.TOKEN).toBe("${TOKEN}");
  });

  it("omits mcp.json when the plugin has no MCP servers", () => {
    const plugin = createPlugin({ name: "bare" });
    expect(Object.keys(buildApPackageFiles(plugin.id))).toEqual(["plugin.json"]);
  });

  it("marks text entries as utf8", () => {
    expect(buildApPackageFiles(seed())["plugin.json"]?.encoding).toBe("utf8");
  });

  it("is deterministic across calls", () => {
    const id = seed();
    expect(JSON.stringify(buildApPackageFiles(id))).toBe(
      JSON.stringify(buildApPackageFiles(id)),
    );
  });

  it("renames a skill that is not an Agent Skills name and keeps the original", () => {
    const plugin = createPlugin({ name: "evil" });
    attach(plugin.id, {
      type: "skill",
      name: "../escape",
      description: "Leaves the package",
      content: "x",
      metadata: {},
      source: "test",
    });
    const warnings: string[] = [];
    const files = buildApPackageFiles(plugin.id, { warnings });
    expect(files["skills/escape/SKILL.md"]?.content).toContain("name: escape");
    expect(Object.keys(files).some((path) => path.split("/").includes(".."))).toBe(false);
    const manifest = JSON.parse(files["plugin.json"]!.content) as {
      extensions: { "com.harnesstap": { skillNames?: Record<string, string> } };
    };
    expect(manifest.extensions["com.harnesstap"].skillNames).toEqual({ escape: "../escape" });
    expect(warnings.join("\n")).toContain("renamed");
  });
});

describe("writeApPackageFiles / readApPackageFiles", () => {
  it("round-trips through a directory byte for byte", () => {
    const files = buildApPackageFiles(seed());
    const dir = join(ctx.projectDir, "pkg");
    writeApPackageFiles(files, dir);
    expect(existsSync(join(dir, "skills", "deploy", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(dir, "plugin.json"), "utf8")).toBe(files["plugin.json"]?.content);
    expect(readApPackageFiles(dir)).toEqual(files);
  });

  it("refuses a map entry that escapes the target directory", () => {
    expect(() =>
      writeApPackageFiles(
        { "../escape.md": { encoding: "utf8", content: "x" } },
        join(ctx.projectDir, "evil"),
      ),
    ).toThrow(/escapes the package root/);
  });
});
