// File discovery and changed-line filtering shared by the design lints.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", ".next", "coverage", "out", "target"]);

export function walk(root, exts) {
  const out = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) visit(path);
      else if (exts.has(extname(name).toLowerCase())) out.push(path);
    }
  };
  if (existsSync(root)) {
    if (statSync(root).isDirectory()) visit(root);
    else out.push(root);
  }
  return out.sort();
}

export function rel(root, path) {
  return relative(root, path).split(sep).join("/");
}

// Patterns are plain path fragments: "tokens.css" matches any file named
// tokens.css, "test/" matches anything under a test directory, and a leading
// "*" means "ends with" (for example "*.test.ts").
export function matchesAny(relPath, patterns) {
  const p = `/${relPath}`;
  return patterns.some((pat) => {
    if (pat.startsWith("*")) return relPath.endsWith(pat.slice(1));
    if (pat.endsWith("/")) return p.includes(`/${pat}`);
    return p.endsWith(`/${pat}`) || relPath === pat;
  });
}

// Returns Map<relPath, Set<lineNumber>> of lines added since `base`, or null.
export function changedLines(cwd, base) {
  if (!base) return null;
  const diff = execFileSync("git", ["diff", "--unified=0", "--no-color", `${base}...HEAD`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const map = new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : null;
      if (file && !map.has(file)) map.set(file, new Set());
    } else if (file && line.startsWith("@@")) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (m) {
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        for (let k = 0; k < count; k++) map.get(file).add(start + k);
      }
    }
  }
  return map;
}

export function readAllowlist(path) {
  if (!path || !existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );
}

export function parseArgs(argv, spec) {
  const args = { _: [] };
  for (const [k, v] of Object.entries(spec)) args[k] = Array.isArray(v) ? [...v] : v;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (!(key in spec)) throw new Error(`Unknown flag ${a}`);
    if (typeof spec[key] === "boolean") args[key] = true;
    else if (Array.isArray(spec[key])) args[key].push(argv[++i]);
    else args[key] = argv[++i];
  }
  return args;
}
