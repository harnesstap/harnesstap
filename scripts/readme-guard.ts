import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { foldPending, loadPendingDocuments, PENDING_FILE } from "./fold-unreleased-readme.ts";

export interface SurfaceNode {
  aliases: string[];
  flags: string[];
  args: number;
  subcommands: Record<string, SurfaceNode>;
}

export interface CliSurface {
  version: string;
  root: SurfaceNode;
}

export interface Invocation {
  line: number;
  text: string;
}

export interface Finding {
  file: string;
  line: number;
  message: string;
}

export const VERSION_GATED_PATTERNS: RegExp[] = [
  /\bAvailable from\b/i,
  /\bOn v?1\.\d/i,
  /\bcoming (?:in|soon)\b/i,
  /\bsince v?1\./i,
  /\bnew in\b/i,
];

/** Profile names the README uses as `ht <name>` examples; the shorthand resolves at runtime, not from the command tree. */
export const SHORTHAND_PROFILES = new Set(["work", "default"]);

const SHELL_FENCE_LANGS = new Set(["", "bash", "sh", "shell", "zsh", "console"]);
const FENCE = /^\s*```(\S*)/;

export function findVersionGatedPhrases(file: string, markdown: string): Finding[] {
  const findings: Finding[] = [];
  markdown.split("\n").forEach((text, index) => {
    for (const pattern of VERSION_GATED_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          file,
          line: index + 1,
          message: `version-gated phrase "${match[0]}": describe only the latest published release`,
        });
      }
    }
  });
  return findings;
}

export function extractHtInvocations(markdown: string): Invocation[] {
  const found: Invocation[] = [];
  let fenceLang: string | null = null;
  markdown.split("\n").forEach((raw, index) => {
    const fence = FENCE.exec(raw);
    if (fence) {
      fenceLang = fenceLang === null ? (fence[1] ?? "").toLowerCase() : null;
      return;
    }
    if (fenceLang !== null) {
      if (!SHELL_FENCE_LANGS.has(fenceLang)) return;
      const line = raw
        .replace(/\s#.*$/, "")
        .split(/\s(?:\|\||&&|\|)\s|;/)[0]
        ?.trim();
      if (line && (line === "ht" || line.startsWith("ht "))) {
        found.push({ line: index + 1, text: line });
      }
      return;
    }
    for (const span of raw.matchAll(/`([^`\n]+)`/g)) {
      const text = (span[1] ?? "").trim();
      if (text === "ht" || text.startsWith("ht ")) {
        found.push({ line: index + 1, text });
      }
    }
  });
  return found;
}

function resolvePath(surface: CliSurface, words: string[]): SurfaceNode | null {
  let node = surface.root;
  for (const word of words) {
    const child = findChild(node, word);
    if (!child) return null;
    node = child;
  }
  return node;
}

function subtreeFlags(node: SurfaceNode, into: Set<string>): void {
  for (const flag of node.flags) into.add(flag);
  for (const child of Object.values(node.subcommands)) subtreeFlags(child, into);
}

function commandWords(text: string, surface: CliSurface): string[] {
  const words: string[] = [];
  let node = surface.root;
  for (const token of tokenize(text)) {
    const child = flagName(token) || isPlaceholder(token) ? null : findChild(node, token);
    if (!child) break;
    words.push(token);
    node = child;
  }
  return words;
}

function headingContext(text: string, surface: CliSurface): string[] | null {
  if (text === "Global options") return [];
  const words = text.replace(/\s*\(.*$/, "").trim().split(/\s+/);
  return resolvePath(surface, words) ? words : null;
}

/**
 * Command reference pages list commands without the `ht` prefix (`plugin list --remote`) and bare flags under a
 * command heading. Turn those spans into checkable findings.
 */
export function checkReferenceSurface(file: string, markdown: string, surface: CliSurface): Finding[] {
  const findings: Finding[] = checkCommandSurface(file, markdown, surface);
  const report = (line: number, text: string, problem: string) =>
    findings.push({ file, line, message: `${problem} (in \`${text}\`)` });
  let sectionContext: string[] | null = null;
  let context: string[] | null = null;
  let inFence = false;
  markdown.split("\n").forEach((raw, index) => {
    const line = index + 1;
    if (FENCE.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const heading = /^(#{2,3})\s+(.+?)\s*$/.exec(raw);
    if (heading) {
      const resolved = headingContext(heading[2] as string, surface);
      if (heading[1] === "##") {
        sectionContext = resolved;
        context = resolved;
      } else {
        context = resolved ?? sectionContext;
      }
      return;
    }
    // Lines that say a flag or command is absent ("Does not take `--global`") name it on purpose.
    if (/\b(?:not|no|removed|never|without)\b/i.test(raw)) return;
    let lineContext: string[] | null = null;
    for (const span of raw.matchAll(/`([^`\n]+)`/g)) {
      const text = (span[1] ?? "").trim().replace(/,\s/g, " ");
      const first = tokenize(text)[0] ?? "";
      if (text === "ht" || text.startsWith("ht ")) {
        continue;
      } else if (flagName(first)) {
        const spanContext = lineContext ?? context;
        if (!spanContext) continue;
        const node = resolvePath(surface, spanContext) as SurfaceNode;
        const known = new Set<string>(["--help", "-h"]);
        for (const flag of surface.root.flags) known.add(flag);
        if (spanContext.length > 0) subtreeFlags(node, known);
        let walk = surface.root;
        for (const word of spanContext) {
          walk = findChild(walk, word) as SurfaceNode;
          for (const flag of walk.flags) known.add(flag);
        }
        for (const token of tokenize(text)) {
          const flag = flagName(token);
          if (flag && !known.has(flag)) {
            report(line, text, `flag ${flag} is not available on \`${["ht", ...spanContext].join(" ")}\``);
          }
        }
      } else if (findChild(surface.root, first)) {
        lineContext = commandWords(text, surface);
        for (const problem of checkInvocation(`ht ${text}`, surface)) report(line, text, problem);
      }
    }
  });
  return findings;
}

