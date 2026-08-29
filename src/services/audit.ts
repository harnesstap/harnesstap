import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  PathEscapeError,
  assertContainedPath,
  listContainedFiles,
} from "../utils/path-containment.js";
import {
  buildAuditInstallPlan,
  loadAndEvaluateProjectPolicy,
  loadProjectPolicy,
  PolicyError,
  type PolicyEvaluation,
} from "./apm-policy.js";
import {
  buildExecutableTrustContext,
  findRequiredExecutableViolations,
  installedTrustReports,
} from "./executable-trust.js";
import {
  diffDeployedFileHashes,
  type DeployedHashIssue,
  readLockfile,
} from "./lockfile.js";
import { findProjectConfig } from "./project-config.js";
import {
  hasCriticalUnicode,
  scanUnicodeBuffer,
  stripHiddenUnicode,
  summarizeUnicodeFindings,
  type UnicodeScanFinding,
  type UnicodeScanSeverity,
} from "./unicode-scan.js";

const SOURCE_DIRS = [
  ".apm/agents",
  ".apm/skills",
  ".apm/commands",
  ".apm/hooks",
  "agents",
  "skills",
  "commands",
  "hooks",
] as const;

const ROOT_CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"] as const;

export class AuditUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditUsageError";
  }
}

export interface AuditOptions {
  projectRoot?: string;
  file?: string;
  ci?: boolean;
  strip?: boolean;
  dryRun?: boolean;
  policy?: string;
  requirePolicy?: boolean;
}

export interface AuditResult {
  findings: UnicodeScanFinding[];
  summary: Record<UnicodeScanSeverity, number>;
  integrity: { ok: boolean; issues: DeployedHashIssue[] };
  policy: PolicyEvaluation;
  stripped: Array<{ path: string; removed: number }>;
  scannedFiles: string[];
  exitCode: number;
}

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

function collectLockfileTargets(projectRoot: string): string[] {
  const lock = readLockfile(projectRoot);
  if (!lock?.deployed_file_hashes) return [];
  return Object.keys(lock.deployed_file_hashes).sort();
}

function collectSourceTargets(projectRoot: string): string[] {
  const files: string[] = [];
  for (const dir of SOURCE_DIRS) {
    const absolute = join(projectRoot, dir);
    if (!existsSync(absolute)) continue;
    if (lstatSync(absolute).isSymbolicLink()) {
      throw new PathEscapeError(dir, projectRoot);
    }
    for (const child of listContainedFiles(absolute)) {
      files.push(toPosix(join(dir, child)));
    }
  }
  for (const name of ROOT_CONTEXT_FILES) {
    if (existsSync(join(projectRoot, name))) {
      files.push(name);
    }
  }
  return files;
}

function resolveFileTarget(projectRoot: string, file: string): string {
  const resolved = isAbsolute(file) ? resolve(file) : resolve(projectRoot, file);
  const rel = toPosix(relative(projectRoot, resolved));
  assertContainedPath(projectRoot, rel);
  if (!existsSync(resolved)) {
    throw new AuditUsageError(`File not found: ${file}`);
  }
  return rel;
}

function uniqueSorted(paths: string[]): string[] {
  return [...new Set(paths.map(toPosix))].sort();
}

function scanRelativeFile(projectRoot: string, relativePath: string): UnicodeScanFinding[] {
  assertContainedPath(projectRoot, relativePath);
  const absolute = join(projectRoot, relativePath);
  if (!existsSync(absolute)) return [];
  if (lstatSync(absolute).isSymbolicLink()) {
    throw new PathEscapeError(relativePath, projectRoot);
  }
  return scanUnicodeBuffer(readFileSync(absolute), relativePath);
}

function readRelativeText(projectRoot: string, relativePath: string): string | undefined {
  const absolute = join(projectRoot, relativePath);
  if (!existsSync(absolute)) return undefined;
  if (lstatSync(absolute).isSymbolicLink()) {
    throw new PathEscapeError(relativePath, projectRoot);
  }
  return readFileSync(absolute, "utf8");
}

function integrityForLock(
  projectRoot: string,
): { ok: boolean; issues: DeployedHashIssue[] } {
  const lock = readLockfile(projectRoot);
  const expected = lock?.deployed_file_hashes;
  if (!expected || Object.keys(expected).length === 0) {
    return { ok: true, issues: [] };
  }

  const files: Array<{ path: string; content: string }> = [];
  for (const relativePath of Object.keys(expected).sort()) {
    const content = readRelativeText(projectRoot, relativePath);
    if (content === undefined) continue;
    files.push({ path: relativePath, content });
  }
  const issues = diffDeployedFileHashes(expected, files);
  return { ok: issues.length === 0, issues };
}

function skippedPolicy(): PolicyEvaluation {
  return {
    status: "skipped",
    skippedReason: "no-policy",
    enforcement: "off",
    warnings: [],
    violations: [],
    blocks: false,
  };
}

