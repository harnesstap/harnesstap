import { describe, expect, it } from "bun:test";
import {
  resourceOpenPath,
  resourceOpenUsesSelector,
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
  it("keeps a short Path label but opens the resolved absolute file", () => {
    const resource = marketplaceAgent();
    expect(resourcePathDisplay(resource)).toBe("agents/devx.md");
    expect(resourceOpenPath(resource)).toBe(
      "/home/ada/.cursor/plugins/cache/teads-plugins/devx/agents/devx.md",
    );
    expect(resourceOpenUsesSelector(resource)).toBe(true);
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
      "/home/ada/.claude/plugins/cache/teads-plugins/devx",
    );
    expect(resourceOpenPath(resource)).toBe(
      "/home/ada/.claude/plugins/cache/teads-plugins/devx",
    );
    expect(resourceOpenUsesSelector(resource)).toBe(false);
  });
});
