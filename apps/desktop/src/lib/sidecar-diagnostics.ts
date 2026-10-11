import { CONNECT_SPLASH_COPY } from "./ui-copy";

/** Mirrors the Rust `SidecarDiagnostics` payload (`get_sidecar_diagnostics`). */
export interface SidecarDiagnostics {
  stderrTail: string;
  exit: string | null;
  logPath: string | null;
}

/**
 * Text for the splash's expandable detail: what the sidecar printed before it
 * went away. Returns null when there is nothing worth showing (agent never ran).
 */
export function formatSidecarDetail(diagnostics: SidecarDiagnostics | null): string | null {
  if (!diagnostics) {
    return null;
  }
  const stderr = diagnostics.stderrTail.trim();
  if (!stderr && !diagnostics.exit) {
    return null;
  }
  const lines: string[] = [];
  if (diagnostics.exit) {
    lines.push(CONNECT_SPLASH_COPY.detailsExit(diagnostics.exit));
  }
  lines.push(stderr || CONNECT_SPLASH_COPY.detailsEmptyOutput);
  if (diagnostics.logPath) {
    lines.push("", CONNECT_SPLASH_COPY.detailsLogFile(diagnostics.logPath));
  }
  return lines.join("\n");
}
