import { describe, expect, test } from "bun:test";
import { shouldShowReapply } from "../../apps/desktop/src/lib/reapply.ts";

describe("shouldShowReapply", () => {
  const base = {
    selectedProfile: "dev",
    activeProfile: "dev",
    applied: true,
    view: "home" as const,
    globalDriftStatus: "drifted" as const,
  };

  test("shows when active applied profile has home drift", () => {
    expect(shouldShowReapply(base)).toBe(true);
  });

  test("hides when home is clean", () => {
    expect(shouldShowReapply({ ...base, globalDriftStatus: "clean" })).toBe(false);
  });

  test("hides when home is pending (Apply handles it)", () => {
    expect(shouldShowReapply({ ...base, globalDriftStatus: "pending" })).toBe(
      false,
    );
  });

  test("hides when not yet applied", () => {
    expect(shouldShowReapply({ ...base, applied: false })).toBe(false);
  });

  test("hides when a different profile is selected", () => {
    expect(shouldShowReapply({ ...base, selectedProfile: "other" })).toBe(false);
  });

  test("shows for project drift in project view", () => {
    expect(
      shouldShowReapply({
        ...base,
        view: "project",
        globalDriftStatus: "clean",
        projectDriftStatus: "drifted",
      }),
    ).toBe(true);
  });

  test("hides for project na / clean", () => {
    expect(
      shouldShowReapply({
        ...base,
        view: "project",
        projectDriftStatus: "na",
      }),
    ).toBe(false);
    expect(
      shouldShowReapply({
        ...base,
        view: "project",
        projectDriftStatus: "clean",
      }),
    ).toBe(false);
  });
});
