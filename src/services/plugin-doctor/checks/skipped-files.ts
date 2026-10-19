import { formatSkippedEntry } from "../../agent-plugins/import-diagnostics.js";
import type { PluginDoctorCheckResult, PluginDoctorContext } from "../plugin-doctor.types.js";

export const skippedFilesCheck = {
  id: "skipped-files",
  description: "Detect package files that import skipped (bad frontmatter, unsupported dirs)",
  run({ packageDiagnostics }: PluginDoctorContext): PluginDoctorCheckResult[] {
    if (!packageDiagnostics) return [];
    return packageDiagnostics.skipped.map((item) => ({
      severity: "error" as const,
      message: formatSkippedEntry(item),
    }));
  },
};
