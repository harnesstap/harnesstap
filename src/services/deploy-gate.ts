import { statSync } from "node:fs";
import { join } from "node:path";
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
  type UnicodeScanIdentity,
} from "./unicode-scan.js";

export interface DeployFile {
  path: string;
  content: string;
}

export interface DeployGateOptions {
  forceUnicode?: boolean;
  verifyHashes?: boolean;
  expectedHashes?: Record<string, string>;
  rootPath?: string;
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

function unchangedFileIdentity(
  file: DeployFile,
  rootPath: string | undefined,
): UnicodeScanIdentity | undefined {
  if (!rootPath || !file.path) return undefined;
  try {
    const stat = statSync(join(rootPath, file.path));
    if (!stat.isFile()) return undefined;
    if (stat.size !== Buffer.byteLength(file.content)) return undefined;
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return undefined;
  }
}

export function gateDeployFiles(
  files: DeployFile[],
  options: DeployGateOptions = {},
): DeployGateResult {
  const findings: UnicodeScanFinding[] = [];
  for (const file of files) {
    findings.push(
      ...scanUnicodeText(file.content, file.path, unchangedFileIdentity(file, options.rootPath)),
    );
  }
  assertUnicodeAllowed(findings, options.forceUnicode === true);
  if (
    options.verifyHashes === true &&
    options.expectedHashes &&
    Object.keys(options.expectedHashes).length > 0
  ) {
    verifyDeployedFileHashes(
      options.expectedHashes,
      files,
      options.rootPath ? { rootPath: options.rootPath } : {},
    );
  }
  return { findings };
}
