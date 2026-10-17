import type { UpdateFrequency, UpdateMode, UpdateSettings } from "./api/settings-updates";

export const UPDATE_MODE_OPTIONS: ReadonlyArray<{ value: UpdateMode; title: string; description: string }> = [
  { value: "off", title: "Off", description: "No background checks." },
  { value: "notify", title: "Notify only", description: "Show updates. You choose when to install." },
  {
    value: "install",
    title: "Install automatically",
    description: "Minor and patch versions in range. Never a major.",
  },
];

export const UPDATE_FREQUENCY_OPTIONS: ReadonlyArray<{ value: UpdateFrequency; label: string }> = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

export const KEEP_UP_TO_DATE_TITLE = "Keep these up to date?";

/** One line for the toast after a save. */
export function updateSettingsSummary(settings: Pick<UpdateSettings, "mode" | "frequency">): string {
  if (settings.mode === "off") return "Plugin updates: off";
  const what = settings.mode === "install" ? "install automatically" : "notify only";
  return `Plugin updates: ${what}, checked ${settings.frequency}`;
}

/** The dialog after Update all appears once, until it is answered or dismissed. */
export function shouldOfferKeepUpToDate(
  settings: Pick<UpdateSettings, "prompted"> | null,
  report: { summary: { failed: number } },
): boolean {
  return Boolean(settings) && !settings?.prompted && report.summary.failed === 0;
}
