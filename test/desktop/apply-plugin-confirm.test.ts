import { describe, expect, test } from "bun:test";
import {
  applyPluginDialogTitle,
  applyPluginHelperCopy,
  applyPluginProfileGlobalWarning,
  applyPluginProjectMissing,
} from "../../apps/desktop/src/lib/apply-plugin-confirm.ts";

describe("applyPluginDialogTitle", () => {
  test("names the open package", () => {
    expect(applyPluginDialogTitle("backend-oncall")).toBe("Apply backend-oncall");
  });
});

describe("applyPluginHelperCopy", () => {
  test("keeps apply off the profile-switch path", () => {
    expect(applyPluginHelperCopy()).toContain("without switching the active profile");
    expect(applyPluginHelperCopy()).toContain("profiles list");
  });
});

describe("applyPluginProfileGlobalWarning", () => {
  test("warns only for profile-tagged Global apply", () => {
    expect(applyPluginProfileGlobalWarning(true, "home")).toContain(
      "records it as the active profile",
    );
    expect(applyPluginProfileGlobalWarning(true, "project")).toBeNull();
    expect(applyPluginProfileGlobalWarning(false, "home")).toBeNull();
  });
});

describe("applyPluginProjectMissing", () => {
  test("blocks Project when no directory is chosen", () => {
    expect(applyPluginProjectMissing("project", null)).toBe(true);
    expect(applyPluginProjectMissing("project", "")).toBe(true);
    expect(applyPluginProjectMissing("project", "/tmp/app")).toBe(false);
    expect(applyPluginProjectMissing("home", null)).toBe(false);
  });
});
