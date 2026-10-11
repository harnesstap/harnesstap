import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

function tokenize(text: string): string[] {
  return text.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function flagName(token: string): string | null {
  if (!token.startsWith("-") || token === "-" || token === "--" || /^-\d/.test(token)) {
    return null;
  }
  return token.split("=")[0] ?? null;
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
    const node = chain[chain.length - 1] as SurfaceNode;
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
  if (stoppedOn !== null && !stoppedOn.startsWith("<")) {
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

export function runReleasedGuard(root: string, surface: CliSurface): Finding[] {
  const findings: Finding[] = [];
  for (const file of publishedDocFiles(root)) {
    findings.push(...findVersionGatedPhrases(file, readFileSync(join(root, file), "utf-8")));
  }
  const pending = join("docs", "unreleased-readme.md");
  findings.push(...findVersionGatedPhrases(pending, readFileSync(join(root, pending), "utf-8")));
  findings.push(...checkCommandSurface("README.md", readFileSync(join(root, "README.md"), "utf-8"), surface));
  return findings;
}
