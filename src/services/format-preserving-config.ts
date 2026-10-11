import {
  applyEdits,
  modify,
  parse as parseJsonc,
  type FormattingOptions,
  type JSONPath,
  type ParseError,
} from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export function ensureTrailingNewline(text: string): string {
  if (text.length === 0 || text.endsWith("\n")) {
    return text;
  }
  return `${text}\n`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !isRecord(parsed)) {
    return null;
  }
  return parsed;
}

function detectJsonFormatting(text: string): FormattingOptions {
  const insertFinalNewline = text.endsWith("\n") || text.endsWith("\r\n");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (/\n\t\S/.test(text) || /\n\t"/.test(text)) {
    return { tabSize: 1, insertSpaces: false, insertFinalNewline, eol };
  }
  const match = text.match(/\n( +)"/);
  return {
    tabSize: match?.[1]?.length ?? 2,
    insertSpaces: true,
    insertFinalNewline,
    eol,
  };
}

function stringifyNewJson(value: Record<string, unknown>, tabSize = 2): string {
  return `${JSON.stringify(value, null, tabSize)}\n`;
}

function overlayRecords(
  existing: Record<string, unknown>,
  overlay: Record<string, unknown>,
  mergeObjectKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(overlay)) {
    if (mergeObjectKeys.has(key) && isRecord(existing[key]) && isRecord(value)) {
      merged[key] = { ...existing[key], ...value };
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function collectChangedPaths(
  existing: Record<string, unknown>,
  merged: Record<string, unknown>,
  prefix: JSONPath,
  mergeObjectKeys: ReadonlySet<string>,
  removeMissing: boolean,
): Array<{ path: JSONPath; value: unknown }> {
  const diffs: Array<{ path: JSONPath; value: unknown }> = [];
  for (const key of Object.keys(merged)) {
    const path: JSONPath = [...prefix, key];
    const next = merged[key];
    const prev = existing[key];
    if (jsonValuesEqual(prev, next)) {
      continue;
    }
    if (
      prefix.length === 0
      && mergeObjectKeys.has(key)
      && isRecord(prev)
      && isRecord(next)
    ) {
      diffs.push(...collectChangedPaths(prev, next, path, new Set(), removeMissing));
      continue;
    }
    diffs.push({ path, value: next });
  }
  if (removeMissing) {
    for (const key of Object.keys(existing)) {
      if (key in merged) {
        continue;
      }
      diffs.push({ path: [...prefix, key], value: undefined });
    }
  }
  return diffs;
}

export function applyJsonObjectPreservingFormat(
  existingRaw: string,
  existing: Record<string, unknown>,
  merged: Record<string, unknown>,
  mergeObjectKeys: ReadonlySet<string> = new Set(),
  removeMissing = false,
): string {
  if (jsonValuesEqual(existing, merged)) {
    return existingRaw;
  }
  const formatting = detectJsonFormatting(existingRaw);
  let text = existingRaw;
  for (const diff of collectChangedPaths(
    existing,
    merged,
    [],
    mergeObjectKeys,
    removeMissing,
  )) {
    text = applyEdits(
      text,
      modify(text, diff.path, diff.value, { formattingOptions: formatting }),
    );
  }
  if (formatting.insertFinalNewline) {
    return ensureTrailingNewline(text);
  }
  return text;
}

export function overlayJsonPreservingFormat(
  existingRaw: string | null | undefined,
  overlay: Record<string, unknown>,
  options?: {
    mergeObjectKeys?: string[];
    onUnparseable?: "replace" | "keep";
  },
): string {
  const mergeObjectKeys = new Set(options?.mergeObjectKeys ?? []);
  const onUnparseable = options?.onUnparseable ?? "replace";
  if (!existingRaw) {
    return stringifyNewJson(overlay);
  }
  const existing = parseJsonObject(existingRaw);
  if (!existing) {
    return onUnparseable === "keep" ? existingRaw : stringifyNewJson(overlay);
  }
  const merged = overlayRecords(existing, overlay, mergeObjectKeys);
  return applyJsonObjectPreservingFormat(existingRaw, existing, merged, mergeObjectKeys);
}

export function applyJsonObjectUpdatePreservingFormat(
  existingRaw: string,
  next: Record<string, unknown>,
): string {
  const existing = parseJsonObject(existingRaw);
  if (!existing) {
    return stringifyNewJson(next);
  }
  return applyJsonObjectPreservingFormat(existingRaw, existing, next, new Set(), true);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteTomlKey(key: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}

function formatTomlScalar(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return '""';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatTomlScalar(entry)).join(", ")}]`;
  }
  if (isRecord(value)) {
    return formatInlineTomlTable(value);
  }
  return JSON.stringify(String(value));
}

function formatInlineTomlTable(value: Record<string, unknown>): string {
  const parts = Object.entries(value).map(
    ([key, entry]) => `${quoteTomlKey(key)} = ${formatTomlScalar(entry)}`,
  );
  return `{ ${parts.join(", ")} }`;
}

function recordFromPath(path: string[], value: unknown): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let cursor = root;
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index];
    if (!key) {
      continue;
    }
    const child: Record<string, unknown> = {};
    cursor[key] = child;
    cursor = child;
  }
  const last = path[path.length - 1];
  if (last) {
    cursor[last] = value;
  }
  return root;
}

function appendTomlFragment(text: string, path: string[], value: unknown): string {
  const fragment = stringifyToml(recordFromPath(path, value)).trimEnd();
  const base = text.endsWith("\n") || text.length === 0 ? text : `${text}\n`;
  return `${base}${fragment}\n`;
}

function insertRootAssignment(text: string, key: string, value: unknown): string {
  const formatted = `${quoteTomlKey(key)} = ${formatTomlScalar(value)}\n`;
  const tableIndex = text.search(/^[ \t]*\[/m);
  if (tableIndex < 0) {
    return `${ensureTrailingNewline(text)}${formatted}`;
  }
  const prefix = text.slice(0, tableIndex);
  const suffix = text.slice(tableIndex);
  const base = prefix.endsWith("\n") || prefix.length === 0 ? prefix : `${prefix}\n`;
  return `${base}${formatted}${suffix}`;
}

function replaceTomlAssignment(text: string, key: string, value: unknown): string {
  const formatted = `${quoteTomlKey(key)} = ${formatTomlScalar(value)}`;
  const pattern = new RegExp(
    `(^|\\n)([ \\t]*)${escapeRegExp(key)}\\s*=\\s*(?:\\{[^\\n]*\\}|[^\\n]+)`,
  );
  if (pattern.test(text)) {
    return text.replace(pattern, `$1$2${formatted}`);
  }
  return text;
}

function tableHeader(path: string[]): string {
  return `[${path.map((part) => quoteTomlKey(part)).join(".")}]`;
}

function replaceInTable(
  text: string,
  tablePath: string[],
  key: string,
  value: unknown,
): string {
  if (tablePath.length === 0) {
    const next = replaceTomlAssignment(text, key, value);
    if (next !== text) {
      return next;
    }
    if (isRecord(value)) {
      return appendTomlFragment(text, [key], value);
    }
    return insertRootAssignment(text, key, value);
  }
  const header = tableHeader(tablePath);
  const start = text.indexOf(header);
  if (start < 0) {
    return appendTomlFragment(text, [...tablePath, key], value);
  }
  const after = start + header.length;
  const nextHeader = text.slice(after).search(/\n[ \t]*\[/);
  const end = nextHeader < 0 ? text.length : after + nextHeader;
  const section = text.slice(start, end);
  const updated = replaceTomlAssignment(section, key, value);
  return `${text.slice(0, start)}${updated}${text.slice(end)}`;
}

function removeTomlAssignment(text: string, key: string): string {
  const pattern = new RegExp(
    `(^|\\n)[ \\t]*${escapeRegExp(key)}\\s*=\\s*(?:\\{[^\\n]*\\}|[^\\n]+)\\n?`,
  );
  return text.replace(pattern, "$1");
}

function removeTomlTable(text: string, path: string[]): string {
  const dotted = path.map((part) => quoteTomlKey(part)).join(".");
  const headerPattern = new RegExp(`\\[${escapeRegExp(dotted)}(?:\\.[^\\]]+)?\\]`);
  let next = text;
  let removed = false;
  while (true) {
    const match = headerPattern.exec(next);
    if (!match || match.index === undefined) {
      break;
    }
    const start = match.index;
    const lineStart = start > 0 ? next.lastIndexOf("\n", start - 1) + 1 : 0;
    const after = start + match[0].length;
    const nextHeader = next.slice(after).search(/\n[ \t]*\[/);
    const end = nextHeader < 0 ? next.length : after + nextHeader;
    next = `${next.slice(0, lineStart)}${next.slice(end).replace(/^\n/, "")}`;
    removed = true;
    headerPattern.lastIndex = 0;
  }
  if (removed) {
    return next.replace(/\n{3,}/g, "\n\n");
  }
  return removeTomlAssignment(text, path[path.length - 1] ?? "");
}

function upsertTomlObject(
  text: string,
  tablePath: string[],
  existing: Record<string, unknown> | undefined,
  merged: Record<string, unknown>,
  removeMissing: boolean,
): string {
  let next = text;
  for (const [key, value] of Object.entries(merged)) {
    const previous = existing?.[key];
    if (jsonValuesEqual(previous, value)) {
      continue;
    }
    if (isRecord(value) && isRecord(previous)) {
      next = upsertTomlObject(next, [...tablePath, key], previous, value, removeMissing);
      continue;
    }
    if (isRecord(value) && previous === undefined) {
      next = appendTomlFragment(next, [...tablePath, key], value);
      continue;
    }
    next = replaceInTable(next, tablePath, key, value);
  }
  if (removeMissing && existing) {
    for (const key of Object.keys(existing)) {
      if (key in merged) {
        continue;
      }
      if (isRecord(existing[key])) {
        next = removeTomlTable(next, [...tablePath, key]);
        continue;
      }
      if (tablePath.length === 0) {
        next = removeTomlAssignment(next, key);
        continue;
      }
      const header = tableHeader(tablePath);
      const start = next.indexOf(header);
      if (start < 0) {
        continue;
      }
      const after = start + header.length;
      const nextHeader = next.slice(after).search(/\n[ \t]*\[/);
      const end = nextHeader < 0 ? next.length : after + nextHeader;
      const section = removeTomlAssignment(next.slice(start, end), key);
      next = `${next.slice(0, start)}${section}${next.slice(end)}`;
    }
  }
  return next;
}

export function overlayTomlPreservingFormat(
  existingRaw: string | null | undefined,
  overlay: Record<string, unknown>,
  mergeDocuments: (
    existing: Record<string, unknown>,
    overlay: Record<string, unknown>,
  ) => Record<string, unknown>,
): string {
  if (!existingRaw || existingRaw.trim().length === 0) {
    return ensureTrailingNewline(stringifyToml(overlay));
  }
  let existing: Record<string, unknown>;
  try {
    const parsed: unknown = parseToml(existingRaw);
    existing = isRecord(parsed) ? parsed : {};
  } catch {
    return ensureTrailingNewline(stringifyToml(overlay));
  }
  const merged = mergeDocuments(existing, overlay);
  if (jsonValuesEqual(existing, merged)) {
    return existingRaw;
  }
  const next = upsertTomlObject(existingRaw, [], existing, merged, false);
  return ensureTrailingNewline(next);
}

export function applyTomlObjectUpdatePreservingFormat(
  existingRaw: string,
  next: Record<string, unknown>,
): string {
  let existing: Record<string, unknown>;
  try {
    const parsed: unknown = parseToml(existingRaw);
    existing = isRecord(parsed) ? parsed : {};
  } catch {
    return ensureTrailingNewline(stringifyToml(next));
  }
  if (jsonValuesEqual(existing, next)) {
    return existingRaw;
  }
  return ensureTrailingNewline(upsertTomlObject(existingRaw, [], existing, next, true));
}
