import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const source = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/ResolveOrderSettings.tsx",
  ),
  "utf8",
);

describe("ResolveOrderSettings", () => {
  test("explains nearest-to-root vs last-in-stack and auto-checks on open", () => {
    expect(source).toContain("Preserve last applied winners");
    expect(source).toContain("closer to the one you applied");
    expect(source).toContain("last-in-stack");
    expect(source).toContain("Last applied winners already match current resolution");
    expect(source).toContain("No apply snapshots to compare");
    expect(source).not.toContain("Convert apply-order to overrides");
    expect(source).toContain("void runPreview()");
    expect(source).toContain("[baseUrl, disabled, runPreview]");
    expect(source).toContain("Check again");
  });

  test("hides write until a preview finds overrides", () => {
    expect(source).toContain("previewed && pendingOverrideCount > 0");
    expect(source).toContain("Write overrides");
  });
});
