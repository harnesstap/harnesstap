import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ApManifest } from "./agent-plugins/manifest.js";
import { isValidApName, slugifyApName } from "./agent-plugins/name.js";
import { AP_SCHEMA_URL, validateApManifest } from "./agent-plugins/validate.js";
import { APM_LOCKFILE_FILENAME } from "./lockfile.js";
import { skippedRootSourceWarning } from "./apm-overlay.js";
import { findProjectConfig, type ResolvedProjectConfig } from "./project-config.js";
import {
  hasCriticalUnicode,
  scanUnicodeBuffer,
  type UnicodeScanFinding,
} from "./unicode-scan.js";
import {
  BundleSymlinkError,
  PathEscapeError,
  assertContainedPath,
} from "../utils/path-containment.js";
import { writeZipArchive } from "../utils/zip-archive.js";

export const PLUGIN_NATIVE_DIRS = ["agents", "skills", "commands", "hooks"] as const;
export type PluginNativeDir = (typeof PLUGIN_NATIVE_DIRS)[number];

export const PACK_LOCKFILE_NAME = APM_LOCKFILE_FILENAME;
export const APM_CACHE_DIR = "apm_modules";

const AUTHORED_PLUGIN_JSON_PATHS = [
  "plugin.json",
  ".github/plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
];

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackError";
  }
}

export interface PackedFile {
  relativePath: string;
  bytes: Buffer;
  remappedFrom?: string;
}

