import { describe, expect, it } from "bun:test";
import {
  alreadyExistsOnConflictHint,
  applyWroteLine,
  ON_CONFLICT_ALIASES,
  parseOnConflictValue,
  unsavedChangesFlagHint,
  unsavedChangesLine,
} from "../../src/copy/cli.ts";

describe("DS-6 CLI copy", () => {
  it("maps hidden on-conflict aliases", () => {
    expect(parseOnConflictValue("overwrite")).toBe("replace");
    expect(parseOnConflictValue("ignore")).toBe("skip");
    expect(parseOnConflictValue("fail")).toBe("cancel");
    expect(parseOnConflictValue("abort")).toBe("cancel");
    expect(parseOnConflictValue("replace")).toBe("replace");
    expect(parseOnConflictValue("merge", ["merge"])).toBe("merge");
    expect(parseOnConflictValue("merge")).toBeUndefined();
  });

  it("keeps alias keys for one-release compatibility", () => {
    expect(ON_CONFLICT_ALIASES.overwrite).toBe("replace");
    expect(ON_CONFLICT_ALIASES.ignore).toBe("skip");
    expect(ON_CONFLICT_ALIASES.fail).toBe("cancel");
  });

  it("uses replace in the duplicate-name hint", () => {
    expect(alreadyExistsOnConflictHint("plugin", "demo-plugin")).toBe(
      'A plugin named "demo-plugin" already exists. Use --on-conflict replace to replace it.',
    );
  });

  it("prints switch unsaved-change lines", () => {
    expect(unsavedChangesLine("global default", 3)).toBe(
      '"global default" has 3 unsaved changes.',
    );
    expect(unsavedChangesFlagHint()).toBe(
      "Run again with --changes save, stash or discard.",
    );
  });

  it("omits zero apply terms except unchanged when nothing else happened", () => {
    expect(
      applyWroteLine({ wrote: 3, removed: 1, kept: 2, omitUnchanged: true }),
    ).toBe("Wrote 3, removed 1, kept 2.");
    expect(
      applyWroteLine({ wrote: 0, removed: 0, kept: 0, unchanged: 32 }),
    ).toBe("Everything is up to date. 32 unchanged.");
  });
});
