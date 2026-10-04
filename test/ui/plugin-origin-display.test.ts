import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatPluginOriginDisplay } from "../../src/ui/plugin-origin-display.ts";

const SRC_ROOT = join(import.meta.dir, "../../src");

function collectRelativeImports(fromFile: string, seen: Set<string>): void {
  if (seen.has(fromFile)) {
    return;
  }
  seen.add(fromFile);
  const source = readFileSync(fromFile, "utf8");
  const matches = source.matchAll(
    /^(?!import type |export type ).*from ["'](\.\.?\/[^"']+)["']/gm,
  );
  for (const match of matches) {
    const spec = match[1];
    if (!spec) {
      continue;
    }
    const resolved = join(dirname(fromFile), spec.replace(/\.js$/, ".ts"));
    collectRelativeImports(resolved, seen);
  }
}

describe("formatPluginOriginDisplay", () => {
  it("keeps authored as authored", () => {
    expect(formatPluginOriginDisplay("authored")).toBe("authored");
    expect(formatPluginOriginDisplay("authored", "ignored@mkt")).toBe("authored");
  });

  it("shows the marketplace name for upstream marketplace locators", () => {
    expect(
      formatPluginOriginDisplay("upstream", "code-review-workflow@claude-plugins"),
    ).toBe("claude-plugins");
  });

  it("shows catalog org/catalog and git locators", () => {
    expect(formatPluginOriginDisplay("catalog", "acme/default/focus")).toBe(
      "acme/default",
    );
    expect(
      formatPluginOriginDisplay("upstream", "https://github.com/acme/plugin.git"),
    ).toBe("https://github.com/acme/plugin.git");
  });

  it("falls back to the origin kind when there is no locator", () => {
    expect(formatPluginOriginDisplay("upstream")).toBe("upstream");
    expect(formatPluginOriginDisplay("catalog", "")).toBe("catalog");
  });

  it("stays off Node/db modules so desktop can re-export it", () => {
    const seen = new Set<string>();
    collectRelativeImports(join(SRC_ROOT, "ui/plugin-origin-display.ts"), seen);
    const files = [...seen].map((file) => file.slice(SRC_ROOT.length + 1));
    expect(files.some((file) => file.startsWith("db/") || file.startsWith("models/"))).toBe(
      false,
    );
    expect(files.some((file) => file.startsWith("services/"))).toBe(false);
  });
});
