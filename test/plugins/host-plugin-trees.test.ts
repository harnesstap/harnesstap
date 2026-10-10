import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listCursorPluginPinCreateInputs } from "../../src/plugins/cursor-installed.ts";
import { CursorSerializer } from "../../src/platforms/cursor.ts";
import { ClaudeCodeSerializer } from "../../src/platforms/claude-code.ts";
import { generateFiles, materializeFiles } from "../../src/services/applier.ts";
import type { Resource, SurfaceWarning } from "../../src/types.ts";
import { makeResource } from "../helpers/resources.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

function writeDemoModPin(home: string): { pin: Resource; pinRoot: string } {
  const pinRoot = ".claude/plugins/cache/demo-market/demo/1.0.0";
  writeTextFile(
    join(home, pinRoot, ".claude-plugin/plugin.json"),
    JSON.stringify({ name: "demo", version: "1.0.0", description: "Demo plugin" }),
  );
  writeTextFile(
    join(home, pinRoot, "skills/hello/SKILL.md"),
    "---\nname: hello\n---\nHello from Claude.\n",
  );
  writeTextFile(
    join(home, pinRoot, "hooks/hooks.json"),
    JSON.stringify({ hooks: { SessionStart: "./register.js" } }),
  );
  writeTextFile(
    join(home, pinRoot, "hooks/register.js"),
    "export function register() {}\n",
  );
  writeTextFile(
    join(home, ".claude/plugins/installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "demo@demo-market": [
          {
            scope: "user",
            installPath: "cache/demo-market/demo/1.0.0",
            version: "1.0.0",
          },
        ],
      },
    }),
  );
  return {
    pinRoot,
    pin: makeResource({
      type: "plugin",
      name: "demo",
      namespace: "demo-market",
      origin_kind: "marketplace_link",
      origin_ref: "demo@demo-market",
      content: "{}",
      metadata: {
        source_kind: "marketplace",
        marketplace_name: "demo-market",
        resolved_version: "1.0.0",
      },
    }),
  };
}

const fixtureHome = join(import.meta.dirname, "../fixtures/cursor-plugins-home");

describe("listCursorPluginPinCreateInputs", () => {
  it("imports unique plugin pins from ~/.cursor/plugins", () => {
    const pins = listCursorPluginPinCreateInputs(fixtureHome);
    const refs = pins.map((pin) => pin.origin_ref);

    expect(refs.sort()).toEqual([
      "active-plugin@cursor-public",
      "homemade@local",
    ]);

    const active = pins.find(
      (pin) => pin.origin_ref === "active-plugin@cursor-public",
    );
    expect(active).toMatchObject({
      type: "plugin",
      name: "active-plugin",
      namespace: "cursor-public",
      origin_kind: "marketplace_link",
      source: "~/.cursor/plugins/",
    });
    expect(active?.metadata).toMatchObject({
      source_kind: "marketplace",
      marketplace_name: "cursor-public",
      sync_status: "never_synced",
      portable: "reference",
    });

    const local = pins.find((pin) => pin.origin_ref === "homemade@local");
    expect(local).toMatchObject({
      type: "plugin",
      namespace: "local",
      origin_kind: "manual",
    });
    expect(local?.metadata).toMatchObject({ source_kind: "local" });
  });
});

