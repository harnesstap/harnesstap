import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type FoldMode = "append" | "replace" | "insert-after";

export interface PendingSection {
  line: number;
  file: string;
  path: string[];
  mode: FoldMode;
  body: string[];
}

export const PENDING_FILE = "docs/unreleased-readme.md";

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const DIRECTIVE = /^<!--\s*([a-z-]+)\s*-->$/;
const RULE = /^---\s*$/;
const MODES: readonly FoldMode[] = ["append", "replace", "insert-after"];
const FILE_TARGET = /^(\S+\.md)\s+>\s+(.+)$/;

interface Heading {
  index: number;
  level: number;
  text: string;
  path: string[];
}

function scanHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = [];
  const stack: Heading[] = [];
  let inFence = false;
  lines.forEach((line, index) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = HEADING.exec(line);
    if (!match) return;
    const level = (match[1] as string).length;
    while (stack.length > 0 && (stack[stack.length - 1] as Heading).level >= level) stack.pop();
    const heading: Heading = {
      index,
      level,
      text: match[2] as string,
      path: [...stack.map((entry) => entry.text), match[2] as string],
    };
    stack.push(heading);
    headings.push(heading);
  });
  return headings;
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

function splitLines(text: string): string[] {
  return text.replace(/\n$/, "").split("\n");
}

function parseTarget(raw: string): { file: string; path: string[] } {
  const fileTarget = FILE_TARGET.exec(raw);
  const file = fileTarget ? (fileTarget[1] as string) : "README.md";
  const rest = fileTarget ? (fileTarget[2] as string) : raw;
  return { file, path: rest.split(/\s+>\s+/).map((segment) => segment.trim()) };
}

function targetHint(raw: string): string {
  const named = /([\w./-]+\.md)/.exec(raw);
  return named
    ? ` To target another file, write the heading as "## ${named[1]} > <Heading in that file>".`
    : "";
}

