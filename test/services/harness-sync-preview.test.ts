import { describe, expect, it } from "bun:test";
import { countHarnessSyncChanges } from "../../src/services/harness-sync-preview.ts";
import type { ExtractHostPluginMaterialResult } from "../../src/services/host-plugin-material.ts";
import { makeResourceInput } from "../helpers/resources.ts";

const noExtracted: ExtractHostPluginMaterialResult = {
  skills: [],
  resources: [],
};

const pluginPin = makeResourceInput({
  type: "plugin",
  name: "gopls-lsp",
  origin_ref: "gopls-lsp@claude-plugins-official",
  metadata: {
    source_kind: "marketplace",
    marketplace_name: "claude-plugins-official",
    resolved_version: "1.0.0",
  },
});

describe("countHarnessSyncChanges", () => {
  it("counts a missing union resource as one change on the harness that lacks it", () => {
    const skill = makeResourceInput({ type: "skill", name: "alpha", content: "from claude\n" });
    const mcp = makeResourceInput({
      type: "mcp_server",
      name: "github",
      content: '{"command":"npx"}',
    });
    const rows = countHarnessSyncChanges({
      platforms: ["claude-code", "cursor"],
      slices: [
        { platformId: "claude-code", resources: [skill] },
        { platformId: "cursor", resources: [mcp] },
      ],
      unionResources: [skill, mcp],
      extracted: noExtracted,
    });
    expect(rows).toEqual([
      { harness: "claude-code", changes: 1, added: 1, removed: 0, modified: 0 },
      { harness: "cursor", changes: 1, added: 1, removed: 0, modified: 0 },
    ]);
  });

  it("skips resources whose scan-slice body already matches the union", () => {
    const skill = makeResourceInput({ type: "skill", name: "alpha", content: "shared\n" });
    const rows = countHarnessSyncChanges({
      platforms: ["claude-code", "cursor"],
      slices: [
        { platformId: "claude-code", resources: [skill] },
        { platformId: "cursor", resources: [skill] },
      ],
      unionResources: [skill],
      extracted: noExtracted,
    });
    expect(rows).toEqual([
      { harness: "claude-code", changes: 0, added: 0, removed: 0, modified: 0 },
      { harness: "cursor", changes: 0, added: 0, removed: 0, modified: 0 },
    ]);
  });

  it("counts a body-hash mismatch as one resource change", () => {
    const winner = makeResourceInput({ type: "skill", name: "alpha", content: "main\n" });
    const loser = makeResourceInput({ type: "skill", name: "alpha", content: "alias\n" });
    const rows = countHarnessSyncChanges({
      platforms: ["claude-code", "cursor"],
      slices: [
        { platformId: "claude-code", resources: [winner] },
        { platformId: "cursor", resources: [loser] },
      ],
      unionResources: [winner],
      extracted: noExtracted,
    });
    expect(rows).toEqual([
      { harness: "claude-code", changes: 0, added: 0, removed: 0, modified: 0 },
      { harness: "cursor", changes: 1, added: 0, removed: 0, modified: 1 },
    ]);
  });

  it("counts a host plugin pin as one resource on Claude/Cursor, not on portable harnesses", () => {
    const skill = makeResourceInput({ type: "skill", name: "alpha", content: "alpha\n" });
    const extractedSkill = makeResourceInput({
      type: "rule",
      name: "from-plugin",
      content: "rule\n",
    });
    const rows = countHarnessSyncChanges({
      platforms: ["claude-code", "cursor", "opencode"],
      slices: [
        { platformId: "claude-code", resources: [pluginPin, skill] },
        { platformId: "cursor", resources: [skill] },
        { platformId: "opencode", resources: [] },
      ],
      unionResources: [pluginPin, skill],
      extracted: {
        skills: [{ name: "plugin-skill", sourceDir: "/tmp/plugin-skill" }],
        resources: [extractedSkill],
      },
    });
    expect(rows).toEqual([
      { harness: "claude-code", changes: 0, added: 0, removed: 0, modified: 0 },
      { harness: "cursor", changes: 1, added: 1, removed: 0, modified: 0 },
      { harness: "opencode", changes: 3, added: 3, removed: 0, modified: 0 },
    ]);
  });

  it("does not count Claude local-scope MCP as a portable emit", () => {
    const localMcp = makeResourceInput({
      type: "mcp_server",
      name: "local-only",
      source: "~/.claude.json#local:/tmp/project",
      metadata: { claude_mcp_scope: "local", transport: "stdio" },
    });
    const rows = countHarnessSyncChanges({
      platforms: ["claude-code", "cursor"],
      slices: [
        { platformId: "claude-code", resources: [localMcp] },
        { platformId: "cursor", resources: [] },
      ],
      unionResources: [localMcp],
      extracted: noExtracted,
    });
    expect(rows).toEqual([
      { harness: "claude-code", changes: 0, added: 0, removed: 0, modified: 0 },
      { harness: "cursor", changes: 0, added: 0, removed: 0, modified: 0 },
    ]);
  });

  it("counts a slice resource omitted from the union as removed", () => {
    const kept = makeResourceInput({ type: "skill", name: "keep", content: "keep\n" });
    const extra = makeResourceInput({ type: "skill", name: "gone", content: "gone\n" });
    const rows = countHarnessSyncChanges({
      platforms: ["claude-code", "cursor"],
      slices: [
        { platformId: "claude-code", resources: [kept] },
        { platformId: "cursor", resources: [kept, extra] },
      ],
      unionResources: [kept],
      extracted: noExtracted,
    });
    expect(rows).toEqual([
      { harness: "claude-code", changes: 0, added: 0, removed: 0, modified: 0 },
      { harness: "cursor", changes: 1, added: 0, removed: 1, modified: 0 },
    ]);
  });
});
