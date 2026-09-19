import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STYLES_DIR = join(ROOT, "apps/desktop/src/styles");
const ALLOWED_FILES = new Set(["tokens.css", "base.css"]);
const ALLOW_COMMENT = "/* token-lint: allow */";

interface Rule {
  name: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  { name: "hex color", pattern: /#[0-9a-f]{3,8}\b/i },
  { name: "rgb()/rgba()", pattern: /\brgba?\(/ },
  { name: "font-size px literal", pattern: /font-size:\s*\d+px/ },
  { name: "font-size rem literal", pattern: /font-size:\s*[\d.]+rem/ },
  { name: "z-index literal", pattern: /z-index:\s*-?\d+/ },
];

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function listCssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...listCssFiles(path));
    } else if (path.endsWith(".css")) {
      out.push(path);
    }
  }
  return out.sort();
}

function stripBlockComments(line: string): string {
  return line.replace(/\/\*.*?\*\//g, "");
}

export function findViolations(path: string, contents: string): Violation[] {
  const violations: Violation[] = [];
  const lines = contents.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.includes(ALLOW_COMMENT)) {
      continue;
    }
    const line = stripBlockComments(raw);
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        violations.push({ file: path, line: i + 1, rule: rule.name, text: raw.trim() });
      }
    }
  }
  return violations;
}

export function checkCssTokens(stylesDir: string): Violation[] {
  const violations: Violation[] = [];
  for (const file of listCssFiles(stylesDir)) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    if (ALLOWED_FILES.has(name) && dirname(file) === stylesDir) {
      continue;
    }
    violations.push(...findViolations(file, readFileSync(file, "utf8")));
  }
  return violations;
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === entry) {
  const violations = checkCssTokens(STYLES_DIR);
  if (violations.length > 0) {
    console.error(
      `check-css-tokens: ${violations.length} violation(s). Use design tokens from tokens.css, or add ${ALLOW_COMMENT} on the line.`,
    );
    for (const v of violations) {
      console.error(`  ${relative(ROOT, v.file)}:${v.line}  [${v.rule}]  ${v.text}`);
    }
    process.exit(1);
  }
  console.log("check-css-tokens: ok");
}
