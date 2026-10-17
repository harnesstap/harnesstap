import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  KEEP_UP_TO_DATE_TITLE,
  shouldOfferKeepUpToDate,
  UPDATE_FREQUENCY_OPTIONS,
  UPDATE_MODE_OPTIONS,
  updateSettingsSummary,
} from "../../apps/desktop/src/lib/update-settings-copy.ts";

const src = (path: string) => readFileSync(join(import.meta.dir, "../../apps/desktop/src", path), "utf8");

describe("plugin update settings copy", () => {
  it("offers Off, Notify only and Install automatically, and says a major is never installed", () => {
    expect(UPDATE_MODE_OPTIONS.map((option) => option.title)).toEqual(["Off", "Notify only", "Install automatically"]);
    expect(UPDATE_MODE_OPTIONS.find((option) => option.value === "install")?.description).toContain("Never a major");
    expect(UPDATE_FREQUENCY_OPTIONS.map((option) => option.value)).toEqual(["hourly", "daily", "weekly"]);
    expect(KEEP_UP_TO_DATE_TITLE).toBe("Keep these up to date?");
  });

  it("summarizes a save", () => {
    expect(updateSettingsSummary({ mode: "off", frequency: "daily" })).toBe("Plugin updates: off");
    expect(updateSettingsSummary({ mode: "install", frequency: "weekly" })).toBe(
      "Plugin updates: install automatically, checked weekly",
    );
  });

  it("offers the dialog once, only after an Update all with no failure", () => {
    const ok = { summary: { failed: 0 } };
    expect(shouldOfferKeepUpToDate({ prompted: false }, ok)).toBe(true);
    expect(shouldOfferKeepUpToDate({ prompted: true }, ok)).toBe(false);
    expect(shouldOfferKeepUpToDate({ prompted: false }, { summary: { failed: 1 } })).toBe(false);
    expect(shouldOfferKeepUpToDate(null, ok)).toBe(false);
  });

  it("is wired into Settings > Advanced and after Update all, with Save and Not now", () => {
    const sections = src("components/settings/SettingsParitySections.tsx");
    const advanced = sections.slice(sections.indexOf('props.tab !== "advanced"'));
    expect(advanced).toContain("<PluginUpdateSettings");
    const banner = src("components/shell/UpdatesBanner.tsx");
    expect(banner).toContain("shouldOfferKeepUpToDate(settings, report)");
    expect(banner).toContain("prompted: true");
    const dialog = src("components/shell/KeepUpToDateDialog.tsx");
    expect(dialog).toContain('confirmLabel="Save"');
    expect(dialog).toContain('cancelLabel="Not now"');
  });
});
