import { describe, expect, it } from "bun:test";
import {
  aliasesExcludingMain,
  canSaveHarnessSettings,
  genericHarnessTooltip,
  isHarnessSettingsDirty,
  visibleHarnesses,
} from "../../apps/desktop/src/lib/harness-settings-form.ts";

describe("harness-settings-form", () => {
  const catalog = [
    { id: "claude-code", name: "Claude Code", supported: true, supports: [] as string[] },
    { id: "cursor", name: "Cursor", supported: true, supports: [] as string[] },
    { id: "some-generic", name: "Generic", supported: false, supports: [] as string[] },
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

  it("canSave requires project main when override is enabled", () => {
    const base = {
      dirty: true,
      busy: false,
      loading: false,
      disabled: false,
      globalMain: "claude-code",
      baseUrl: "http://127.0.0.1:9",
      projectOverride: true,
      projectAvailable: true,
      projectMain: "",
    };
    expect(canSaveHarnessSettings(base)).toBe(false);
    expect(canSaveHarnessSettings({ ...base, projectMain: "cursor" })).toBe(true);
    expect(
      canSaveHarnessSettings({
        ...base,
        projectAvailable: false,
        projectMain: "",
      }),
    ).toBe(true);
  });
});

describe("genericHarnessTooltip", () => {
  it("returns base text when supports is empty", () => {
    expect(genericHarnessTooltip([])).toBe(
      "Path-based mirroring (no dedicated serializer)",
    );
  });

  it("appends supports list when non-empty", () => {
    expect(genericHarnessTooltip(["skills", "agents"])).toBe(
      "Path-based mirroring (no dedicated serializer) — Supports: skills, agents",
    );
  });
});
