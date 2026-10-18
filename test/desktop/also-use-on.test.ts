import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  alsoUseOnTargets,
  parseStoredHarnessScope,
} from "../../apps/desktop/src/lib/harness-scope-ui.ts";
import { SCOPE_COPY } from "../../src/copy/scope.ts";

const desktop = (path: string) =>
  readFileSync(join(import.meta.dir, "../../apps/desktop/src", path), "utf8");

describe("also use on suggestion", () => {
  it("lists registered harnesses a subset MCP is missing", () => {
    const scope = parseStoredHarnessScope(["claude-code"]);
    expect(
      alsoUseOnTargets("mcp_server", scope, ["claude-code", "cursor", "codex"]),
    ).toEqual(["cursor", "codex"]);
    expect(alsoUseOnTargets("mcp_server", { kind: "all" }, ["cursor"])).toEqual([]);
    expect(
      alsoUseOnTargets("skill", parseStoredHarnessScope(["claude-code"]), [
        "claude-code",
        "cursor",
      ]),
    ).toEqual([]);
  });

  it("is one line per type section with Add all and Dismiss, not per pill", () => {
    const section = desktop("components/live/InventorySection.tsx");
    expect(section).toContain("<TypeGroupSuggestion");
    expect(section).toContain("sectionAlsoUseOn(");
    expect(section).toContain("dismissAlsoUseOn(suggestion.items)");
    const line = desktop("components/live/SectionSuggestionLine.tsx");
    expect(line).toContain('addAll: "Add all"');
    expect(line).toContain("showLabel");
    expect(line).toContain('data-testid="section-suggestion-dismiss"');
    expect(line).toContain("aria-expanded={expanded}");
    expect(line).not.toMatch(/[\u2013\u2014\u2026]/);
    expect(desktop("components/live/InventoryRow.tsx")).not.toContain("useAlsoUseOn");
    expect(desktop("components/live/HarnessScopeControl.tsx")).not.toContain("alsoUseOn");
  });

  it("keeps Not now in one session store shared by every dismiss", () => {
    const store = desktop("lib/also-use-on-dismissals.ts");
    expect(store).toContain("const dismissed = new Set<string>()");
    expect(store).toContain("`${resourceType}:${resourceName}`");
    expect(SCOPE_COPY.notNow).toBe("Not now");
  });
});