/** Parses the pending file. Throws one error listing every format problem. */
export function parsePending(text: string): { preamble: string[]; sections: PendingSection[] } {
  const lines = splitLines(text);
  const headings = scanHeadings(lines);
  const headingAt = new Map(headings.map((heading) => [heading.index, heading]));
  const preamble: string[] = [];
  const sections: PendingSection[] = [];
  const problems: string[] = [];
  let current: { line: number; raw: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const { line, raw } = current;
    const label = `${PENDING_FILE}:${line} section "${raw}"`;
    const body = trimBlank(current.lines);
    const directive = DIRECTIVE.exec(body[0] ?? "");
    const mode = directive?.[1] as FoldMode | undefined;
    if (!directive) {
      problems.push(
        `${label} has no mode marker. Put <!-- append -->, <!-- replace --> or <!-- insert-after --> on the first line of the section body (see the format at the top of the file).${targetHint(raw)}`,
      );
      return;
    }
    if (!mode || !MODES.includes(mode)) {
      problems.push(`${label} has unknown mode <!-- ${directive[1]} -->. Use append, replace or insert-after.`);
      return;
    }
    const content = trimBlank(body.slice(1));
    if (content.length === 0) {
      problems.push(`${label} has no content after its mode marker.`);
      return;
    }
    const bodyHeadings = scanHeadings(content);
    if (mode !== "insert-after" && bodyHeadings.length > 0) {
      problems.push(`${label} contains a heading; only insert-after sections may contain headings.`);
      return;
    }
    if (bodyHeadings.some((heading) => heading.level < 3)) {
      problems.push(`${label} contains a heading above level 3; write body headings at ### or deeper (they are shifted to the target level).`);
      return;
    }
    const target = parseTarget(raw);
    sections.push({ line, file: target.file, path: target.path, mode, body: content });
  };

  lines.forEach((line, index) => {
    const heading = headingAt.get(index);
    if (heading?.level === 2) {
      flush();
      current = { line: index + 1, raw: heading.text, lines: [] };
    } else if (heading?.level === 1) {
      if (current) {
        problems.push(`${PENDING_FILE}:${index + 1} heading "${line}" must be "## <target heading>" (level 2).`);
      } else {
        preamble.push(line);
      }
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  });
  flush();
  if (problems.length > 0) {
    throw new Error(`Invalid ${PENDING_FILE}:\n  ${problems.join("\n  ")}`);
  }
  return { preamble, sections };
}

export function pendingFiles(pending: string): string[] {
  return [...new Set(parsePending(pending).sections.map((section) => section.file))].sort();
}

function validateTargetFile(file: string): void {
  const bad = file.includes("..") || file.startsWith("/") || file === PENDING_FILE;
  if (bad || !(file === "README.md" || file.startsWith("docs/"))) {
    throw new Error(`Pending target file "${file}" must be README.md or a docs/ page (not ${PENDING_FILE}).`);
  }
}

function shiftHeadings(body: string[], targetLevel: number): string[] {
  const headings = scanHeadings(body);
  if (headings.length === 0) return body;
  const shift = targetLevel - Math.min(...headings.map((heading) => heading.level));
  const byIndex = new Map(headings.map((heading) => [heading.index, heading]));
  return body.map((line, index) => {
    const heading = byIndex.get(index);
    if (!heading) return line;
    return `${"#".repeat(Math.max(1, Math.min(6, heading.level + shift)))} ${heading.text}`;
  });
}

function foldSection(file: string, text: string, section: PendingSection): string {
  const lines = splitLines(text);
  const headings = scanHeadings(lines);
  const wanted = section.path;
  const matches = headings.filter(
    (heading) =>
      heading.path.length >= wanted.length &&
      wanted.every((segment, offset) => heading.path[heading.path.length - wanted.length + offset] === segment),
  );
  const where = `${PENDING_FILE}:${section.line} target "${wanted.join(" > ")}" in ${file}`;
  if (matches.length !== 1) {
    throw new Error(`${where} matches ${matches.length} headings; it must match exactly one (add parent headings with " > " to disambiguate).`);
  }
  const heading = matches[0] as Heading;
  const start = heading.index + 1;
  let inFence = false;
  const stops = new Set(headings.map((entry) => entry.index));
  let bodyEnd = start;
  let sectionEnd = start;
  let bodyDone = false;
  let sectionDone = false;
  for (let index = start; index < lines.length && !(bodyDone && sectionDone); index++) {
    const line = lines[index] as string;
    if (FENCE.test(line)) inFence = !inFence;
    const isRule = !inFence && RULE.test(line);
    const atLine = headings.find((entry) => entry.index === index);
    if (!bodyDone) {
      if (stops.has(index) || isRule) bodyDone = true;
      else bodyEnd = index + 1;
    }
    if (!sectionDone) {
      if ((atLine && atLine.level <= heading.level) || isRule) sectionDone = true;
      else sectionEnd = index + 1;
    }
  }
  if (!bodyDone) bodyEnd = lines.length;
  if (!sectionDone) sectionEnd = lines.length;

  if (section.mode === "insert-after") {
    const insertion = shiftHeadings(section.body, heading.level);
    let at = sectionEnd;
    while (at > start && lines[at - 1]?.trim() === "") at--;
    return `${[...lines.slice(0, at), "", ...insertion, ...lines.slice(at)].join("\n")}\n`;
  }
  const existing = trimBlank(lines.slice(start, bodyEnd));
  const body = section.mode === "replace" || existing.length === 0 ? section.body : [...existing, "", ...section.body];
  return `${[...lines.slice(0, start), "", ...body, "", ...lines.slice(bodyEnd)].join("\n")}\n`;
}

export function foldPending(
  documents: Record<string, string>,
  pending: string,
): { documents: Record<string, string>; pending: string; folded: string[] } {
  const parsed = parsePending(pending);
  const result = { ...documents };
  for (const section of parsed.sections) {
    validateTargetFile(section.file);
    const text = result[section.file];
    if (text === undefined) {
      throw new Error(`${PENDING_FILE}:${section.line} targets ${section.file}, which was not provided.`);
    }
    result[section.file] = foldSection(section.file, text, section);
  }
  return {
    documents: result,
    pending: `${parsed.preamble.join("\n").replace(/\n+$/, "")}\n`,
    folded: parsed.sections.map((section) => `${section.mode} ${section.file} > ${section.path.join(" > ")}`),
  };
}

export function loadPendingDocuments(root: string, pending: string): Record<string, string> {
  const documents: Record<string, string> = {};
  for (const file of pendingFiles(pending)) {
    validateTargetFile(file);
    documents[file] = readFileSync(join(root, file), "utf-8");
  }
  return documents;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const pendingPath = join(root, PENDING_FILE);
  const pending = readFileSync(pendingPath, "utf-8");
  try {
    const documents = loadPendingDocuments(root, pending);
    const result = foldPending(documents, pending);
    if (result.folded.length === 0) {
      console.log("No pending README text to fold.");
    } else {
      for (const [file, text] of Object.entries(result.documents)) {
        writeFileSync(join(root, file), text);
      }
      writeFileSync(pendingPath, result.pending);
      console.log(`Folded ${result.folded.length} pending section(s):\n  ${result.folded.join("\n  ")}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
