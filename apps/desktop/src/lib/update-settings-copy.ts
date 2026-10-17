import type { UpdateFrequency, UpdateMode, UpdateSettings } from "./api/settings-updates";

export const UPDATE_MODE_OPTIONS: ReadonlyArray<{ value: UpdateMode; title: string; description: string }> = [
  { value: "off", title: "Off", description: "Never check. Synced profiles still follow their parent." },
  { value: "notify", title: "Notify only", description: "Tell me. I'll install." },
  {
    value: "install",
    title: "Install automatically",
    description: "Minor and patch updates install on their own. Majors always ask.",
  },
];

export const UPDATE_FREQUENCY_OPTIONS: ReadonlyArray<{ value: UpdateFrequency; label: string }> = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

export const KEEP_UP_TO_DATE_TITLE = "Keep plugins up to date?";

/** One line for the toast after a save. */
export function updateSettingsSummary(settings: Pick<UpdateSettings, "mode" | "frequency">): string {
  if (settings.mode === "off") return "Plugin updates: off";
  const what = settings.mode === "install" ? "install automatically" : "notify only";
  return `Plugin updates: ${what}, checked ${settings.frequency}`;
}

/** The prompt appears once, after the first update that installed something and failed nothing. */
export function shouldOfferKeepUpToDate(
  settings: Pick<UpdateSettings, "prompted"> | null,
  report: { summary: { updated: number; failed: number } },
): boolean {
  return Boolean(settings) && !settings?.prompted && report.summary.updated > 0 && report.summary.failed === 0;
}