function evaluateAuditPolicy(
  projectRoot: string,
  options: AuditOptions,
): PolicyEvaluation {
  try {
    const manifest = findProjectConfig(projectRoot);
    const lock = readLockfile(projectRoot);
    const plan = buildAuditInstallPlan({
      projectRoot,
      apmDependencies: manifest?.apmDependencies,
      mcpDependencies: manifest?.mcpDependencies,
      ...(lock ? { lock } : {}),
    });
    const evaluation = loadAndEvaluateProjectPolicy({
      projectRoot,
      ...(options.policy ? { policyPath: options.policy } : {}),
      ...(manifest?.policyPin ? { pin: manifest.policyPin } : {}),
      requirePolicy: options.ci === true && options.requirePolicy === true,
      plan,
    });
    const loaded = loadProjectPolicy({
      projectRoot,
      ...(options.policy ? { policyPath: options.policy } : {}),
      ...(manifest?.policyPin ? { pin: manifest.policyPin } : {}),
      requirePolicy: options.ci === true && options.requirePolicy === true,
    });
    const trust = buildExecutableTrustContext({ projectRoot, loaded });
    const reports = installedTrustReports(trust, {
      ...(lock ? { lock } : {}),
    });
    const required = findRequiredExecutableViolations({
      context: trust,
      require: loaded.policy?.executables.require ?? [],
      ...(lock ? { lock } : {}),
      reports,
    });
    if (required.length === 0) {
      return evaluation;
    }
    const violations = [...evaluation.violations, ...required];
    return {
      ...evaluation,
      violations,
      blocks: evaluation.blocks || options.ci === true,
    };
  } catch (error) {
    if (error instanceof PolicyError) {
      return {
        status: "failed",
        enforcement: "block",
        warnings: [],
        violations: error.violations.length > 0
          ? error.violations
          : [{ code: "policy-parse", message: error.message }],
        blocks: true,
      };
    }
    throw error;
  }
}

function exitCodeFor(result: {
  ci: boolean;
  strip: boolean;
  dryRun: boolean;
  findings: UnicodeScanFinding[];
  integrityOk: boolean;
  policyBlocks: boolean;
}): number {
  if (result.policyBlocks) {
    return 1;
  }
  if (result.ci) {
    return hasCriticalUnicode(result.findings) || !result.integrityOk ? 1 : 0;
  }
  if (result.strip && !result.dryRun) {
    return 0;
  }
  if (hasCriticalUnicode(result.findings)) return 1;
  if (result.findings.some((finding) => finding.severity === "warning")) return 2;
  return 0;
}

export function auditProject(options: AuditOptions = {}): AuditResult {
  if (options.ci && options.strip) {
    throw new AuditUsageError("--ci cannot be combined with --strip");
  }
  if (options.ci && options.file) {
    throw new AuditUsageError("--ci cannot be combined with --file");
  }
  if (options.ci && options.dryRun) {
    throw new AuditUsageError("--ci cannot be combined with --dry-run");
  }
  if (options.dryRun && !options.strip) {
    throw new AuditUsageError("--dry-run requires --strip");
  }
  if (options.requirePolicy && !options.ci) {
    throw new AuditUsageError("--require-policy requires --ci");
  }
  if (options.requirePolicy && options.file) {
    throw new AuditUsageError("--require-policy cannot be combined with --file");
  }
  if (options.requirePolicy && options.strip) {
    throw new AuditUsageError("--require-policy cannot be combined with --strip");
  }

  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const scannedFiles = options.file
    ? [resolveFileTarget(projectRoot, options.file)]
    : uniqueSorted([
        ...collectLockfileTargets(projectRoot).filter((relativePath) =>
          existsSync(join(projectRoot, relativePath)),
        ),
        ...collectSourceTargets(projectRoot),
      ]);

  const findings: UnicodeScanFinding[] = [];
  for (const relativePath of scannedFiles) {
    findings.push(...scanRelativeFile(projectRoot, relativePath));
  }

  const integrity = options.ci
    ? integrityForLock(projectRoot)
    : { ok: true, issues: [] as DeployedHashIssue[] };

  const policy = options.file
    ? skippedPolicy()
    : evaluateAuditPolicy(projectRoot, options);

  const stripped: Array<{ path: string; removed: number }> = [];
  if (options.strip && !policy.blocks) {
    for (const relativePath of scannedFiles) {
      const content = readRelativeText(projectRoot, relativePath);
      if (content === undefined) continue;
      const result = stripHiddenUnicode(content);
      if (result.removed === 0) continue;
      stripped.push({ path: relativePath, removed: result.removed });
      if (!options.dryRun) {
        writeFileSync(join(projectRoot, relativePath), result.text, "utf8");
      }
    }
  }

  const summary = summarizeUnicodeFindings(findings);
  return {
    findings,
    summary,
    integrity,
    policy,
    stripped,
    scannedFiles,
    exitCode: exitCodeFor({
      ci: options.ci === true,
      strip: options.strip === true,
      dryRun: options.dryRun === true,
      findings,
      integrityOk: integrity.ok,
      policyBlocks: policy.blocks,
    }),
  };
}
