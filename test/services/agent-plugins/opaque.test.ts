import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPluginById } from "../../../src/models/plugin-model.ts";
import { buildApPackageFiles, readApPackageFiles } from "../../../src/services/agent-plugins/files.ts";
import { importApPackageFiles } from "../../../src/services/agent-plugins/import.ts";
import { AP_SCHEMA_URL } from "../../../src/services/agent-plugins/schema-registry.ts";
import { scanPluginSourceSync } from "../../../src/services/plugin-source-import.ts";
import type { TestContext } from "../../helpers/db.ts";
import { createInitializedTestContext } from "../../helpers/db.ts";
import { writeTextFile } from "../../helpers/fs.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("ap-opaque-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function writeForeignPackage(root: string): void {
  writeTextFile(
    join(root, "plugin.json"),
    JSON.stringify({
      $schema: AP_SCHEMA_URL,
      name: "foreign-demo",
      version: "1.2.3",
      description: "Keeps vendor namespaces",
      author: { name: "Ada", email: "ada@example.com" },
      homepage: "https://example.com/foreign",
      repository: "https://example.com/foreign.git",
      license: "Apache-2.0",
      extensions: {
        "com.openai": { tools: ["review"], note: "codex-style" },
        "com.github.copilot": { agents: ["./agents/review.md"] },
      },
    }),
  );
  writeTextFile(join(root, "skills/foreign-demo/SKILL.md"), "---\nname: foreign-demo\ndescription: Demo skill\n---\n\nBody\n");
  writeTextFile(join(root, "com.openai/note.txt"), "openai-bytes\n");
  writeTextFile(join(root, "com.github.copilot/agents/review.md"), "# Review\n");
}

describe("foreign namespaces", () => {
  it("re-emits vendor extension objects and namespace trees", () => {
    const root = join(ctx.homeDir, "foreign");
    writeForeignPackage(root);
    const plugin = importApPackageFiles(readApPackageFiles(root));
    const stored = getPluginById(plugin.id);
    expect(stored?.author).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(stored?.homepage).toBe("https://example.com/foreign");
    expect(stored?.repository).toBe("https://example.com/foreign.git");
    expect(stored?.license).toBe("Apache-2.0");

    const again = buildApPackageFiles(plugin.id);
    expect(again["com.openai/note.txt"]?.content).toBe("openai-bytes\n");
    expect(again["com.github.copilot/agents/review.md"]?.content).toBe("# Review\n");
    const manifest = JSON.parse(again["plugin.json"]?.content ?? "{}") as {
      extensions: Record<string, { note?: string; agents?: string[] }>;
      author: { name: string };
    };
    expect(manifest.author).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(manifest.extensions["com.openai"]).toEqual({ tools: ["review"], note: "codex-style" });
    expect(manifest.extensions["com.github.copilot"]).toEqual({ agents: ["./agents/review.md"] });
  });
});

describe("agent-plugin source kind", () => {
  it("classifies a canonical plugin.json and ignores path overrides", () => {
    const root = join(ctx.homeDir, "spec-src");
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    writeFileSync(join(root, "elsewhere/nope.md"), "should not load\n");
    writeTextFile(
      join(root, "plugin.json"),
      JSON.stringify({
        $schema: AP_SCHEMA_URL,
        name: "spec-src",
        version: "1.0.0",
        description: "Spec root",
        commands: "elsewhere",
      }),
    );
    writeTextFile(
      join(root, "skills/spec-src/SKILL.md"),
      "---\nname: spec-src\ndescription: A skill\n---\n\nHi\n",
    );
    writeTextFile(join(root, "commands/hello.md"), "hello from the default dir\n");

    const [scan] = scanPluginSourceSync(root);
    expect(scan?.source_kind).toBe("agent-plugin");
    expect(scan?.metadata.legacy_warnings).toEqual([
      "plugin.json path overrides are ignored for an Agent Plugins package",
      "legacy root commands is read with a warning",
    ]);
    const names = (scan?.resources ?? []).map((resource) => `${resource.type}:${resource.name}`);
    expect(names).toContain("skill:spec-src");
    expect(names).toContain("command:hello");
    expect(names.join(" ")).not.toContain("nope");
  });
});
