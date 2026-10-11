import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  alsoUseOnTargets,
  parseStoredHarnessScope,
} from "../../apps/desktop/src/lib/harness-scope-ui.ts";
import { alsoUseOnLabel, SCOPE_COPY } from "../../src/copy/scope.ts";

const control = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/live/HarnessScopeControl.tsx"),
  "utf8",
);

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

  it("uses DS-1 copy and the same persist path as Use on", () => {
    expect(alsoUseOnLabel(["cursor", "codex"])).toBe("Also use on Cursor and Codex");
    expect(SCOPE_COPY.notNow).toBe("Not now");
    expect(control).toContain("alsoUseOnTargets");
    expect(control).toContain("data-testid=\"also-use-on\"");
    expect(control).toContain("HARNESS_SCOPE_COPY.notNow");
    expect(control).toContain("acceptAlsoUseOn");
    expect(control).toContain("persist(ids)");
    expect(control).toContain("toast(");
    expect(control).not.toContain("runSwitch");
  });
});
