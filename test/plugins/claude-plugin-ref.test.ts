import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  resolveClaudeEnabledPluginRef,
  resolveClaudeInstallRefCandidates,
} from "../../src/plugins/claude-plugin-ref.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

describe("claude-plugin-ref", () => {
  it("maps catalog anthropics pins to claude-plugins-official", () => {
    expect(resolveClaudeInstallRefCandidates("context7@anthropics", fixtureHome)).toEqual([
      "context7@claude-plugins-official",
      "context7@anthropics",
    ]);
  });

  it("maps catalog obra superpowers to official marketplace candidates", () => {
    const candidates = resolveClaudeInstallRefCandidates("superpowers@obra", fixtureHome);
    expect(candidates[0]).toBe("superpowers@claude-plugins-official");
    expect(candidates).toContain("superpowers@obra");
  });

  it("maps karpathy skills to karpathy-skills marketplace", () => {
    expect(
      resolveClaudeInstallRefCandidates("andrej-karpathy-skills@multica-ai", fixtureHome),
    ).toEqual([
      "andrej-karpathy-skills@karpathy-skills",
      "andrej-karpathy-skills@multica-ai",
    ]);
  });

  it("prefers an installed candidate for enabledPlugins ids", () => {
    expect(resolveClaudeEnabledPluginRef("superpowers@obra", fixtureHome)).toBe(
      "superpowers@claude-plugins-official",
    );
  });
});
