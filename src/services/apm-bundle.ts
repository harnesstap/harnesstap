import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  packageFileFromBytes,
  type ApPackageFiles,
} from "./agent-plugins/files.js";
import { isApEnvelopePath, readApEnvelope } from "./agent-plugins/envelope.js";
import { PACK_LOCKFILE_NAME, normalizeSha256, sha256Hex } from "./apm-pack.js";
import {
  isLegacyTomlTransportPath,
  legacyTomlTransportRejection,
} from "./legacy-toml-transport.js";
import {
  BundleSymlinkError,
  listContainedRegularFiles,
} from "../utils/path-containment.js";
import { readZipArchive } from "../utils/zip-archive.js";

export class BundleIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleIntegrityError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readBundleLock(files: Record<string, Buffer>): Record<string, unknown> | undefined {
  const lockBytes = files[PACK_LOCKFILE_NAME];
  if (!lockBytes) return undefined;
  const parsed = parseYaml(lockBytes.toString("utf8"));
  return isRecord(parsed) ? parsed : undefined;
}

function bundleFileMap(lock: Record<string, unknown> | undefined): Record<string, string> | undefined {
  const pack = lock?.pack;
  if (!isRecord(pack) || !isRecord(pack.bundle_files)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(pack.bundle_files).map(([path, hash]) => [path, String(hash)]),
  );
}

export function verifyPackedBundleBytes(files: Record<string, Buffer>): void {
  const listed = bundleFileMap(readBundleLock(files));
  if (!listed) {
    return;
  }

  const listedPaths = Object.keys(listed).sort();
  const presentPaths = Object.keys(files)
    .filter((path) => path !== PACK_LOCKFILE_NAME)
    .sort();

  for (const relativePath of listedPaths) {
    if (relativePath.split("/").includes("..") || relativePath.startsWith("/")) {
      throw new BundleIntegrityError(
        `Unsafe pack.bundle_files path ${relativePath} — pack aborted closed`,
      );
    }
    const bytes = files[relativePath];
    if (!bytes) {
      throw new BundleIntegrityError(
        `Bundle is missing ${relativePath} listed in pack.bundle_files`,
      );
    }
    const expected = listed[relativePath];
    if (!expected) continue;
    const actual = sha256Hex(bytes);
    if (normalizeSha256(expected) !== actual) {
      throw new BundleIntegrityError(
        `Bundle hash mismatch for ${relativePath}: lockfile records ${normalizeSha256(expected)}, file is ${actual}`,
      );
    }
  }

  for (const relativePath of presentPaths) {
    if (listed[relativePath] === undefined) {
      throw new BundleIntegrityError(
        `Bundle contains extra file ${relativePath} that is not listed in pack.bundle_files`,
      );
    }
  }
}

function filesFromDirectory(packageDir: string): Record<string, Buffer> {
  if (lstatSync(packageDir).isSymbolicLink()) {
    throw new BundleSymlinkError(".");
  }
  const files: Record<string, Buffer> = {};
  for (const relativePath of listContainedRegularFiles(packageDir).sort()) {
    files[relativePath] = readFileSync(join(packageDir, relativePath));
  }
  return files;
}

function filesFromZip(archivePath: string): Record<string, Buffer> {
  const members = readZipArchive(readFileSync(archivePath));
  const files: Record<string, Buffer> = {};
  for (const member of members) {
    files[member.path] = member.data;
  }
  return files;
}

function toPackageFiles(files: Record<string, Buffer>): ApPackageFiles {
  const result: ApPackageFiles = {};
  for (const relativePath of Object.keys(files).sort()) {
    const bytes = files[relativePath];
    if (!bytes) continue;
    result[relativePath] = packageFileFromBytes(bytes);
  }
  return result;
}

function bytesFromPackageFiles(files: ApPackageFiles): Record<string, Buffer> {
  const result: Record<string, Buffer> = {};
  for (const [relativePath, entry] of Object.entries(files)) {
    if (!entry) continue;
    result[relativePath] =
      entry.encoding === "base64"
        ? Buffer.from(entry.content, "base64")
        : Buffer.from(entry.content, "utf8");
  }
  return result;
}

export function isZipBundlePath(source: string): boolean {
  return source.toLowerCase().endsWith(".zip");
}

export function looksLikeFilesystemPath(source: string): boolean {
  return source.includes("/") || source.includes("\\") || source.startsWith(".");
}

export function isPluginPackageDirectory(source: string): boolean {
  try {
    const resolved = resolve(source);
    return (
      existsSync(resolved)
      && statSync(resolved).isDirectory()
      && existsSync(join(resolved, "plugin.json"))
    );
  } catch {
    return false;
  }
}

export function loadVerifiedPackageFiles(filePath: string): ApPackageFiles {
  const resolved = resolve(filePath);
  if (isLegacyTomlTransportPath(resolved)) {
    throw new Error(legacyTomlTransportRejection(resolved));
  }

  if (isApEnvelopePath(resolved)) {
    const files = readApEnvelope(resolved);
    verifyPackedBundleBytes(bytesFromPackageFiles(files));
    return files;
  }

  if (isZipBundlePath(resolved)) {
    const files = filesFromZip(resolved);
    verifyPackedBundleBytes(files);
    return toPackageFiles(files);
  }

  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    if (!existsSync(join(resolved, "plugin.json"))) {
      throw new Error(
        `${resolved} is a directory but has no plugin.json — expected an Agent Plugins package.`,
      );
    }
    const files = filesFromDirectory(resolved);
    verifyPackedBundleBytes(files);
    return toPackageFiles(files);
  }

  throw new Error(
    `Cannot tell what ${resolved} is. Pass an Agent Plugins package directory, a .zip bundle, or an .ap.json envelope.`,
  );
}
