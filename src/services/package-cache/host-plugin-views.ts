import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  lstatSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { getHarnesstapDir } from "../../db/connection.js";

/**
 * Host plugin cache folders (`~/.claude/plugins/cache/<mkt>/<name>/<ver>`)
 * HarnessTap wrote, kept in `<harnesstap>/cache/host-plugin-views.json`.
 *
 * - `created`: HarnessTap made the folder. An install copies the tree there
 *   before the apply runs; the apply then emits the same bytes and writes
 *   nothing, so without this record HarnessTap's own files would later be
 *   called "not made by HarnessTap". A folder that already existed (a Claude
 *   install) is never `created`.
 * - `files`: hash of every file HarnessTap wrote into the folder, keyed by
 *   its path inside the folder. A file is HarnessTap's only while its bytes
 *   still match; anything else in the folder is left alone unless the user
 *   agrees to replace it.
 *
 * Version 1 of the file was a plain array of created folders. Those records
 * stay `legacy`: they do not say which files HarnessTap wrote.
 */
export interface HostPluginViewRecord {
  created: boolean;
  files: Record<string, string>;
  legacy?: boolean;
}

type HostPluginViewRecords = Record<string, HostPluginViewRecord>;

export function hostPluginViewsPath(): string {
  return join(getHarnesstapDir(), "cache", "host-plugin-views.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readHostPluginViewRecords(): HostPluginViewRecords {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(hostPluginViewsPath(), "utf8")) as unknown;
  } catch {
    return {};
  }
  const records: HostPluginViewRecords = {};
  if (Array.isArray(parsed)) {
    for (const view of parsed) {
      if (typeof view === "string") records[resolve(view)] = { created: true, files: {}, legacy: true };
    }
    return records;
  }
  if (!isRecord(parsed) || !isRecord(parsed.views)) return records;
  for (const [view, raw] of Object.entries(parsed.views)) {
    if (!isRecord(raw)) continue;
    const files: Record<string, string> = {};
    if (isRecord(raw.files)) {
      for (const [path, hash] of Object.entries(raw.files)) {
        if (typeof hash === "string") files[path] = hash;
      }
    }
    records[resolve(view)] = {
      created: raw.created === true,
      files,
      ...(raw.legacy === true && Object.keys(files).length === 0 ? { legacy: true } : {}),
    };
  }
  return records;
}

function writeHostPluginViewRecords(records: HostPluginViewRecords): void {
  const sorted: HostPluginViewRecords = {};
  for (const view of Object.keys(records).sort()) {
    const record = records[view];
    if (!record) continue;
    const files: Record<string, string> = {};
    for (const path of Object.keys(record.files).sort()) {
      const hash = record.files[path];
      if (hash) files[path] = hash;
    }
    const legacy = record.legacy === true && Object.keys(files).length === 0;
    sorted[view] = { created: record.created, files, ...(legacy ? { legacy: true } : {}) };
  }
  try {
    mkdirSync(dirname(hostPluginViewsPath()), { recursive: true });
    writeFileSync(
      hostPluginViewsPath(),
      `${JSON.stringify({ version: 2, views: sorted }, null, 2)}\n`,
    );
  } catch {
    // Best effort: without the record the files are only kept, never lost.
  }
}

export function readHostPluginViewRecord(hostView: string): HostPluginViewRecord | undefined {
  return readHostPluginViewRecords()[resolve(hostView)];
}

/** Record the files HarnessTap wrote into a host plugin folder. */
export function recordHostPluginViewFiles(input: {
  hostView: string;
  created: boolean;
  files: Record<string, string>;
  dropFiles?: readonly string[];
}): void {
  const records = readHostPluginViewRecords();
  const view = resolve(input.hostView);
  const current = records[view] ?? { created: false, files: {} };
  const files = { ...current.files };
  for (const path of input.dropFiles ?? []) delete files[path];
  Object.assign(files, input.files);
  const created = current.created || input.created;
  if (!created && Object.keys(files).length === 0) {
    // Nothing of HarnessTap's in a folder it did not create: no record.
    delete records[view];
  } else {
    const legacy = current.legacy === true && Object.keys(files).length === 0;
    records[view] = { created, files, ...(legacy ? { legacy: true } : {}) };
  }
  writeHostPluginViewRecords(records);
}