function tokenize(text: string): string[] {
  return text.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function flagName(token: string): string | null {
  if (!token.startsWith("-") || token === "-" || token === "--" || /^-\d/.test(token)) {
    return null;
  }
  return token.split("=")[0] ?? null;
}

function isPlaceholder(token: string): boolean {
  return token.startsWith("<") || token.startsWith("[") || token === "..." || token === "\u2026";
}

function findChild(node: SurfaceNode, name: string): SurfaceNode | null {
  const direct = node.subcommands[name];
  if (direct) return direct;
  return Object.values(node.subcommands).find((child) => child.aliases.includes(name)) ?? null;
}

export function checkInvocation(text: string, surface: CliSurface): string[] {
  const tokens = tokenize(text).slice(1);
  const problems: string[] = [];
  const chain: SurfaceNode[] = [surface.root];
  const path: string[] = [];
  let index = 0;
  let stoppedOn: string | null = null;

  for (; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    if (flagName(token)) {
      if (path.length > 0) break;
      continue;
    }
    if (isPlaceholder(token)) break;
    const node = chain[chain.length - 1] as SurfaceNode;
    if (token.includes("|")) {
      const missing = token.split("|").filter((alternative) => !findChild(node, alternative));
      if (missing.length > 0) problems.push(`\`ht ${path.join(" ")} ${missing.join("|")}\` is not a subcommand in harnesstap@${surface.version}`);
      return problems;
    }
    const child = findChild(node, token);
    if (child) {
      chain.push(child);
      path.push(token);
      continue;
    }
    stoppedOn = token;
    break;
  }

  const current = chain[chain.length - 1] as SurfaceNode;
  if (stoppedOn !== null) {
    if (path.length === 0) {
      if (!SHORTHAND_PROFILES.has(stoppedOn)) {
        problems.push(`\`ht ${stoppedOn}\` is not a command in harnesstap@${surface.version}`);
      }
    } else if (Object.keys(current.subcommands).length > 0 && current.args === 0) {
      problems.push(`\`ht ${path.join(" ")} ${stoppedOn}\` is not a subcommand in harnesstap@${surface.version}`);
    }
  }

  const known = new Set<string>(["--help", "-h"]);
  for (const node of chain) {
    for (const flag of node.flags) known.add(flag);
  }
  for (const token of tokens) {
    const flag = flagName(token);
    if (flag && !known.has(flag)) {
      problems.push(`flag ${flag} is not available on \`${["ht", ...path].join(" ")}\``);
    }
  }
  return problems;
}

export function checkCommandSurface(file: string, markdown: string, surface: CliSurface): Finding[] {
  const findings: Finding[] = [];
  for (const invocation of extractHtInvocations(markdown)) {
    for (const problem of checkInvocation(invocation.text, surface)) {
      findings.push({
        file,
        line: invocation.line,
        message: `${problem} (in \`${invocation.text}\`)`,
      });
    }
  }
  return findings;
}

export function listMarkdownFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "internal" || rel === join("docs", "scenarios", "vhs")) continue;
      out.push(...listMarkdownFiles(root, rel));
    } else if (entry.name.endsWith(".md")) {
      out.push(rel);
    }
  }
  return out.sort();
}

/** Files whose text may render on harnesstap.com: README plus everything under docs/ (the site build is not in this repo). */
export function publishedDocFiles(root: string): string[] {
  return ["README.md", ...listMarkdownFiles(root, "docs").filter((file) => file !== join("docs", "unreleased-readme.md"))];
}

export function loadSurface(path: string): CliSurface {
  return JSON.parse(readFileSync(path, "utf-8")) as CliSurface;
}

export const SITE_REFERENCE_DOCS = [join("docs", "cli", "command-reference.md")];

export function checkPending(root: string): Finding[] {
  const pending = readFileSync(join(root, PENDING_FILE), "utf-8");
  try {
    foldPending(loadPendingDocuments(root, pending), pending);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => ({ file: PENDING_FILE, line: Number(/:(\d+)\b/.exec(line)?.[1] ?? 1), message: line }));
  }
}

export function runReleasedGuard(root: string, surface: CliSurface): Finding[] {
  const findings: Finding[] = [];
  for (const file of publishedDocFiles(root)) {
    findings.push(...findVersionGatedPhrases(file, readFileSync(join(root, file), "utf-8")));
  }
  const pending = join("docs", "unreleased-readme.md");
  findings.push(...findVersionGatedPhrases(pending, readFileSync(join(root, pending), "utf-8")));
  findings.push(...checkCommandSurface("README.md", readFileSync(join(root, "README.md"), "utf-8"), surface));
  for (const file of SITE_REFERENCE_DOCS) {
    findings.push(...checkReferenceSurface(file, readFileSync(join(root, file), "utf-8"), surface));
  }
  findings.push(...checkPending(root));
  return findings;
}
