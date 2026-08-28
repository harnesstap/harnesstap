import { deflateRawSync, inflateRawSync } from "node:zlib";
import { PathEscapeError, assertContainedPath } from "./path-containment.js";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const UNIX_MADE_BY = 3 << 8;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;
const MODE_FILE = S_IFREG | 0o644;

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ (buffer[i] ?? 0)) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipArchiveFile {
  path: string;
  data: Buffer;
}

export class ZipSymlinkError extends Error {
  readonly entry: string;

  constructor(entry: string) {
    super(`Symlinks are not allowed in a bundle: ${entry}`);
    this.name = "ZipSymlinkError";
    this.entry = entry;
  }
}

function unixMode(externalAttributes: number): number {
  return (externalAttributes >>> 16) & 0o170000;
}

function writeU16(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt16LE(value, offset);
}

function writeU32(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt32LE(value >>> 0, offset);
}

function readU16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function readU32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function normalizeZipPath(entry: string): string {
  const trimmed = entry.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!trimmed || trimmed === ".") {
    return "";
  }
  assertContainedPath(".", trimmed);
  if (trimmed.split("/").includes("..")) {
    throw new PathEscapeError(trimmed, ".");
  }
  return trimmed;
}

export function writeZipArchive(files: ZipArchiveFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
  for (const file of sorted) {
    const name = normalizeZipPath(file.path);
    if (!name) continue;
    const nameBytes = Buffer.from(name, "utf8");
    const uncompressed = file.data;
    const compressed = deflateRawSync(uncompressed);
    const checksum = crc32(uncompressed);

    const local = Buffer.alloc(30 + nameBytes.length);
    writeU32(local, 0, LOCAL_SIG);
    writeU16(local, 4, 20);
    writeU16(local, 6, 0);
    writeU16(local, 8, 8);
    writeU16(local, 10, 0);
    writeU16(local, 12, 0);
    writeU32(local, 14, checksum);
    writeU32(local, 18, compressed.length);
    writeU32(local, 22, uncompressed.length);
    writeU16(local, 26, nameBytes.length);
    writeU16(local, 28, 0);
    nameBytes.copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    writeU32(central, 0, CENTRAL_SIG);
    writeU16(central, 4, UNIX_MADE_BY | 20);
    writeU16(central, 6, 20);
    writeU16(central, 8, 0);
    writeU16(central, 10, 8);
    writeU16(central, 12, 0);
    writeU16(central, 14, 0);
    writeU32(central, 16, checksum);
    writeU32(central, 20, compressed.length);
    writeU32(central, 24, uncompressed.length);
    writeU16(central, 28, nameBytes.length);
    writeU16(central, 30, 0);
    writeU16(central, 32, 0);
    writeU16(central, 34, 0);
    writeU16(central, 36, 0);
    writeU32(central, 38, MODE_FILE << 16);
    writeU32(central, 42, offset);
    nameBytes.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  writeU32(eocd, 0, EOCD_SIG);
  writeU16(eocd, 4, 0);
  writeU16(eocd, 6, 0);
  writeU16(eocd, 8, centrals.length);
  writeU16(eocd, 10, centrals.length);
  writeU32(eocd, 12, centralDirectory.length);
  writeU32(eocd, 16, offset);
  writeU16(eocd, 20, 0);

  return Buffer.concat([...locals, centralDirectory, eocd]);
}

function findEocdOffset(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (readU32(buffer, i) === EOCD_SIG) {
      return i;
    }
  }
  throw new Error("Invalid zip archive: missing end of central directory");
}

function stripSingleRoot(files: ZipArchiveFile[]): ZipArchiveFile[] {
  if (files.length === 0) return files;
  const first = files[0]?.path.split("/")[0];
  if (!first) return files;
  const prefix = `${first}/`;
  if (!files.every((file) => file.path === first || file.path.startsWith(prefix))) {
    return files;
  }
  if (!files.some((file) => file.path === `${prefix}plugin.json` || file.path === "plugin.json")) {
    return files;
  }
  const stripped: ZipArchiveFile[] = [];
  for (const file of files) {
    if (file.path === first) continue;
    stripped.push({ path: file.path.slice(prefix.length), data: file.data });
  }
  return stripped;
}

export function readZipArchive(buffer: Buffer): ZipArchiveFile[] {
  if (buffer.length < 22) {
    throw new Error("Invalid zip archive");
  }
  const eocd = findEocdOffset(buffer);
  const count = readU16(buffer, eocd + 10);
  const centralSize = readU32(buffer, eocd + 12);
  const centralOffset = readU32(buffer, eocd + 16);
  if (centralOffset + centralSize > buffer.length) {
    throw new Error("Invalid zip archive: truncated central directory");
  }

  const files: ZipArchiveFile[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    if (readU32(buffer, cursor) !== CENTRAL_SIG) {
      throw new Error("Invalid zip archive: bad central directory entry");
    }
    const madeBy = readU16(buffer, cursor + 4);
    const compression = readU16(buffer, cursor + 10);
    const compressedSize = readU32(buffer, cursor + 20);
    const uncompressedSize = readU32(buffer, cursor + 24);
    const nameLength = readU16(buffer, cursor + 28);
    const extraLength = readU16(buffer, cursor + 30);
    const commentLength = readU16(buffer, cursor + 32);
    const externalAttributes = readU32(buffer, cursor + 38);
    const localOffset = readU32(buffer, cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;

    const posixName = name.replace(/\\/g, "/");
    if (posixName.endsWith("/")) {
      continue;
    }
    const relativePath = normalizeZipPath(posixName);
    if (!relativePath) continue;

    const unixHost = (madeBy >> 8) === 3;
    if (unixHost && unixMode(externalAttributes) === S_IFLNK) {
      throw new ZipSymlinkError(relativePath);
    }

    if (readU32(buffer, localOffset) !== LOCAL_SIG) {
      throw new Error(`Invalid zip archive: bad local header for ${relativePath}`);
    }
    const localNameLength = readU16(buffer, localOffset + 26);
    const localExtraLength = readU16(buffer, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (compression === 0) {
      data = Buffer.from(payload);
    } else if (compression === 8) {
      data = inflateRawSync(payload);
    } else {
      throw new Error(`Unsupported zip compression method ${compression} for ${relativePath}`);
    }
    if (data.length !== uncompressedSize) {
      throw new Error(`Zip size mismatch for ${relativePath}`);
    }
    files.push({ path: relativePath, data });
  }

  return stripSingleRoot(files);
}
