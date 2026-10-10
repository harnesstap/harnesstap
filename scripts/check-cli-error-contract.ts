import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
      continue;
    }
    if (path.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

const root = join(import.meta.dir, "../src/cli/commands");
const violations: string[] = [];

for (const file of walk(root)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.includes("ui.danger(")) {
      violations.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  }
}

if (violations.length > 0) {
  console.error("G6: ui.danger( is banned in src/cli/commands. Use fail().");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}
