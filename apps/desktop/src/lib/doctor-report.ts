import type { PluginDoctorReport } from "./api/library-plugins";

export interface DoctorReportGroup {
  check: string;
  messages: string[];
}

export type DoctorStatusTone = "ok" | "warn" | "bad";

export interface DoctorStatusPill {
  label: string;
  tone: DoctorStatusTone;
}

export interface DoctorReportSummary {
  groups: DoctorReportGroup[];
  pills: DoctorStatusPill[];
}

export function summarizeDoctorReport(
  report: Pick<PluginDoctorReport, "checks" | "results">,
): DoctorReportSummary {
  const groups: DoctorReportGroup[] = [];
  for (const check of report.checks) {
    const messages = report.results
      .filter((row) => row.check === check)
      .map((row) => row.message);
    if (messages.length > 0) {
      groups.push({ check, messages });
    }
  }
  const errorCount = report.results.filter((row) => row.severity === "error").length;
  const warnCount = report.results.filter((row) => row.severity === "warn").length;
  const pills: DoctorStatusPill[] = [];
  if (errorCount === 0 && warnCount === 0) {
    pills.push({ label: "valid", tone: "ok" });
  } else {
    if (errorCount > 0) {
      pills.push({
        label: `${errorCount} ${errorCount === 1 ? "error" : "errors"}`,
        tone: "bad",
      });
    }
    if (warnCount > 0) {
      pills.push({
        label: `${warnCount} ${warnCount === 1 ? "warning" : "warnings"}`,
        tone: "warn",
      });
    }
  }
  return { groups, pills };
}
