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

const PLUGIN_PROGRAM_FILE = /\.(?:[cm]?[jt]sx?|map|py|sh|bash|zsh|rb|go|rs|ps1|lua|pl|php)$/i;

/**
 * A program file inside a Claude Code plugin install. Claude Code runs it but
 * the model never reads it, and bundled sources often list bidi characters on
 * purpose (sanitizer regexes, for one). Findings there are warnings, so a
 * plugin's scripts do not block the apply; its skills, commands, agents,
 * hooks.json and MCP config are still gated.
 */
export function isClaudePluginProgramFile(path: string): boolean {
  return path.replace(/\\/g, "/").startsWith(".claude/plugins/cache/") && PLUGIN_PROGRAM_FILE.test(path);
}

export function gateDeployFiles(
  files: DeployFile[],
  options: DeployGateOptions = {},
): DeployGateResult {
  const findings: UnicodeScanFinding[] = [];
  for (const file of files) {
    const scanned = scanUnicodeText(file.content, file.path, unchangedFileIdentity(file, options.rootPath));
    findings.push(
      ...(isClaudePluginProgramFile(file.path)
        ? scanned.map((finding) =>
          finding.severity === "critical" ? { ...finding, severity: "warning" as const } : finding)
        : scanned),
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