export interface PackOptions {
  projectRoot?: string;
  outputDir?: string;
  archive?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface PackResult {
  name: string;
  version: string;
  outputPath: string;
  archive: boolean;
  dryRun: boolean;
  fileCount: number;
  files: Array<{ path: string; remappedFrom?: string }>;
  warnings: string[];
  unicodeFindings: UnicodeScanFinding[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function posixRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeSha256(value: string): string {
  return value.replace(/^sha256:/i, "").toLowerCase();
}

function isPluginNativeDir(value: string): value is PluginNativeDir {
  return (PLUGIN_NATIVE_DIRS as readonly string[]).includes(value);
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function assertNotSymlink(path: string, relativePath: string): void {
  if (isSymlink(path)) {
    throw new BundleSymlinkError(relativePath);
  }
}

function walkRegularFiles(root: string, current: string, files: string[]): void {
  assertNotSymlink(current, posixRelative(root, current) || ".");
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const absolute = join(current, entry.name);
    const relativePath = posixRelative(root, absolute);
    if (entry.isSymbolicLink() || isSymlink(absolute)) {
      throw new BundleSymlinkError(relativePath);
    }
    if (entry.isDirectory()) {
      walkRegularFiles(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new BundleSymlinkError(relativePath);
    }
    files.push(relativePath);
  }
}

function readBytes(root: string, relativePath: string): Buffer {
  assertContainedPath(root, relativePath);
  const absolute = join(root, relativePath);
  assertNotSymlink(absolute, relativePath);
  return readFileSync(absolute);
}

function remapLocalPath(relativePath: string, fromApm: boolean): string | undefined {
  const posix = relativePath.split("\\").join("/");
  if (fromApm) {
    if (!posix.startsWith(".apm/")) return undefined;
    const rest = posix.slice(".apm/".length);
    const kind = rest.split("/")[0] ?? "";
    if (!isPluginNativeDir(kind) || rest === kind) return undefined;
    return rest;
  }
  const kind = posix.split("/")[0] ?? "";
  if (!isPluginNativeDir(kind) || posix === kind) return undefined;
  return posix;
}

function remapDependencyPath(relativePath: string): string | undefined {
  const posix = relativePath.split("\\").join("/");
  if (posix === ".mcp.json" || posix === "mcp.json") return "mcp.json";
  const fromApm = remapLocalPath(posix, true);
  if (fromApm) return fromApm;
  return remapLocalPath(posix, false);
}

function putFile(
  files: Map<string, PackedFile>,
  relativePath: string,
  bytes: Buffer,
  remappedFrom?: string,
): void {
  if (relativePath.split("/").includes("..")) {
    throw new PathEscapeError(relativePath, ".");
  }
  assertContainedPath(".", relativePath);
  files.set(relativePath, {
    relativePath,
    bytes,
    ...(remappedFrom && remappedFrom !== relativePath ? { remappedFrom } : {}),
  });
}

function collectDir(
  projectRoot: string,
  sourceRelative: string,
  fromApm: boolean,
  files: Map<string, PackedFile>,
): void {
  const sourceDir = join(projectRoot, sourceRelative);
  if (!existsSync(sourceDir)) return;
  assertNotSymlink(sourceDir, sourceRelative);
  const found: string[] = [];
  walkRegularFiles(sourceDir, sourceDir, found);
  for (const child of found) {
    const sourcePath = posixRelative(projectRoot, join(sourceDir, child));
    const mapped = remapLocalPath(sourcePath, fromApm);
    if (!mapped) continue;
    putFile(files, mapped, readBytes(projectRoot, sourcePath), sourcePath);
  }
}

function collectLocalPrimitives(
  projectRoot: string,
  files: Map<string, PackedFile>,
  warnings: string[],
): void {
  const apmDir = join(projectRoot, ".apm");
  const apmPresent = existsSync(apmDir);
  if (apmPresent) {
    assertNotSymlink(apmDir, ".apm");
    for (const dir of PLUGIN_NATIVE_DIRS) {
      collectDir(projectRoot, join(".apm", dir), true, files);
    }
    for (const dir of PLUGIN_NATIVE_DIRS) {
      if (existsSync(join(projectRoot, dir))) {
        warnings.push(skippedRootSourceWarning(dir));
      }
    }
    return;
  }

  for (const dir of PLUGIN_NATIVE_DIRS) {
    collectDir(projectRoot, dir, false, files);
  }
}

function collectExplicitIncludes(
  projectRoot: string,
  includes: string[],
  files: Map<string, PackedFile>,
): void {
  for (const include of includes) {
    const relativePath = include.split("\\").join("/").replace(/^\.\//, "");
    const absolute = join(projectRoot, relativePath);
    if (!existsSync(absolute)) {
      throw new PackError(
        `includes path ${include} is missing and cannot be packed`,
      );
    }
    assertNotSymlink(absolute, relativePath);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      const found: string[] = [];
      walkRegularFiles(absolute, absolute, found);
      for (const child of found) {
        const sourcePath = posixRelative(projectRoot, join(absolute, child));
        const mapped = remapDependencyPath(sourcePath) ?? sourcePath;
        putFile(files, mapped, readBytes(projectRoot, sourcePath), sourcePath);
      }
      continue;
    }
    const mapped = remapDependencyPath(relativePath) ?? relativePath;
    putFile(files, mapped, readBytes(projectRoot, relativePath), relativePath);
  }
}

function parseIncludes(document: Record<string, unknown> | undefined): "auto" | string[] {
  if (!document || document.includes === undefined || document.includes === null) {
    return "auto";
  }
  if (document.includes === "auto") {
    return "auto";
  }
  if (Array.isArray(document.includes) && document.includes.every((entry) => typeof entry === "string")) {
    return document.includes;
  }
  throw new PackError("apm.yml field includes must be \"auto\" or a list of paths");
}

function asAuthor(value: unknown): ApManifest["author"] | undefined {
  if (typeof value === "string" && value.trim()) {
    return { name: value.trim() };
  }
  if (isRecord(value)) {
    const name = typeof value.name === "string" ? value.name : undefined;
    if (!name) return undefined;
    return {
      name,
      ...(typeof value.email === "string" ? { email: value.email } : {}),
      ...(typeof value.url === "string" ? { url: value.url } : {}),
    };
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asKeywords(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return undefined;
  }
  return value;
}

function repositoryUrl(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (isRecord(value) && typeof value.url === "string") return value.url;
  return undefined;
}

export function synthesizePluginManifest(
  config: ResolvedProjectConfig,
): ApManifest {
  const document = config.apm_document ?? {};
  const rawName = config.apm_name ?? "plugin";
  const name = isValidApName(rawName) ? rawName : slugifyApName(rawName);
  const version = config.apm_version ?? "1.0.0";
  const author = asAuthor(document.author);
  const keywords = asKeywords(document.keywords);
  const homepage = asString(document.homepage);
  const repository = repositoryUrl(document.repository);
  const license = asString(document.license);
  const description = config.apm_description ?? asString(document.description);

  const manifest: ApManifest = {
    $schema: AP_SCHEMA_URL,
    name,
    version,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(homepage ? { homepage } : {}),
    ...(repository ? { repository } : {}),
    ...(license ? { license } : {}),
    ...(keywords && keywords.length > 0 ? { keywords } : {}),
  };
  validateApManifest(manifest);
  return manifest;
}

function loadAuthoredPluginJson(projectRoot: string): Buffer | undefined {
  for (const relativePath of AUTHORED_PLUGIN_JSON_PATHS) {
    const absolute = join(projectRoot, relativePath);
    if (!existsSync(absolute)) continue;
    assertNotSymlink(absolute, relativePath);
    const bytes = readFileSync(absolute);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw new PackError(`Invalid JSON in ${relativePath}`);
    }
    if (!isRecord(parsed)) {
      throw new PackError(`${relativePath} must be a JSON object`);
    }
    if (typeof parsed.$schema !== "string" || parsed.$schema.length === 0) {
      parsed.$schema = AP_SCHEMA_URL;
    }
    validateApManifest(parsed);
    return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }
  return undefined;
}

function collectMcpJson(projectRoot: string, files: Map<string, PackedFile>): void {
  for (const source of [".mcp.json", "mcp.json"]) {
    const absolute = join(projectRoot, source);
    if (!existsSync(absolute)) continue;
    assertNotSymlink(absolute, source);
    putFile(files, "mcp.json", readFileSync(absolute), source);
    return;
  }
}

function lockDocument(projectRoot: string): Record<string, unknown> | undefined {
  const path = join(projectRoot, APM_LOCKFILE_FILENAME);
  if (!existsSync(path)) return undefined;
  assertNotSymlink(path, APM_LOCKFILE_FILENAME);
  const parsed = parseYaml(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) {
    throw new PackError(`Invalid lockfile in ${path}: expected a YAML mapping`);
  }
  return parsed;
}

function collectAttestedDependencies(
  projectRoot: string,
  config: ResolvedProjectConfig,
  lock: Record<string, unknown> | undefined,
  files: Map<string, PackedFile>,
  warnings: string[],
): void {
  const cacheDir = join(projectRoot, APM_CACHE_DIR);
  if (existsSync(cacheDir)) {
    warnings.push(
      `${APM_CACHE_DIR}/ is never packed; dependency content is taken only from lockfile-attested deployed_files`,
    );
  }

  const fileBackedDeps = config.apmDependencies.filter(
    (dependency) =>
      dependency.sourceKind === "git"
      || dependency.sourceKind === "marketplace"
      || dependency.sourceKind === "catalog"
      || dependency.sourceKind === "local",
  );
  const lockDeps = Array.isArray(lock?.dependencies)
    ? lock.dependencies.filter(isRecord)
    : [];

  for (const dependency of fileBackedDeps) {
    if (dependency.sourceKind === "local" && !dependency.originRef.includes("/") && !dependency.originRef.startsWith(".")) {
      continue;
    }
    const lockEntry = lockDeps.find((entry) => {
      const name = String(entry.name ?? "");
      const repo = String(entry.repo_url ?? "");
      return name === dependency.name || repo.includes(dependency.name);
    });
    const deployedFiles = lockEntry && Array.isArray(lockEntry.deployed_files)
      ? lockEntry.deployed_files.map(String)
      : [];
    const hashes = lockEntry && isRecord(lockEntry.deployed_file_hashes)
      ? Object.fromEntries(
          Object.entries(lockEntry.deployed_file_hashes).map(([path, hash]) => [
            path,
            String(hash),
          ]),
        )
      : {};

    if (deployedFiles.length === 0) {
      if (existsSync(cacheDir)) {
        throw new PackError(
          `Dependency ${dependency.name} has cached primitives but no deployed_files in ${APM_LOCKFILE_FILENAME}. ` +
            `Run ht apply so the content is attested.`,
        );
      }
      continue;
    }

    for (const deployed of deployedFiles) {
      const relativePath = deployed.split("\\").join("/");
      const absolute = join(projectRoot, relativePath);
      if (!existsSync(absolute)) {
        throw new PackError(
          `Attested file ${relativePath} from ${dependency.name} is missing. Run ht apply to restore it.`,
        );
      }
      assertNotSymlink(absolute, relativePath);
      const bytes = readFileSync(absolute);
      const expected = hashes[relativePath];
      if (expected && normalizeSha256(expected) !== sha256Hex(bytes)) {
        throw new PackError(
          `${relativePath} does not match the hash recorded in ${APM_LOCKFILE_FILENAME}`,
        );
      }
      const mapped = remapDependencyPath(relativePath);
      if (!mapped) continue;
      putFile(files, mapped, bytes, relativePath);
    }
  }
}

function embedLockfile(
  lock: Record<string, unknown> | undefined,
  files: Map<string, PackedFile>,
): void {
  const bundleFiles: Record<string, string> = {};
  for (const file of [...files.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )) {
    bundleFiles[file.relativePath] = sha256Hex(file.bytes);
  }
  const document: Record<string, unknown> = {
    ...(lock ?? { lockfile_version: "1" }),
    pack: {
      format: "plugin",
      packed_at: new Date().toISOString(),
      bundle_files: bundleFiles,
    },
  };
  const yaml = stringifyYaml(document, {
    indent: 2,
    lineWidth: 0,
    defaultKeyType: "PLAIN",
  });
  putFile(files, PACK_LOCKFILE_NAME, Buffer.from(yaml, "utf8"));
}

function writeDirectory(targetDir: string, files: PackedFile[]): void {
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true });
  for (const file of files) {
    const absolute = join(targetDir, file.relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.bytes);
  }
}

export function packProject(options: PackOptions = {}): PackResult {
  const start = resolve(options.projectRoot ?? process.cwd());
  const config = findProjectConfig(start);
  if (!config) {
    throw new PackError(
      `No apm.yml found under ${start}. Run ht config init or add an apm.yml at the project root.`,
    );
  }

  const warnings: string[] = [];
  const files = new Map<string, PackedFile>();
  const includes = parseIncludes(config.apm_document);

  if (includes === "auto") {
    collectLocalPrimitives(config.rootPath, files, warnings);
    collectMcpJson(config.rootPath, files);
  } else {
    collectExplicitIncludes(config.rootPath, includes, files);
  }

  const lock = lockDocument(config.rootPath);
  collectAttestedDependencies(config.rootPath, config, lock, files, warnings);

  const authored = loadAuthoredPluginJson(config.rootPath);
  const manifestBytes = authored
    ?? Buffer.from(`${JSON.stringify(synthesizePluginManifest(config), null, 2)}\n`, "utf8");
  putFile(files, "plugin.json", manifestBytes, authored ? undefined : "apm.yml");

  const unicodeFindings: UnicodeScanFinding[] = [];
  for (const file of files.values()) {
    unicodeFindings.push(...scanUnicodeBuffer(file.bytes, file.relativePath));
  }
  if (hasCriticalUnicode(unicodeFindings)) {
    const critical = unicodeFindings.filter((finding) => finding.severity === "critical");
    const first = critical[0];
    throw new PackError(
      `Pack blocked: critical hidden Unicode in ${first?.file ?? "bundle"} ` +
        `(${first?.codepoint ?? "U+????"} ${first?.description ?? "critical character"}).`,
    );
  }
  for (const finding of unicodeFindings.filter((entry) => entry.severity === "warning")) {
    warnings.push(
      `${finding.file}:${finding.line}:${finding.column} ${finding.codepoint} ${finding.description}`,
    );
  }

  embedLockfile(lock, files);

  const packed = [...files.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  let manifest: ApManifest;
  const pluginJson = files.get("plugin.json");
  if (!pluginJson) {
    throw new PackError("Packed bundle is missing plugin.json");
  }
  try {
    manifest = JSON.parse(pluginJson.bytes.toString("utf8")) as ApManifest;
  } catch {
    throw new PackError("Packed plugin.json is not valid JSON");
  }
  const name = manifest.name;
  const version = manifest.version;
  const outputRoot = resolve(config.rootPath, options.outputDir ?? "build");
  const outputPath = options.archive
    ? join(outputRoot, `${name}-${version}.zip`)
    : join(outputRoot, name);

  if (!options.dryRun) {
    mkdirSync(outputRoot, { recursive: true });
    if (options.archive) {
      writeFileSync(
        outputPath,
        writeZipArchive(packed.map((file) => ({ path: file.relativePath, data: file.bytes }))),
      );
    } else {
      writeDirectory(outputPath, packed);
    }
  }

  return {
    name,
    version,
    outputPath,
    archive: Boolean(options.archive),
    dryRun: Boolean(options.dryRun),
    fileCount: packed.length,
    files: packed.map((file) => ({
      path: file.relativePath,
      ...(file.remappedFrom ? { remappedFrom: file.remappedFrom } : {}),
    })),
    warnings,
    unicodeFindings,
  };
}
