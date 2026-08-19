import type { PluginDoctorReport, PluginDoctorResultRow } from "./api/library-plugins";

export interface DoctorReportGroup {
  check: string;
  messages: string[];
}

export interface DoctorReportSummary {
  errorCount: number;
  warnCount: number;
  groups: DoctorReportGroup[];
}

export type DoctorStatusTone = "ok" | "warn" | "bad";

export interface DoctorStatusPill {
  label: string;
  tone: DoctorStatusTone;
}

const FALLBACK_CHECK_ORDER = [
  "empty-plugin",
  "duplicate-resources",
  "empty-content",
  "plugin-metadata",
] as const;

function countBySeverity(
  results: PluginDoctorResultRow[],
  severity: PluginDoctorResultRow["severity"],
): number {
  return results.filter((row) => row.severity === severity).length;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function summarizeDoctorReport(
  report: Pick<PluginDoctorReport, "checks" | "results">,
): DoctorReportSummary {
  const order = report.checks.length > 0 ? report.checks : [...FALLBACK_CHECK_ORDER];
  const groups: DoctorReportGroup[] = [];
  for (const check of order) {
    const messages = report.results
      .filter((row) => row.check === check)
      .map((row) => row.message);
    if (messages.length > 0) {
      groups.push({ check, messages });
    }
  }
  return {
    errorCount: countBySeverity(report.results, "error"),
    warnCount: countBySeverity(report.results, "warn"),
    groups,
  };
}

export function doctorStatusPills(summary: DoctorReportSummary): DoctorStatusPill[] {
  if (summary.errorCount === 0 && summary.warnCount === 0) {
    return [{ label: "valid", tone: "ok" }];
  }
  const pills: DoctorStatusPill[] = [];
  if (summary.errorCount > 0) {
    pills.push({
      label: pluralize(summary.errorCount, "error", "errors"),
      tone: "bad",
    });
  }
  if (summary.warnCount > 0) {
    pills.push({
      label: pluralize(summary.warnCount, "warning", "warnings"),
      tone: "warn",
    });
  }
  return pills;
}
