import { describe, expect, it } from "bun:test";
import {
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
        registered_harnesses: ["cursor", "claude-code"],
        materialization_strategy: "copy",
      }),
    ).toEqual({
      override: true,
      registered: ["cursor", "claude-code"],
      materialization: "copy",
    });
    expect(projectOverrideDraftFromPayload({ available: true, override: false })).toEqual({
      override: false,
      registered: [],
      materialization: "symlink-preferred",
    });
  });

  it("detects dirty state over the project fields only", () => {
    const baseline = {
      override: true,
      registered: ["claude-code", "cursor"],
      materialization: "symlink-preferred" as const,
    };
    expect(isProjectOverrideDirty(baseline, baseline)).toBe(false);
    expect(
      isProjectOverrideDirty(baseline, { ...baseline, registered: ["cursor"] }),
    ).toBe(true);
    expect(isProjectOverrideDirty(baseline, { ...baseline, override: false })).toBe(true);
    expect(
      isProjectOverrideDirty(
        { ...baseline, override: false },
        { ...baseline, override: false, registered: ["cursor"] },
      ),
    ).toBe(false);
  });

  it("canSave needs a saved global set and a project set when override is on", () => {
    const base = {
      dirty: true,
      busy: false,
      loading: false,
      disabled: false,
      baseUrl: "http://127.0.0.1:9",
      projectPath: "/repo",
      projectAvailable: true,
      globalRegistered: ["claude-code"],
      override: true,
      registered: [] as string[],
    };
    expect(canSaveProjectOverride(base)).toBe(false);
    expect(canSaveProjectOverride({ ...base, registered: ["cursor"] })).toBe(true);
    expect(
      canSaveProjectOverride({ ...base, registered: ["cursor"], globalRegistered: [] }),
    ).toBe(false);
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
});
