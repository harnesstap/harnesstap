import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const repoRoot = join(import.meta.dirname, "../..");
const testRoot = join(repoRoot, "test");

/**
 * bun runs every test file in one process, and mock.module() replaces a module
 * for the rest of that process: the mock is still in place for every test file
 * that runs later. A suite that mocks a src module therefore breaks unrelated
 * suites depending on file order, which changes between runner images.
 * Mock a src function with spyOn() on the module namespace and mockRestore() it
 * in afterAll instead.
 *
 * test/helpers/cli.ts is the shared runCli harness: its wizard mocks forward to
 * the real wizard whenever runCli is not active, so they are safe to keep.
 */
const ALLOWED_FILES = new Set(["test/helpers/cli.ts"]);

function listTestSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "fixtures" || entry.name === "node_modules") continue;
      out.push(...listTestSources(path));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

export function findSrcModuleMocks(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /mock\.module\(\s*["'`]([^"'`]+)["'`]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? "";
    if (/(^|\/)src\//.test(specifier)) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

describe("test module mocks", () => {
  it("finds a mock.module call on a src module", () => {
    // Built at runtime so this file does not match its own scan.
    const call = ["mock", "module"].join(".");
    expect(
      findSrcModuleMocks(
        `${call}("../../../src/services/catalog-client.ts", () => ({}));\n`
          + `${call}("node:fs", () => ({}));\n`,
      ),
    ).toEqual(["../../../src/services/catalog-client.ts"]);
  });

  it("no test file mocks a src module with mock.module", () => {
    const violations: string[] = [];
    for (const path of listTestSources(testRoot)) {
      const rel = relative(repoRoot, path).split(sep).join("/");
      if (ALLOWED_FILES.has(rel)) continue;
      for (const specifier of findSrcModuleMocks(readFileSync(path, "utf8"))) {
        violations.push(`${rel}: ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
