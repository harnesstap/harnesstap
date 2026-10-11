import { describe, expect, it } from "bun:test";
import { HARNESS_SCOPE_ALL } from "../../src/services/harness-scope.ts";
import { whereResourceApplies } from "../../src/services/resource-apply-selector.ts";

describe("whereResourceApplies", () => {
  it("is empty when no harness is registered", () => {
    const all = whereResourceApplies(HARNESS_SCOPE_ALL, []);
    expect(all).toEqual({ registered: [], harnesses: [], notSetUp: true });

    const subset = whereResourceApplies(
      { kind: "subset", harnesses: ["claude-code"] },
      [],
    );
    expect(subset.notSetUp).toBe(true);
    expect(subset.harnesses).toEqual([]);
  });

  it("intersects resource scope with registered order", () => {
    const registered = ["cursor", "claude-code", "codex"];
    expect(whereResourceApplies(HARNESS_SCOPE_ALL, registered).harnesses).toEqual(
      registered,
    );

    const subset = whereResourceApplies(
      { kind: "subset", harnesses: ["codex", "claude-code"] },
      registered,
    );
    expect(subset.notSetUp).toBe(false);
    expect(subset.harnesses).toEqual(["claude-code", "codex"]);
  });
});
