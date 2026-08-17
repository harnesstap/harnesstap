import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const detailSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/PluginPackageDetail.tsx",
  ),
  "utf8",
);
const dialogSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/DoctorReportDialog.tsx",
  ),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

describe("doctor report dialog", () => {
  test("package detail wires DoctorReportDialog instead of an inline table", () => {
    expect(detailSource).toContain("DoctorReportDialog");
    expect(detailSource).toContain("doctorOpen");
    expect(detailSource).not.toContain('aria-label="Doctor"');
    expect(detailSource).not.toContain('<table className="data-table">');
  });

  test("runDoctor reports errors via setDoctorError", () => {
    expect(detailSource).toContain("setDoctorError");
    const start = detailSource.indexOf("const runDoctor");
    const end = detailSource.indexOf("const cutErrors");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const runDoctorSource = detailSource.slice(start, end);
    expect(runDoctorSource).toContain("setDoctorError");
    expect(runDoctorSource).not.toContain("setDetailError");
  });

  test("dialog is a Close-only report overlay", () => {
    expect(dialogSource).toContain("No issues found.");
    expect(dialogSource).toContain("doctorStatusPills");
    expect(dialogSource).toContain("summarizeDoctorReport");
    expect(dialogSource).toContain("Close");
    expect(dialogSource).not.toContain("onConfirm");
  });

  test("DESIGN.md allows report dialogs for Doctor", () => {
    expect(designSource).toContain("Report dialogs for Doctor");
  });
});