function viewContaining(
  records: HostPluginViewRecords,
  absolutePath: string,
): string | undefined {
  const target = resolve(absolutePath);
  return Object.keys(records).find((view) => target.startsWith(`${view}${sep}`));
}

/** True when `absolutePath` is inside a host plugin folder HarnessTap created. */
export function isInHostPluginViewCreatedByHarnessTap(absolutePath: string): boolean {
  const records = readHostPluginViewRecords();
  const view = viewContaining(records, absolutePath);
  return view !== undefined && records[view]?.created === true;
}

function pathInView(view: string, absolutePath: string): string {
  return relative(view, resolve(absolutePath)).split(sep).join("/");
}

/**
 * Whether HarnessTap wrote `absolutePath` into a host plugin folder, from the
 * folder's record alone. Once a record lists files it is the only proof: an
 * apply emits the folder onto itself, so apply rows alone would claim every
 * file in it, the user's own included.
 *
 * - a hash: HarnessTap wrote the file with these bytes
 * - `null`: HarnessTap did not write it
 * - `undefined`: no record covers the path, or only a version 1 record
 */
export function hostPluginViewWrittenHash(absolutePath: string): string | null | undefined {
  const records = readHostPluginViewRecords();
  const view = viewContaining(records, absolutePath);
  const record = view ? records[view] : undefined;
  if (!view || !record || record.legacy) return undefined;
  return record.files[pathInView(view, absolutePath)] ?? null;
}

/** Stop recording `paths` (inside the folder) as written by HarnessTap. */
export function forgetHostPluginViewFiles(hostView: string, paths: readonly string[]): void {
  if (paths.length === 0) return;
  const records = readHostPluginViewRecords();
  const view = resolve(hostView);
  const record = records[view];
  if (!record) return;
  const files = { ...record.files };
  for (const path of paths) delete files[path];
  records[view] = { ...record, files };
  writeHostPluginViewRecords(records);
}

/** An apply wrote `absolutePath` inside a recorded host plugin folder: record its bytes too. */
export function recordHostPluginViewWrite(absolutePath: string, hash: string): void {
  const records = readHostPluginViewRecords();
  const view = viewContaining(records, absolutePath);
  const record = view ? records[view] : undefined;
  if (!view || !record) return;
  records[view] = {
    ...record,
    files: { ...record.files, [pathInView(view, absolutePath)]: hash },
  };
  writeHostPluginViewRecords(records);
}

/** Remove the empty folders under `dir`, then `dir` itself when it is empty. */
export function removeEmptyDirsUnder(dir: string): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = join(dir, entry);
    try {
      // lstat: never follow a link into a folder outside this one.
      if (lstatSync(child).isDirectory()) removeEmptyDirsUnder(child);
    } catch {
      // Unreadable entries stay.
    }
  }
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    // A folder that cannot be read or removed stays.
  }
}

/**
 * After removing a file from a host plugin folder HarnessTap wrote, forget
 * its hash. In a folder HarnessTap created, or once the last file HarnessTap
 * wrote there is gone, also remove the folders left empty (container folders
 * like `skills/` included, up to `plugins/cache`), and forget the folder. Only empty folders are removed, so
 * nothing anyone else put there is touched.
 */
export function pruneCreatedHostPluginView(removedFile: string): void {
  const records = readHostPluginViewRecords();
  const view = viewContaining(records, removedFile);
  if (!view) return;
  const record = records[view];
  if (!record) return;
  const rel = relative(view, resolve(removedFile)).split(sep).join("/");
  delete record.files[rel];
  if (!record.created && Object.keys(record.files).length > 0) {
    writeHostPluginViewRecords(records);
    return;
  }
  // HarnessTap made the folder, or its last file of HarnessTap's is gone.
  removeEmptyDirsUnder(view);
  if (existsSync(view)) {
    if (!record.created && Object.keys(record.files).length === 0) delete records[view];
    writeHostPluginViewRecords(records);
    return;
  }
  let parent = dirname(view);
  while (basename(parent) !== "cache" && parent !== dirname(parent)) {
    try {
      if (readdirSync(parent).length > 0) break;
      rmdirSync(parent);
    } catch {
      break;
    }
    parent = dirname(parent);
  }
  delete records[view];
  writeHostPluginViewRecords(records);
}
