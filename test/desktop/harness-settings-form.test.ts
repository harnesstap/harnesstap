import { describe, expect, it } from "bun:test";
import {
  aliasesExcludingMain,
  isHarnessSettingsDirty,
  visibleHarnesses,
} from "../../apps/desktop/src/lib/harness-settings-form.ts";

describe("harness-settings-form", () => {
  const catalog = [
    { id: "claude-code", name: "Claude Code", supported: true },
    { id: "cursor", name: "Cursor", supported: true },
    { id: "some-generic", name: "Generic", supported: false },
  ];

  it("excludes main from aliases", () => {
    expect(aliasesExcludingMain(["cursor", "claude-code"], "claude-code")).toEqual([
      "cursor",
    ]);
  });

  it("showAll=false lists all supported plus selected unsupported", () => {
    const ids = visibleHarnesses(catalog, {
      showAll: false,
      selectedIds: ["some-generic"],
    }).map((h) => h.id);
    expect(ids.sort()).toEqual(["claude-code", "cursor", "some-generic"].sort());
  });

  it("detects dirty state", () => {
    const baseline = {
      globalMain: "claude-code",
      globalAliases: ["cursor"],
      projectOverride: false,
      projectMain: "claude-code",
      projectAliases: [] as string[],
      materialization: "symlink-preferred" as const,
    };
    expect(isHarnessSettingsDirty(baseline, baseline)).toBe(false);
    expect(
      isHarnessSettingsDirty(baseline, { ...baseline, globalMain: "cursor" }),
    ).toBe(true);
  });
});
