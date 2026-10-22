import { afterEach, describe, expect, it } from "bun:test";
import { setDisplayHome } from "../../apps/desktop/src/lib/display-home.ts";
import {
  resourceOpenPath,
  resourceOpenUsesSelector,
  resourceOriginDisplay,
  resourcePathDisplay,
} from "../../apps/desktop/src/lib/resource-open-path.ts";
import type { LibraryResourceDetail } from "../../apps/desktop/src/lib/types.ts";

function marketplaceAgent(
  overrides: Partial<LibraryResourceDetail> = {},
): LibraryResourceDetail {
  return {
    id: "res-devx",
    type: "agent",
    name: "devx",
    namespace: "devx",
    description: "General DevX guide",
    source: "agents/devx.md",
    origin_kind: "marketplace_link",
    origin_ref: "devx@teads-plugins",
    filesystem_path:
      "/home/ada/.cursor/plugins/cache/teads-plugins/devx/agents/devx.md",
    updated_at: "2026-08-10T20:47:00.000Z",
    content: "# DevX",
    content_truncated: false,
    ...overrides,
  };
}

describe("resourceOpenPath", () => {
  it("shows and opens the resolved marketplace agent file, not agents/devx.md", () => {
    const resource = marketplaceAgent();
    expect(resourcePathDisplay(resource)).toBe(
      "~/.cursor/plugins/cache/teads-plugins/devx/agents/devx.md",
    );
    expect(resourceOpenPath(resource)).toBe(
      "/home/ada/.cursor/plugins/cache/teads-plugins/devx/agents/devx.md",
    );
    expect(resourceOpenUsesSelector(resource)).toBe(true);
  });

  it("shows the skill package directory instead of SKILL.md", () => {
    const resource = marketplaceAgent({
      type: "skill",
      name: "archify",
      namespace: null,
      source: "/Users/christophe.oudar/.claude/skills/archify/SKILL.md",
      filesystem_path: "/Users/christophe.oudar/.claude/skills/archify/SKILL.md",
      origin_kind: "manual",
      origin_ref: "/Users/christophe.oudar/.claude/skills/archify/SKILL.md",
    });
    expect(resourcePathDisplay(resource)).toBe(
      "~/.claude/skills/archify",
    );
    expect(resourceOpenPath(resource)).toBe(
      "/Users/christophe.oudar/.claude/skills/archify",
    );
  });

  it("does not treat a plugin-relative source as openable on its own", () => {
    const resource = marketplaceAgent({ filesystem_path: null, origin_ref: null });
    expect(resourcePathDisplay(resource)).toBe("agents/devx.md");
    expect(resourceOpenPath(resource)).toBe("");
  });

  it("opens plugin install directories from install_path", () => {
    const resource = marketplaceAgent({
      type: "plugin",
      source: "composition:plugin",
      install_path: "/home/ada/.claude/plugins/cache/teads-plugins/devx",
      filesystem_path: "/home/ada/.claude/plugins/cache/teads-plugins/devx",
    });
    expect(resourcePathDisplay(resource)).toBe(
      "~/.claude/plugins/cache/teads-plugins/devx",
    );
    expect(resourceOpenPath(resource)).toBe(
      "/home/ada/.claude/plugins/cache/teads-plugins/devx",
    );
    expect(resourceOpenUsesSelector(resource)).toBe(false);
  });

  it("shows and opens the same live skill folder when source is a .agents hub copy", () => {
    const resource = marketplaceAgent({
      type: "skill",
      name: "agent-development",
      namespace: null,
      source: "/Users/christophe.oudar/.agents/skills/agent-development",
      filesystem_path:
        "/Users/christophe.oudar/.claude/skills/agent-development/SKILL.md",
      origin_kind: "local_snapshot",
      origin_ref: "/Users/christophe.oudar",
    });
    expect(resourcePathDisplay(resource)).toBe(
      "~/.claude/skills/agent-development",
    );
    expect(resourceOpenPath(resource)).toBe(
      "/Users/christophe.oudar/.claude/skills/agent-development",
    );
  });

  it("opens the shared ~/.agents/AGENTS.md file instead of a bare AGENTS.md label", () => {
    const resource = marketplaceAgent({
      type: "instruction",
      name: "agents-instructions",
      namespace: null,
      source: "AGENTS.md",
      filesystem_path: "/home/ada/.agents/AGENTS.md",
      origin_kind: "local_snapshot",
      origin_ref: "/home/ada",
    });
    expect(resourcePathDisplay(resource)).toBe("~/.agents/AGENTS.md");
    expect(resourceOpenPath(resource)).toBe("/home/ada/.agents/AGENTS.md");
    expect(resourceOpenUsesSelector(resource)).toBe(true);
  });
});

describe("resource detail home paths", () => {
  afterEach(() => {
    setDisplayHome(undefined);
  });

  it("shows Path and Origin under the agent-reported home with ~, and opens the absolute path", () => {
    setDisplayHome("/workspace/qa/home-w7");
    const resource = marketplaceAgent({
      type: "instruction",
      name: "agents-instructions",
      namespace: "",
      source: "/workspace/qa/home-w7/.agents/AGENTS.md",
      origin_kind: "untracked",
      origin_ref: "/workspace/qa/home-w7/.agents/AGENTS.md",
      filesystem_path: "/workspace/qa/home-w7/.agents/AGENTS.md",
    });
    expect(resourcePathDisplay(resource)).toBe("~/.agents/AGENTS.md");
    expect(resourceOriginDisplay(resource)).toContain("(~/.agents/AGENTS.md)");
    expect(resourceOriginDisplay(resource)).not.toContain("/workspace/qa/home-w7");
    expect(resourceOpenPath(resource)).toBe("/workspace/qa/home-w7/.agents/AGENTS.md");
  });

  it("keeps a non-path origin ref as written", () => {
    expect(resourceOriginDisplay(marketplaceAgent())).toContain("devx@teads-plugins");
  });
});
