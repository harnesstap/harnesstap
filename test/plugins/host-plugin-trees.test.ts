import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { listCursorPluginPinCreateInputs } from "../../src/plugins/cursor-installed.ts";
import { CursorSerializer } from "../../src/platforms/cursor.ts";
import { ClaudeCodeSerializer } from "../../src/platforms/claude-code.ts";
import { makeResource } from "../helpers/resources.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/cursor-plugins-home");

describe("listCursorPluginPinCreateInputs", () => {
  it("imports unique plugin pins from ~/.cursor/plugins", () => {
    const pins = listCursorPluginPinCreateInputs(fixtureHome);
    const refs = pins.map((pin) => pin.origin_ref);

    expect(refs).toContain("active-plugin@cursor-public");
    expect(refs).toContain("homemade@local");
    expect(refs).toContain("agent-demo@cursor-public");

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
  it("copies a Claude install tree into Cursor cache and keeps Claude manifests", async () => {
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
        ".cursor/plugins/cache/demo-market/demo/1.0.0/skills/hello/SKILL.md",
      );
      expect(skill?.content).toContain("Hello from Claude");
      expect(
        files.some((file) =>
          file.path.endsWith(".claude-plugin/plugin.json"),
        ),
      ).toBe(true);
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

  it("inventories a Claude-manifest-only tree under Cursor cache", async () => {
    const home = createTempDir("cursor-claude-manifest-");
    try {
      writeTextFile(
        join(
          home,
          ".cursor/plugins/cache/demo-market/ported/1.0.0/.claude-plugin/plugin.json",
        ),
        JSON.stringify({ name: "ported", version: "1.0.0" }),
      );

      const pins = listCursorPluginPinCreateInputs(home);
      expect(pins.map((pin) => pin.origin_ref)).toEqual(["ported@demo-market"]);
    } finally {
      cleanupDir(home);
    }
  });
});
