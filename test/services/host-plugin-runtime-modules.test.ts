import { describe, expect, it } from "bun:test";
import { filterHostPluginRuntimeFiles } from "../../src/services/host-plugin-runtime-modules.ts";

const skill = {
  relativePath: "skills/hello/SKILL.md",
  content: "---\nname: hello\n---\nHi\n",
};
const pluginJson = {
  relativePath: ".claude-plugin/plugin.json",
  content: JSON.stringify({ name: "demo", hooks: "./hooks/hooks.json" }),
};
const registerJs = {
  relativePath: "hooks/register.js",
  content: "export function register() {}\n",
};

describe("filterHostPluginRuntimeFiles", () => {
  it("keeps the full tree when runtime modules are allowed", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({ hooks: { SessionStart: "./register.js" } }),
    };
    const result = filterHostPluginRuntimeFiles(
      [skill, pluginJson, loader, registerJs],
      true,
    );
    expect(result.files.map((f) => f.relativePath).sort()).toEqual([
      ".claude-plugin/plugin.json",
      "hooks/hooks.json",
      "hooks/register.js",
      "skills/hello/SKILL.md",
    ]);
    expect(result.skippedModules).toEqual([]);
  });

  it("omits modules and a loader-only hooks.json when not allowed", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({ hooks: { SessionStart: "./register.js" } }),
    };
    const result = filterHostPluginRuntimeFiles(
      [skill, pluginJson, loader, registerJs],
      false,
    );
    expect(result.files.map((f) => f.relativePath).sort()).toEqual([
      ".claude-plugin/plugin.json",
      "skills/hello/SKILL.md",
    ]);
    expect(result.skippedModules).toEqual(["hooks/register.js"]);
  });

  it("keeps declarative hook entries and strips module refs", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({
        version: 1,
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "true" }] },
            "./register.js",
          ],
        },
      }),
    };
    const result = filterHostPluginRuntimeFiles([loader, registerJs], false);
    const jsonFile = result.files.find((f) => f.relativePath === "hooks/hooks.json");
    expect(jsonFile).toBeDefined();
    const parsed = JSON.parse(jsonFile?.content ?? "{}") as {
      hooks: { PreToolUse: unknown[] };
    };
    expect(parsed.hooks.PreToolUse).toHaveLength(1);
    expect(JSON.stringify(parsed.hooks.PreToolUse[0])).toContain("command");
    expect(result.skippedModules).toEqual(["hooks/register.js"]);
  });

  it("omits unparseable hooks.json when hooks/ has a module", () => {
    const loader = { relativePath: "hooks/hooks.json", content: "{not json" };
    const result = filterHostPluginRuntimeFiles([loader, registerJs, skill], false);
    expect(result.files.map((f) => f.relativePath)).toEqual(["skills/hello/SKILL.md"]);
    expect(result.skippedModules).toEqual(["hooks/register.js"]);
  });

  it("does not warn when the pin has no modules", () => {
    const result = filterHostPluginRuntimeFiles([skill, pluginJson], false);
    expect(result.files).toHaveLength(2);
    expect(result.skippedModules).toEqual([]);
    expect(
      result.files.find((f) => f.relativePath === skill.relativePath)?.content,
    ).toBe(skill.content);
    expect(
      result.files.find((f) => f.relativePath === pluginJson.relativePath)?.content,
    ).toBe(pluginJson.content);
  });

  it("returns declarative-only hooks.json byte-identical when nothing is stripped", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "true" }] },
          ],
        },
      }),
    };
    const result = filterHostPluginRuntimeFiles([loader], false);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.content).toBe(loader.content);
    expect(result.skippedModules).toEqual([]);
  });

  it("does not treat glob matchers or prose as module refs", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "*.js",
              hooks: [{ type: "command", command: "true" }],
            },
          ],
          SessionStart: [{ description: "See register.js" }],
        },
      }),
    };
    const result = filterHostPluginRuntimeFiles([loader], false);
    const jsonFile = result.files.find((f) => f.relativePath === "hooks/hooks.json");
    expect(jsonFile?.content).toBe(loader.content);
    const parsed = JSON.parse(jsonFile?.content ?? "{}") as {
      hooks: {
        PreToolUse: Array<{ matcher: string }>;
        SessionStart: Array<{ description: string }>;
      };
    };
    expect(parsed.hooks.PreToolUse[0]?.matcher).toBe("*.js");
    expect(parsed.hooks.SessionStart[0]?.description).toBe("See register.js");
    expect(result.skippedModules).toEqual([]);
  });

  it("keeps declarative command objects and root lint.js", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({
        hooks: {
          PreToolUse: [
            { type: "command", command: "./lint.js", timeout: 5 },
          ],
        },
      }),
    };
    const lintJs = {
      relativePath: "lint.js",
      content: "console.log('lint')\n",
    };
    const result = filterHostPluginRuntimeFiles([loader, lintJs], false);
    expect(result.files.map((f) => f.relativePath).sort()).toEqual([
      "hooks/hooks.json",
      "lint.js",
    ]);
    const jsonFile = result.files.find((f) => f.relativePath === "hooks/hooks.json");
    const parsed = JSON.parse(jsonFile?.content ?? "{}") as {
      hooks: { PreToolUse: unknown[] };
    };
    expect(parsed.hooks.PreToolUse[0]).toEqual({
      type: "command",
      command: "./lint.js",
      timeout: 5,
    });
    expect(result.skippedModules).toEqual([]);
  });

  it("resolves manifest hooks modules from the plugin root", () => {
    const manifest = {
      relativePath: ".claude-plugin/plugin.json",
      content: JSON.stringify({ name: "demo", hooks: "./lib/mod.js" }),
    };
    const mod = {
      relativePath: "lib/mod.js",
      content: "export function register() {}\n",
    };
    const result = filterHostPluginRuntimeFiles([manifest, mod], false);
    expect(result.files.map((f) => f.relativePath)).toEqual([
      ".claude-plugin/plugin.json",
    ]);
    expect(result.files[0]?.content).toBe(manifest.content);
    expect(result.skippedModules).toEqual(["lib/mod.js"]);
  });

  it("keeps loader JSON when hooks remains a non-empty string", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({ hooks: "./run.sh" }),
    };
    const result = filterHostPluginRuntimeFiles([loader], false);
    expect(result.files.map((f) => f.relativePath)).toEqual(["hooks/hooks.json"]);
    const parsed = JSON.parse(result.files[0]?.content ?? "{}") as {
      hooks: string;
    };
    expect(parsed.hooks).toBe("./run.sh");
    expect(result.skippedModules).toEqual([]);
  });

  it("keeps hooks.json with only a description when nothing is stripped", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({ description: "keep me" }),
    };
    const result = filterHostPluginRuntimeFiles([loader], false);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.content).toBe(loader.content);
    expect(result.skippedModules).toEqual([]);
  });

  it("keeps empty hooks object when nothing is stripped", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({ hooks: {} }),
    };
    const result = filterHostPluginRuntimeFiles([loader], false);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.content).toBe(loader.content);
    expect(result.skippedModules).toEqual([]);
  });

  it("keeps empty PreToolUse array when nothing is stripped", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({ hooks: { PreToolUse: [] } }),
    };
    const result = filterHostPluginRuntimeFiles([loader], false);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.content).toBe(loader.content);
    expect(result.skippedModules).toEqual([]);
  });

  it("omits module-only modules array and the referenced register.js", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({ modules: ["./register.js"] }),
    };
    const result = filterHostPluginRuntimeFiles([loader, registerJs], false);
    expect(result.files).toEqual([]);
    expect(result.skippedModules).toEqual(["hooks/register.js"]);
  });

  it("omits tsx hook modules when runtime modules are not allowed", () => {
    const loader = {
      relativePath: "hooks/hooks.json",
      content: JSON.stringify({ modules: ["./register.tsx"] }),
    };
    const registerTsx = {
      relativePath: "hooks/register.tsx",
      content: "export function register() {}\n",
    };
    const result = filterHostPluginRuntimeFiles([loader, registerTsx], false);
    expect(result.files).toEqual([]);
    expect(result.skippedModules).toEqual(["hooks/register.tsx"]);
  });
});
