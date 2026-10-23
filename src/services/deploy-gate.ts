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

/** Where Claude Code keeps the plugin trees HarnessTap installs, relative to the apply root. */
const CLAUDE_PLUGIN_CACHE_PREFIX = ".claude/plugins/cache/";

/** Source and script files: run by the host, not read as instructions or config. */
const PROGRAM_FILE_EXTENSION =
  /\.(?:c?js|mjs|jsx|c?ts|mts|tsx|py|rb|pl|php|lua|sh|bash|zsh|fish|ps1|bat|cmd)$/i;

/**
 * A third-party plugin's program file in the Claude plugin cache. Its code can
 * carry a bidi control in a string or regex literal without hiding anything
 * from a model, so critical findings there are reported as warnings. Skills,
 * commands, agents, hooks.json and MCP config stay fully gated.
 */
export function isPluginProgramFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith(CLAUDE_PLUGIN_CACHE_PREFIX)
    && PROGRAM_FILE_EXTENSION.test(normalized);
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
    const scanned = scanUnicodeText(file.content, file.path, unchangedFileIdentity(file, options.rootPath));
    findings.push(
      ...(isPluginProgramFile(file.path)
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
