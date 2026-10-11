import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findCopyViolations,
  parseAllowlist,
  scanMarkdownCopy,
  scanTypeScriptCopy,
} from "../../scripts/check-copy.ts";

describe("G3 copy lint", () => {
  it("flags em dashes, en dashes, and ellipsis in string literals", () => {
    const hits = scanTypeScriptCopy(
      "src/copy.ts",
      `const a = "em — dash";\nconst b = "en – dash";\nconst c = "wait…";\n`,
    );
    expect(hits.map((hit) => hit.name)).toEqual([
      "em dash (U+2014)",
      "en dash (U+2013)",
      "ellipsis (U+2026)",
    ]);
  });

  it("ignores comments", () => {
    const hits = scanTypeScriptCopy(
      "src/copy.ts",
      `// em — dash in a comment\n/* en – dash */\nconst ok = "ascii...";\n`,
    );
    expect(hits).toEqual([]);
  });

  it("flags JSX text and template literals", () => {
    const hits = scanTypeScriptCopy(
      "apps/desktop/src/x.tsx",
      `export function Label() { return <span>Loading…</span>; }\nconst t = \`range 1–2\`;\n`,
    );
    expect(hits.length).toBe(2);
  });

  it("flags markdown copy", () => {
    const hits = scanMarkdownCopy("README.md", "Resources — skills, rules.\n");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.name).toBe("em dash (U+2014)");
  });

  it("honors an explicit allowlist entry", () => {
    const root = mkdtempSync(join(tmpdir(), "check-copy-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    mkdirSync(join(root, "apps/desktop/src"), { recursive: true });
    writeFileSync(join(root, "README.md"), "ok\n");
    writeFileSync(join(root, "src/hit.ts"), `export const msg = "Plugin failed — stop.";\n`);
    const scanned = scanTypeScriptCopy("src/hit.ts", `export const msg = "Plugin failed — stop.";\n`);
    const hit = scanned[0];
    expect(hit).toBeDefined();
    const allowlist = parseAllowlist(`${hit?.file}:${hit?.line}:${hit?.column}\n`);
    const remaining = findCopyViolations(root, allowlist);
    expect(remaining).toEqual([]);
  });
});