describe("host plugin serialize", () => {
  it("copies a Claude install tree into Cursor local plugins and keeps Claude manifests", async () => {
    const home = createTempDir("host-plugin-claude-to-cursor-");
    try {
      writeTextFile(
        join(
          home,
          ".claude/plugins/cache/demo-market/demo/1.0.0/.claude-plugin/plugin.json",
        ),
        JSON.stringify({ name: "demo", version: "1.0.0", description: "Demo plugin" }),
      );
      writeTextFile(
        join(
          home,
          ".claude/plugins/cache/demo-market/demo/1.0.0/skills/hello/SKILL.md",
        ),
        "---\nname: hello\n---\nHello from Claude.\n",
      );
      writeTextFile(
        join(home, ".claude/plugins/installed_plugins.json"),
        JSON.stringify({
          version: 2,
          plugins: {
            "demo@demo-market": [
              {
                scope: "user",
                installPath: "cache/demo-market/demo/1.0.0",
                version: "1.0.0",
              },
            ],
          },
        }),
      );

      const serializer = new CursorSerializer();
      const files = await serializer.serialize(
        [
          makeResource({
            type: "plugin",
            name: "demo",
            namespace: "demo-market",
            origin_kind: "marketplace_link",
            origin_ref: "demo@demo-market",
            content: "{}",
            metadata: {
              source_kind: "marketplace",
              marketplace_name: "demo-market",
              resolved_version: "1.0.0",
            },
          }),
        ],
        home,
        { target: "global", projectRoot: home },
      );

      const skill = files.find((file) =>
        file.path.endsWith("skills/hello/SKILL.md"),
      );
      expect(skill?.path).toBe(
        ".cursor/plugins/local/demo/skills/hello/SKILL.md",
      );
      expect(skill?.content).toContain("Hello from Claude");
      const sidecar = files.find((file) =>
        file.path.endsWith(".harnesstap-plugin.json"),
      );
      expect(sidecar?.path).toBe(".cursor/plugins/local/demo/.harnesstap-plugin.json");
      expect(sidecar?.content).toContain("demo@demo-market");
      expect(
        files.some((file) =>
          file.path.endsWith(".claude-plugin/plugin.json"),
        ),
      ).toBe(true);
      expect(
        files.some((file) => file.path.includes(".cursor/plugins/cache/")),
      ).toBe(false);
      expect(
        files.some((file) => file.path === ".cursor/plugins/installed_plugins.json"),
      ).toBe(false);
    } finally {
      cleanupDir(home);
    }
  });

  it("registers a Cursor tree in Claude installed_plugins.json", async () => {
    const home = createTempDir("host-plugin-cursor-to-claude-");
    try {
      writeTextFile(
        join(
          home,
          ".cursor/plugins/cache/cursor-public/demo/abc123/.cursor-plugin/plugin.json",
        ),
        JSON.stringify({ name: "demo", version: "2.0.0" }),
      );
      writeTextFile(
        join(
          home,
          ".cursor/plugins/cache/cursor-public/demo/abc123/plugin.json",
        ),
        JSON.stringify({
          $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          name: "demo",
          version: "2.0.0",
        }),
      );

      const serializer = new ClaudeCodeSerializer();
      const files = await serializer.serialize(
        [
          makeResource({
            type: "plugin",
            name: "demo",
            namespace: "cursor-public",
            origin_kind: "marketplace_link",
            origin_ref: "demo@cursor-public",
            content: "{}",
            metadata: {
              source_kind: "marketplace",
              marketplace_name: "cursor-public",
              resolved_version: "2.0.0",
            },
          }),
        ],
        home,
        { target: "global", projectRoot: home },
      );

      const installed = files.find(
        (file) => file.path === ".claude/plugins/installed_plugins.json",
      );
      expect(installed).toBeDefined();
      const parsed = JSON.parse(installed?.content ?? "{}") as {
        plugins: Record<string, Array<{ installPath: string }>>;
      };
      expect(parsed.plugins["demo@cursor-public"]?.[0]?.installPath).toBe(
        "cache/cursor-public/demo/2.0.0",
      );
      expect(
        files.some((file) =>
          file.path ===
            ".claude/plugins/cache/cursor-public/demo/2.0.0/.cursor-plugin/plugin.json",
        ),
      ).toBe(true);
      const settings = files.find((file) => file.path === ".claude/settings.json");
      expect(settings?.content).toContain("demo@cursor-public");
    } finally {
      cleanupDir(home);
    }
  });

  it("does not inventory a Cursor cache copy without Cursor install records", async () => {
    const home = createTempDir("cursor-claude-manifest-");
    try {
      writeTextFile(
        join(
          home,
          ".cursor/plugins/cache/demo-market/ported/1.0.0/.claude-plugin/plugin.json",
        ),
        JSON.stringify({ name: "ported", version: "1.0.0" }),
      );

      expect(listCursorPluginPinCreateInputs(home).map((pin) => pin.origin_ref)).toEqual(
        [],
      );

      writeTextFile(
        join(home, ".cursor/plugins/installed.json"),
        JSON.stringify({ plugins: ["ported@demo-market"] }),
      );
      expect(listCursorPluginPinCreateInputs(home).map((pin) => pin.origin_ref)).toEqual([
        "ported@demo-market",
      ]);
    } finally {
      cleanupDir(home);
    }
  });

  it("omits Claude mods from Cursor emit and keeps them on Claude", async () => {
    const home = createTempDir("host-plugin-claude-mods-");
    try {
      const { pin, pinRoot } = writeDemoModPin(home);
      const cursorWarnings: SurfaceWarning[] = [];
      const claudeWarnings: SurfaceWarning[] = [];
      const serializeOptions = { target: "global" as const, projectRoot: home };

      const cursorFiles = await new CursorSerializer().serialize(
        [pin],
        home,
        { ...serializeOptions, surfaceWarnings: cursorWarnings },
      );
      expect(
        cursorFiles.some((file) =>
          file.path.endsWith("skills/hello/SKILL.md"),
        ),
      ).toBe(true);
      expect(
        cursorFiles.some((file) => file.path.endsWith("hooks/register.js")),
      ).toBe(false);
      expect(
        cursorFiles.some((file) => file.path.endsWith("hooks/hooks.json")),
      ).toBe(false);
      expect(cursorWarnings).toHaveLength(1);
      expect(cursorWarnings[0]?.category).toBe("claude-mod");
      expect(cursorWarnings[0]?.alias_harnesses).toEqual(["cursor"]);

      const claudeFiles = await new ClaudeCodeSerializer().serialize(
        [pin],
        home,
        { ...serializeOptions, surfaceWarnings: claudeWarnings },
      );
      expect(
        claudeFiles.some((file) =>
          file.path === `${pinRoot}/hooks/register.js`,
        ),
      ).toBe(true);
      expect(
        claudeFiles.some((file) =>
          file.path === `${pinRoot}/hooks/hooks.json`,
        ),
      ).toBe(true);
      expect(claudeWarnings).toHaveLength(0);
    } finally {
      cleanupDir(home);
    }
  });

  it("surfaces claude-mod warnings from generateFiles for Cursor only", async () => {
    const home = createTempDir("host-plugin-generate-warnings-");
    try {
      const { pin } = writeDemoModPin(home);
      const cursorResults = await generateFiles([pin], ["cursor"], home, {
        target: "global",
        projectRoot: home,
      });
      expect(cursorResults[0]?.surface_warnings?.[0]?.category).toBe("claude-mod");

      const claudeResults = await generateFiles([pin], ["claude-code"], home, {
        target: "global",
        projectRoot: home,
      });
      expect(claudeResults[0]?.surface_warnings ?? []).toHaveLength(0);
    } finally {
      cleanupDir(home);
    }
  });

  it("disambiguates two Cursor pins that share a plugin name", async () => {
    const home = createTempDir("host-plugin-cursor-folders-");
    try {
      for (const marketplace of ["alpha", "beta"]) {
        writeTextFile(
          join(home, `.claude/plugins/cache/${marketplace}/demo/1.0.0/.claude-plugin/plugin.json`),
          JSON.stringify({ name: "demo", version: "1.0.0" }),
        );
        writeTextFile(
          join(home, `.claude/plugins/installed_plugins.json`),
          JSON.stringify({
            version: 2,
            plugins: {
              "demo@alpha": [{ scope: "user", installPath: "cache/alpha/demo/1.0.0", version: "1.0.0" }],
              "demo@beta": [{ scope: "user", installPath: "cache/beta/demo/1.0.0", version: "1.0.0" }],
            },
          }),
        );
      }
      const files = await new CursorSerializer().serialize(
        ["alpha", "beta"].map((marketplace) =>
          makeResource({
            type: "plugin",
            name: "demo",
            namespace: marketplace,
            origin_kind: "marketplace_link",
            origin_ref: `demo@${marketplace}`,
            content: "{}",
            metadata: {
              source_kind: "marketplace",
              marketplace_name: marketplace,
              resolved_version: "1.0.0",
            },
          }),
        ),
        home,
        { target: "global", projectRoot: home },
      );
      const paths = files.map((file) => file.path);
      expect(paths.some((path) => path.startsWith(".cursor/plugins/local/demo--alpha/"))).toBe(true);
      expect(paths.some((path) => path.startsWith(".cursor/plugins/local/demo--beta/"))).toBe(true);
      await materializeFiles(files, home, { conflictPolicy: "replace" });
      const alphaOnly = files.filter((file) => file.path.includes("/demo--alpha/"));
      const renamed = alphaOnly.map((file) => ({
        ...file,
        path: file.path.replace("/demo--alpha/", "/demo/"),
      }));
      await materializeFiles(renamed, home, { conflictPolicy: "replace" });
      expect(existsSync(join(home, ".cursor/plugins/local/demo--alpha"))).toBe(false);
      expect(existsSync(join(home, ".cursor/plugins/local/demo/.harnesstap-plugin.json"))).toBe(true);
      expect(existsSync(join(home, ".cursor/plugins/local/demo--beta/.harnesstap-plugin.json"))).toBe(true);
    } finally {
      cleanupDir(home);
    }
  });

  it("replaces a managed local plugin directory and keeps the marketplace identity", async () => {
    const home = createTempDir("host-plugin-cursor-replace-");
    try {
      const { pin } = writeDemoModPin(home);
      writeTextFile(
        join(home, ".cursor/plugins/local/demo/skills/stale/SKILL.md"),
        "stale\n",
      );
      const files = await new CursorSerializer().serialize([pin], home, {
        target: "global",
        projectRoot: home,
      });
      await materializeFiles(files, home, { conflictPolicy: "replace" });
      expect(existsSync(join(home, ".cursor/plugins/local/demo/skills/stale/SKILL.md"))).toBe(false);
      expect(readFileSync(join(home, ".cursor/plugins/local/demo/skills/hello/SKILL.md"), "utf8")).toContain(
        "Hello from Claude",
      );
      expect(listCursorPluginPinCreateInputs(home).map((row) => row.origin_ref)).toEqual([
        "demo@demo-market",
      ]);
    } finally {
      cleanupDir(home);
    }
  });

  it("skips the local copy when Cursor already enabled that plugin from cache", async () => {
    const home = createTempDir("host-plugin-cursor-shadow-");
    try {
      const { pin } = writeDemoModPin(home);
      writeTextFile(
        join(home, ".cursor/plugins/cache/demo-market/demo/1.0.0/.claude-plugin/plugin.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
      );
      writeTextFile(
        join(home, ".cursor/plugins/installed.json"),
        JSON.stringify({ plugins: ["demo@demo-market"] }),
      );
      const warnings: SurfaceWarning[] = [];
      const files = await new CursorSerializer().serialize([pin], home, {
        target: "global",
        projectRoot: home,
        surfaceWarnings: warnings,
      });
      expect(files.some((file) => file.path.startsWith(".cursor/plugins/local/"))).toBe(false);
      expect(warnings.some((warning) => warning.category === "cursor-local-plugin")).toBe(true);
    } finally {
      cleanupDir(home);
    }
  });

  it("registers Claude host plugins on project apply and omits sibling bundled skills", async () => {
    const home = createTempDir("host-plugin-claude-project-");
    try {
      const { pin } = writeDemoModPin(home);
      const hello = makeResource({
        type: "skill",
        name: "hello",
        origin_kind: "marketplace_link",
        origin_ref: "https://github.com/example/demo.git",
        content: "# hello\n",
        metadata: {
          imported_from: { plugin_name: "demo", relative_path: "skills/hello/SKILL.md" },
        },
      });
      const extra = makeResource({
        type: "skill",
        name: "hello-extra",
        origin_kind: "marketplace_link",
        origin_ref: "https://github.com/example/demo.git",
        content: "# extra\n",
        metadata: {
          imported_from: { plugin_name: "demo", relative_path: "skills/hello-extra/SKILL.md" },
        },
      });
      const results = await generateFiles(
        [pin, hello, extra],
        ["claude-code"],
        home,
        { target: "project", projectRoot: home },
      );
      const files = results[0]?.files ?? [];
      expect(files.some((file) => file.path.includes(".claude/skills/hello"))).toBe(false);
      expect(files.some((file) => file.path.includes(".claude/skills/hello-extra"))).toBe(
        false,
      );
      const installed = files.find(
        (file) => file.path === ".claude/plugins/installed_plugins.json",
      );
      expect(installed).toBeDefined();
      const parsed = JSON.parse(installed?.content ?? "{}") as {
        version?: number;
        plugins: Record<string, Array<{ scope: string; installPath: string; version: string }>>;
      };
      expect(parsed.version).toBe(2);
      expect(parsed.plugins["demo@demo-market"]?.[0]).toMatchObject({
        scope: "user",
        installPath: "cache/demo-market/demo/1.0.0",
        version: "1.0.0",
      });
      const settings = JSON.parse(
        files.find((file) => file.path === ".claude/settings.json")?.content ?? "{}",
      ) as { enabledPlugins?: Record<string, boolean> };
      expect(settings.enabledPlugins?.["demo@demo-market"]).toBe(true);
      expect(settings.enabledPlugins?.demo).toBeUndefined();
    } finally {
      cleanupDir(home);
    }
  });

  it("omits bundled skills and same-name commands on Claude and Cursor", async () => {
    const home = createTempDir("host-plugin-omit-bundled-");
    try {
      const { pin } = writeDemoModPin(home);
      const skill = makeResource({
        type: "skill",
        name: "hello",
        origin_kind: "marketplace_link",
        origin_ref: "demo@demo-market",
        content: "# hello\n",
      });
      const command = makeResource({
        type: "command",
        name: "hello",
        origin_kind: "marketplace_link",
        origin_ref: "demo@demo-market",
        content: "run hello",
      });
      const claude = await generateFiles([pin, skill, command], ["claude-code"], home, {
        target: "global",
      });
      const cursor = await generateFiles([pin, skill, command], ["cursor"], home, {
        target: "global",
      });
      const opencode = await generateFiles([pin, skill, command], ["opencode"], home, {
        target: "global",
      });
      expect(claude[0]?.files.some((file) => file.path.includes(".claude/skills/hello"))).toBe(false);
      expect(claude[0]?.files.some((file) => file.path.includes(".claude/commands/hello"))).toBe(false);
      expect(claude[0]?.files.some((file) => file.path.includes("plugins"))).toBe(true);
      expect(cursor[0]?.files.some((file) => file.path.includes(".cursor/skills/hello"))).toBe(false);
      expect(opencode[0]?.files.some((file) => file.path.includes("skills/hello"))).toBe(true);
    } finally {
      cleanupDir(home);
    }
  });

  it("warns that project apply does not write Cursor local plugins", async () => {
    const home = createTempDir("host-plugin-cursor-project-");
    try {
      const { pin } = writeDemoModPin(home);
      const warnings: SurfaceWarning[] = [];
      const files = await new CursorSerializer().serialize([pin], home, {
        target: "project",
        projectRoot: home,
        surfaceWarnings: warnings,
      });
      expect(files.some((file) => file.path.includes("plugins/local"))).toBe(false);
      expect(warnings.map((warning) => warning.category)).toContain("cursor-local-plugin");
    } finally {
      cleanupDir(home);
    }
  });
});
