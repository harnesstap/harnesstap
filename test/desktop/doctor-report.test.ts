import { describe, expect, it } from "bun:test";
import type { PluginDoctorReport } from "../../apps/desktop/src/lib/api/library-plugins.ts";
import {
  doctorStatusPills,
  summarizeDoctorReport,
} from "../../apps/desktop/src/lib/doctor-report.ts";

const CHECKS = [
  "empty-plugin",
  "duplicate-resources",
  "empty-content",
  "plugin-metadata",
] as const;

function report(
  results: PluginDoctorReport["results"],
): Pick<PluginDoctorReport, "checks" | "results"> {
  return { checks: [...CHECKS], results };
}

describe("summarizeDoctorReport", () => {
  it("groups two empty-content findings under one check and omits empty checks", () => {
    const summary = summarizeDoctorReport(
      report([
        {
          check: "empty-content",
          severity: "warn",
          message: "Resource has empty definition: mcp_server:broken",
        },
        {
          check: "empty-content",
          severity: "warn",
          message: "Resource has empty definition: permission:x",
        },
        {
          check: "plugin-metadata",
          severity: "error",
          message: "Plugin ref must include marketplace: formatter",
        },
      ]),
    );
    expect(summary.errorCount).toBe(1);
    expect(summary.warnCount).toBe(2);
    expect(summary.groups.map((group) => group.check)).toEqual([
      "empty-content",
      "plugin-metadata",
    ]);
    expect(summary.groups[0]?.messages).toHaveLength(2);
  });

  it("treats empty results as no issues", () => {
    const summary = summarizeDoctorReport(report([]));
    expect(summary.errorCount).toBe(0);
    expect(summary.warnCount).toBe(0);
    expect(summary.groups).toEqual([]);
    expect(doctorStatusPills(summary)).toEqual([{ label: "valid", tone: "ok" }]);
  });

  it("labels errors and warnings with text", () => {
    const summary = summarizeDoctorReport(
      report([
        { check: "empty-plugin", severity: "warn", message: "Plugin has no resources" },
        {
          check: "duplicate-resources",
          severity: "error",
          message: "Duplicate resource in plugin: instruction:shared-doc",
        },
      ]),
    );
    expect(doctorStatusPills(summary)).toEqual([
      { label: "1 error", tone: "bad" },
      { label: "1 warning", tone: "warn" },
    ]);
  });
});
