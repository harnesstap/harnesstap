import { describe, expect, it } from "bun:test";
import {
  aliasesExcludingMain,
  canSaveProjectOverride,
  genericHarnessTooltip,
  isProjectOverrideDirty,
  projectOverrideDraftFromPayload,
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

  it("builds the override draft from the project block", () => {
    expect(
      projectOverrideDraftFromPayload({
        available: true,
        override: true,
        main_harness: "cursor",
        alias_harnesses: ["claude-code"],
        materialization_strategy: "copy",
      }),
    ).toEqual({
      override: true,
      main: "cursor",
      aliases: ["claude-code"],
      materialization: "copy",
    });
    expect(projectOverrideDraftFromPayload({ available: true, override: false })).toEqual({
      override: false,
      main: "",
      aliases: [],
      materialization: "symlink-preferred",
    });
  });

  it("detects dirty state over the project fields only", () => {
    const baseline = {
      override: true,
      main: "claude-code",
      aliases: ["cursor"],
      materialization: "symlink-preferred" as const,
    };
    expect(isProjectOverrideDirty(baseline, baseline)).toBe(false);
    expect(isProjectOverrideDirty(baseline, { ...baseline, main: "cursor" })).toBe(true);
    expect(isProjectOverrideDirty(baseline, { ...baseline, override: false })).toBe(true);
    expect(
      isProjectOverrideDirty(
        { ...baseline, override: false },
        { ...baseline, override: false, main: "cursor" },
      ),
    ).toBe(false);
  });

  it("canSave needs a saved global main and a project main when override is on", () => {
    const base = {
      dirty: true,
      busy: false,
      loading: false,
      disabled: false,
      baseUrl: "http://127.0.0.1:9",
      projectPath: "/repo",
      projectAvailable: true,
      globalMain: "claude-code",
      override: true,
      main: "",
    };
    expect(canSaveProjectOverride(base)).toBe(false);
    expect(canSaveProjectOverride({ ...base, main: "cursor" })).toBe(true);
    expect(canSaveProjectOverride({ ...base, main: "cursor", globalMain: null })).toBe(false);
    expect(canSaveProjectOverride({ ...base, override: false })).toBe(true);
    expect(canSaveProjectOverride({ ...base, override: false, projectAvailable: false })).toBe(
      false,
    );
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
      "Path-based mirroring (no dedicated serializer). Supports skills, agents.",
    );
  });
});
