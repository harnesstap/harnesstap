import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "bun:test";
import ts from "typescript";
import {
  NO_COMMANDS_RULE,
  commandInstructionIn,
} from "../../apps/desktop/src/lib/command-instructions.ts";

const REPO = join(import.meta.dir, "../..");
const DESKTOP_SRC = join(REPO, "apps/desktop/src");

/**
 * Strings that match a pattern but are data, not instructions. Keep this tight:
 * file plus the exact text, with the reason.
 */
const ALLOWLIST: readonly { file: string; text: string; why: string }[] = [
  {
    file: "apps/desktop/src/lib/discover-error.ts",
    text: "Catalog request timed out (30s). Try again, or list local plugins without --remote.",
    why: "the CLI message Desktop matches so it can show its own copy instead",
  },
  {
    file: "apps/desktop/src/lib/resource-create-schema.ts",
    text: "npx -y some-server",
    why: "example value for an MCP server's command field",
  },
  {
    file: "apps/desktop/src/lib/resource-create-schema.ts",
    text: "Bash(npm run *)",
    why: "example value for a permission rule",
  },
];

interface Hit {
  file: string;
  line: number;
  pattern: string;
  text: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return walk(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Text of a string, template, or JSX text node; substitutions read as "x". */
function nodeText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `x${span.literal.text}`).join("");
  }
  if (ts.isJsxText(node)) {
    return node.text;
  }
  return null;
}

function scanDesktopStrings(file: string, contents: string): Hit[] {
  const source = ts.createSourceFile(
    file,
    contents,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: Hit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      return;
    }
    const text = nodeText(node);
    if (text !== null) {
      const pattern = commandInstructionIn(text);
      if (pattern) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        hits.push({ file, line: line + 1, pattern, text: text.replace(/\s+/g, " ").trim() });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function allowed(hit: Hit): boolean {
  return ALLOWLIST.some((entry) => entry.file === hit.file && entry.text === hit.text);
}

describe("Desktop never asks the user to run a command", () => {
  it("no Desktop string reads like a command instruction", () => {
    const hits = walk(DESKTOP_SRC).flatMap((abs) => {
      const file = relative(REPO, abs).replaceAll("\\", "/");
      return scanDesktopStrings(file, readFileSync(abs, "utf8"));
    });
    const offending = hits.filter((hit) => !allowed(hit));
    const report = offending
      .map((hit) => `  ${hit.file}:${hit.line} [${hit.pattern}] ${hit.text}`)
      .join("\n");
    expect(
      offending.length,
      `${NO_COMMANDS_RULE}\nThese strings read like command instructions:\n${report}`,
    ).toBe(0);
  });

  it("every allowlist entry still matches a real string", () => {
    const texts = new Set(
      ALLOWLIST.map((entry) => entry.file).flatMap((file) =>
        scanDesktopStrings(file, readFileSync(join(REPO, file), "utf8")).map(
          (hit) => `${hit.file}\n${hit.text}`,
        ),
      ),
    );
    for (const entry of ALLOWLIST) {
      expect(texts.has(`${entry.file}\n${entry.text}`), `stale allowlist entry: ${entry.text}`).toBe(true);
    }
  });

  it("catches the instructions it is meant to catch", () => {
    for (const text of [
      "Run ht harness set, or pass --harness <slugs>.",
      "Undo with ht revert 01ARZ",
      "ht approve acme/hooks",
      "Add a remote: git remote add origin <url>",
      "Check that the HarnessTap agent is running, then try again.",
      "Run `harnesstap scan .`",
      "Open a terminal and type it",
      "Install it with npm install -g harnesstap",
      "Re-run without --no-pull.",
      "Use the CLI for this",
    ]) {
      expect(commandInstructionIn(text), text).not.toBeNull();
    }
  });

  it("leaves plain copy and harness names alone", () => {
    for (const text of [
      "Gemini CLI",
      "Copilot CLI",
      "No git remote origin configured.",
      "Detect the agents on this machine to apply profiles.",
      "Restart agent",
      "terminal",
      "--radius-sm",
    ]) {
      expect(commandInstructionIn(text), text).toBeNull();
    }
  });
});
