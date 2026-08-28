import {
  LockIntegrityError,
  verifyDeployedFileHashes,
} from "./lockfile.js";
import { ui } from "../ui/index.js";
import {
  assertUnicodeAllowed,
  formatUnicodeFinding,
  hasCriticalUnicode,
  scanUnicodeText,
  type UnicodeScanFinding,
} from "./unicode-scan.js";

export interface DeployFile {
  path: string;
  content: string;
}

export interface DeployGateOptions {
  forceUnicode?: boolean;
  verifyHashes?: boolean;
  expectedHashes?: Record<string, string>;
}

export interface DeployGateResult {
  findings: UnicodeScanFinding[];
}

export { LockIntegrityError };

export function printUnicodeGateWarnings(
  findings: UnicodeScanFinding[],
  force = false,
): void {
  for (const finding of findings.filter((entry) => entry.severity === "warning")) {
    ui.warn(formatUnicodeFinding(finding));
  }
  if (force && hasCriticalUnicode(findings)) {
    ui.warn("Overriding critical hidden-Unicode findings because --force was passed.");
  }
}

export function gateDeployFiles(
  files: DeployFile[],
  options: DeployGateOptions = {},
): DeployGateResult {
  const findings: UnicodeScanFinding[] = [];
  for (const file of files) {
    findings.push(...scanUnicodeText(file.content, file.path));
  }
  assertUnicodeAllowed(findings, options.forceUnicode === true);
  if (
    options.verifyHashes === true &&
    options.expectedHashes &&
    Object.keys(options.expectedHashes).length > 0
  ) {
    verifyDeployedFileHashes(options.expectedHashes, files);
  }
  return { findings };
}
