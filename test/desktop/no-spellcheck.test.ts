import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  documentNoSpellcheckAttrs,
  noSpellcheckProps,
} from "../../apps/desktop/src/lib/no-spellcheck.ts";

const root = join(import.meta.dir, "../..");

function readApp(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("desktop field spelling correction", () => {
  test("shared props turn off spellcheck, autocorrect, autocapitalize, and autocomplete", () => {
    expect(noSpellcheckProps).toEqual({
      autoComplete: "off",
      autoCorrect: "off",
      autoCapitalize: "off",
      spellCheck: false,
    });
    expect(documentNoSpellcheckAttrs).toEqual({
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
    });
  });

  test("Input and Textarea apply the shared props after caller props", () => {
    const input = readApp("apps/desktop/src/components/ui/input.tsx");
    const textarea = readApp("apps/desktop/src/components/ui/textarea.tsx");
    expect(input).toContain('from "@/lib/no-spellcheck"');
    expect(input).toContain("{...props}");
    expect(input.indexOf("{...props}")).toBeLessThan(
      input.indexOf("{...noSpellcheckProps}"),
    );
    expect(textarea).toContain("{...noSpellcheckProps}");
    expect(textarea.indexOf("{...props}")).toBeLessThan(
      textarea.indexOf("{...noSpellcheckProps}"),
    );
  });

  test("document root disables inherited WebKit spelling correction", () => {
    const html = readApp("apps/desktop/index.html");
    expect(html).toContain('spellcheck="false"');
    expect(html).toContain('autocorrect="off"');
    expect(html).toContain('autocapitalize="off"');
  });

  test("Library search, Harnesses filter, and profile filter spread the shared props", () => {
    const library = readApp(
      "apps/desktop/src/components/ResourceFilterSidebar.tsx",
    );
    const harnesses = readApp(
      "apps/desktop/src/components/live/LiveHeader.tsx",
    );
    const profiles = readApp(
      "apps/desktop/src/components/shell/ProfilesRail.tsx",
    );
    expect(library).toContain('placeholder="Filter by name"');
    expect(library).toContain("{...noSpellcheckProps}");
    expect(harnesses).toContain('placeholder="Filter resources"');
    expect(harnesses).toContain("{...noSpellcheckProps}");
    expect(profiles).toContain('placeholder="Filter profiles..."');
    expect(profiles).toContain("{...noSpellcheckProps}");
  });

  test("DESIGN.md forbids spelling correction on every field", () => {
    const design = readApp("apps/desktop/DESIGN.md");
    expect(design).toContain("never spell-check, autocorrect, autocapitalize");
    expect(design).toContain("noSpellcheckProps");
  });
});
