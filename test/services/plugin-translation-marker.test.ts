import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createTempDir } from "../helpers/fs.ts";
import {
  dropPluginTranslatedResources,
  isPluginTranslatedResource,
  readPluginTranslationMarker,
  writePluginTranslationMarker,
} from "../../src/services/plugin-translation-marker.ts";
import { PLUGIN_TRANSLATION_SCHEMA } from "../../src/services/plugin-translation-source.ts";

describe("plugin translation markers", () => {
  it("writes and reads skill directory markers", () => {
    const root = createTempDir("plugin-marker-skill-");
    const skillDir = join(root, ".agents/skills/hello");
    writePluginTranslationMarker(skillDir, {
      plugin: "demo",
      marketplace: "demo-market",
      origin_ref: "demo@demo-market",
      version: "1.0.0",
      type: "skill",
      name: "hello",
    }, { exclusive: true });

    const markerPath = join(skillDir, ".harnesstap");
    expect(existsSync(markerPath)).toBe(true);
    const marker = readPluginTranslationMarker(markerPath);
    expect(marker?.schema).toBe(PLUGIN_TRANSLATION_SCHEMA);
    expect(marker?.entries).toHaveLength(1);
    expect(marker?.entries[0]?.origin_ref).toBe("demo@demo-market");

    const resource = {
      type: "skill" as const,
      name: "hello",
      content: "body",
      source: "~/.agents/skills/hello/SKILL.md",
    };
    expect(isPluginTranslatedResource(root, resource)).toBe(true);
    expect(dropPluginTranslatedResources(root, [resource])).toHaveLength(0);

    rmSync(markerPath);
    expect(isPluginTranslatedResource(root, resource)).toBe(false);
    expect(dropPluginTranslatedResources(root, [resource])).toHaveLength(1);
  });

  it("merges leaf resource markers in a shared parent directory", () => {
    const root = createTempDir("plugin-marker-leaf-");
    const agentsDir = join(root, ".config/opencode/agents");
    writePluginTranslationMarker(agentsDir, {
      plugin: "demo",
      marketplace: "demo-market",
      origin_ref: "demo@demo-market",
      type: "agent",
      name: "reviewer",
    });
    writePluginTranslationMarker(agentsDir, {
      plugin: "demo",
      marketplace: "demo-market",
      origin_ref: "demo@demo-market",
      type: "command",
      name: "ping",
    });

    const marker = readPluginTranslationMarker(join(agentsDir, ".harnesstap"));
    expect(marker?.entries).toHaveLength(2);

    const agent = {
      type: "agent" as const,
      name: "reviewer",
      content: "x",
      source: "~/.config/opencode/agents/reviewer.md",
    };
    const other = {
      type: "agent" as const,
      name: "other",
      content: "y",
      source: "~/.config/opencode/agents/other.md",
    };
    expect(isPluginTranslatedResource(root, agent)).toBe(true);
    expect(isPluginTranslatedResource(root, other)).toBe(false);
  });
});
