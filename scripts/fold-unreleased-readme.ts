import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type FoldMode = "append" | "replace";

interface PendingSection {
  target: string;
  mode: FoldMode;
  body: string[];
}

interface ParsedPending {
  preamble: string[];
  sections: PendingSection[];
}

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const DIRECTIVE = /^<!--\s*(append|replace)\s*-->$/;
const RULE = /^---\s*$/;

/** Heading line index for each non-fenced line, or null. */
function headingAt(lines: string[]): (string | null)[] {
  let inFence = false;
  return lines.map((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return null;
    }
    if (inFence) return null;
    return HEADING.exec(line)?.[2] ?? null;
  });
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

export function parsePending(text: string): ParsedPending {
  const lines = text.replace(/\n$/, "").split("\n");
  const headings = headingAt(lines);
  const preamble: string[] = [];
  const sections: PendingSection[] = [];
  let current: { target: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const body = trimBlank(current.lines);
    const directive = DIRECTIVE.exec(body[0] ?? "");
    if (!directive) {
      throw new Error(`Pending section "${current.target}" must start with <!-- append --> or <!-- replace -->.`);
    }
    const content = trimBlank(body.slice(1));
    if (content.length === 0) {
      throw new Error(`Pending section "${current.target}" has no content.`);
    }
    sections.push({ target: current.target, mode: directive[1] as FoldMode, body: content });
  };
  lines.forEach((line, index) => {
    const heading = headings[index];
    if (heading !== null && heading !== undefined) {
      if (!current && line.startsWith("# ")) {
        preamble.push(line);
      } else if (line.startsWith("## ")) {
        flush();
        current = { target: heading, lines: [] };
      } else {
        throw new Error(`Pending line ${index + 1}: only "## <README section>" headings are allowed (found "${line}").`);
      }
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  });
  flush();
  return { preamble, sections };
}

export function foldReadme(readme: string, pending: string): { readme: string; pending: string; folded: string[] } {
  const parsed = parsePending(pending);
  let lines = readme.replace(/\n$/, "").split("\n");
  for (const section of parsed.sections) {
    const headings = headingAt(lines);
    const matches = headings.flatMap((text, index) => (text === section.target ? [index] : []));
    if (matches.length !== 1) {
      throw new Error(
        `README has ${matches.length} headings named "${section.target}"; each pending section must match exactly one.`,
      );
    }
    const start = (matches[0] as number) + 1;
    let end = start;
    let inFence = false;
    for (; end < lines.length; end++) {
      const line = lines[end] as string;
      if (FENCE.test(line)) inFence = !inFence;
      else if (!inFence && (headings[end] !== null || RULE.test(line))) break;
    }
    const existing = trimBlank(lines.slice(start, end));
    const body = section.mode === "replace" || existing.length === 0 ? section.body : [...existing, "", ...section.body];
    lines = [...lines.slice(0, start), "", ...body, "", ...lines.slice(end)];
  }
  const emptied = `${parsed.preamble.join("\n").replace(/\n+$/, "")}\n`;
  return {
    readme: `${lines.join("\n")}\n`,
    pending: emptied,
    folded: parsed.sections.map((section) => `${section.mode} ${section.target}`),
  };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const readmePath = join(root, "README.md");
  const pendingPath = join(root, "docs", "unreleased-readme.md");
  const result = foldReadme(readFileSync(readmePath, "utf-8"), readFileSync(pendingPath, "utf-8"));
  if (result.folded.length === 0) {
    console.log("No pending README sections to fold.");
  } else {
    writeFileSync(readmePath, result.readme);
    writeFileSync(pendingPath, result.pending);
    console.log(`Folded ${result.folded.length} pending README section(s):\n  ${result.folded.join("\n  ")}`);
  }
}
