import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scanClaudePluginInventory } from "../../src/services/claude-plugin-inventory.ts";

describe("claude-plugin-inventory", () => {
  const projectRoot = join(import.meta.dirname, "../fixtures/claude-plugins-project");
  const homeRoot = join(import.meta.dirname, "../fixtures/claude-plugins-home");

  it("builds committed from project settings only", async () => {
    const inv = await scanClaudePluginInventory({ projectRoot, homeRoot });
    const committedRefs = inv.committed.map((p) => p.ref);
    expect(committedRefs).toContain("formatter@acme-marketplace");
    expect(committedRefs).not.toContain("user-only@demo");
  });

  it("merges effective with local overriding project enablement", async () => {
    const inv = await scanClaudePluginInventory({ projectRoot, homeRoot });
    const formatter = inv.effective.find((p) => p.ref === "formatter@acme-marketplace");
    expect(formatter?.enabled).toBe(false);
    expect(formatter?.scope).toBe("local");
  });
});
