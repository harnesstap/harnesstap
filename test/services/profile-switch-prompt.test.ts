import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as drift from "../../src/services/global-profile-drift.ts";
import type { GlobalProfileStatus } from "../../src/services/global-profile-drift.ts";
import type { DriftFileChange } from "../../src/services/project-drift.ts";
import {
  maybeSyncActiveProfileBeforeSwitch,
  parseSwitchChanges,
} from "../../src/services/profile-switch-prompt.ts";
import { ui } from "../../src/ui/index.ts";

describe("parseSwitchChanges", () => {
  it("accepts save, stash and discard", () => {
    expect(parseSwitchChanges("save")).toBe("save");
    expect(parseSwitchChanges("stash")).toBe("stash");
    expect(parseSwitchChanges("discard")).toBe("discard");
  });

  it("rejects unknown values", () => {
    expect(parseSwitchChanges("overwrite")).toBe("invalid");
    expect(parseSwitchChanges(undefined)).toBeUndefined();
  });
});

describe("switching away with files in a plugin cache folder", () => {
  const restores: Array<() => void> = [];
  afterEach(() => {
    for (const restore of restores.splice(0)) restore();
  });

  function withChanges(changes: DriftFileChange[]): string[] {
    const status = { active_profile: "pr", changes } as unknown as GlobalProfileStatus;
    const detect = spyOn(drift, "detectGlobalProfileStatus").mockResolvedValue(status);
    const errors: string[] = [];
    const danger = spyOn(ui, "danger").mockImplementation((message: string) => {
      errors.push(message);
    });
    const hint = spyOn(ui, "hint").mockImplementation(() => {});
    restores.push(() => detect.mockRestore(), () => danger.mockRestore(), () => hint.mockRestore());
    return errors;
  }

  const cache = ".claude/plugins/cache/mk547/p47/1.0.0/skills/s47";

  it("does not count them as unsaved changes", async () => {
    const errors = withChanges([
      { path: `${cache}/own.md`, type: "modified", removal_group: "unmanaged" },
      { path: `${cache}/a.md`, type: "modified", removal_group: "owned_modified" },
      { path: `${cache}/c.md`, type: "deleted" },
    ]);
    const decision = await maybeSyncActiveProfileBeforeSwitch({
      targetProfileName: "global default",
      yes: true,
    });
    expect(decision).toBe("continue");
    expect(errors).toEqual([]);
  });

  it("still stops for a profile file the user changed", async () => {
    const errors = withChanges([
      { path: `${cache}/own.md`, type: "modified", removal_group: "unmanaged" },
      { path: ".claude/skills/mine/SKILL.md", type: "modified" },
    ]);
    const decision = await maybeSyncActiveProfileBeforeSwitch({
      targetProfileName: "global default",
      yes: true,
    });
    expect(decision).toBe("abort");
    expect(errors).toEqual(['Error: "pr" has 1 unsaved change.']);
  });
});
