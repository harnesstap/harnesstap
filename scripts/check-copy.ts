import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const FORBIDDEN_COPY_CHARS = [
  { char: "\u2014", name: "em dash (U+2014)" },
  { char: "\u2013", name: "en dash (U+2013)" },
  { char: "\u2026", name: "ellipsis (U+2026)" },
] as const;

export interface CopyViolation {
  file: string;
  line: number;
  column: number;
  name: string;
  text: string;
}

export interface AllowlistEntry {
  file: string;
  line: number;
  column: number;
}

const TS_SCRIPT_KIND: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
};

function walkFiles(dir: string, suffixes: readonly string[]): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") {
      continue;
    }
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...walkFiles(path, suffixes));
      continue;
    }
    if (suffixes.some((suffix) => path.endsWith(suffix))) {
      out.push(path);
    }
  }
  return out.sort();
}

export function parseAllowlist(contents: string): AllowlistEntry[] {
  const entries: AllowlistEntry[] = [];
  for (const raw of contents.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const match = /^(.+):(\d+):(\d+)$/.exec(line);
    if (!match || !match[1] || !match[2] || !match[3]) {
      throw new Error(`Invalid copy allowlist entry: ${line}`);
    }
    entries.push({
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
    });
  }
  return entries;
}

function isAllowed(
  violation: CopyViolation,
  allowlist: readonly AllowlistEntry[],
): boolean {
  return allowlist.some(
    (entry) =>
      entry.file === violation.file
      && entry.line === violation.line
      && entry.column === violation.column,
  );
}

function snippet(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 80 ? `${collapsed.slice(0, 77)}...` : collapsed;
}

function charsInText(
  file: string,
  text: string,
  startLine: number,
  startColumn: number,
): CopyViolation[] {
  const violations: CopyViolation[] = [];
  let line = startLine;
  let column = startColumn;
  for (const char of text) {
    for (const forbidden of FORBIDDEN_COPY_CHARS) {
      if (char === forbidden.char) {
        violations.push({
          file,
          line,
          column,
          name: forbidden.name,
          text: snippet(text),
        });
      }
    }
    if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return violations;
}

function visitTsCopy(
  sourceFile: ts.SourceFile,
  file: string,
  node: ts.Node,
  out: CopyViolation[],
): void {
  switch (node.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.TemplateHead:
    case ts.SyntaxKind.TemplateMiddle:
    case ts.SyntaxKind.TemplateTail:
    case ts.SyntaxKind.JsxText: {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile, false),
      );
      out.push(
        ...charsInText(
          file,
          node.getText(sourceFile),
          line + 1,
          character + 1,
        ),
      );
      break;
    }
    default:
      break;
  }
  ts.forEachChild(node, (child) => {
    visitTsCopy(sourceFile, file, child, out);
  });
}

export function scanTypeScriptCopy(file: string, contents: string): CopyViolation[] {
  const ext = file.endsWith(".tsx") ? ".tsx" : ".ts";
  const sourceFile = ts.createSourceFile(
    file,
    contents,
    ts.ScriptTarget.Latest,
    true,
    TS_SCRIPT_KIND[ext],
  );
  const out: CopyViolation[] = [];
  visitTsCopy(sourceFile, file, sourceFile, out);
  return out;
}

export function scanMarkdownCopy(file: string, contents: string): CopyViolation[] {
  return charsInText(file, contents, 1, 1);
}

export function collectCopyFiles(root = ROOT): string[] {
  const tsFiles = [
    ...walkFiles(join(root, "src"), [".ts", ".tsx"]),
    ...walkFiles(join(root, "apps/desktop/src"), [".ts", ".tsx"]),
  ];
  const mdFiles = [
    join(root, "README.md"),
    ...walkFiles(join(root, "docs"), [".md"]),
  ].filter((path) => existsSync(path));
  return [...tsFiles, ...mdFiles].sort();
}

export function findCopyViolations(
  root = ROOT,
  allowlist: readonly AllowlistEntry[] = [],
): CopyViolation[] {
  const violations: CopyViolation[] = [];
  for (const abs of collectCopyFiles(root)) {
    const file = relative(root, abs).replaceAll("\\", "/");
    const contents = readFileSync(abs, "utf8");
    const found = file.endsWith(".md")
      ? scanMarkdownCopy(file, contents)
      : scanTypeScriptCopy(file, contents);
    for (const violation of found) {
      if (!isAllowed(violation, allowlist)) {
        violations.push(violation);
      }
    }
  }
  return violations;
}

export function loadAllowlist(root = ROOT): AllowlistEntry[] {
  const path = join(root, "scripts/copy-allowlist.txt");
  if (!existsSync(path)) {
    return [];
  }
  return parseAllowlist(readFileSync(path, "utf8"));
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === entry) {
  const allowlist = loadAllowlist();
  const violations = findCopyViolations(ROOT, allowlist);
  if (violations.length > 0) {
    console.error(
      "G3: user-facing copy must not use em dashes, en dashes, or Unicode ellipsis.",
    );
    for (const violation of violations) {
      console.error(
        `  ${violation.file}:${violation.line}:${violation.column}: ${violation.name}: ${violation.text}`,
      );
    }
    process.exit(1);
  }
}
