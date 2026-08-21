import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const detailSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/PluginPackageDetail.tsx",
  ),
  "utf8",
);
const panelSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourcesPanel.tsx",
  ),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

describe("plugin origin update chrome", () => {
  test("plugin package detail has a labeled Update action", () => {
    expect(
      detailSource.includes(">Update<") || detailSource.includes("Update</"),
    ).toBe(true);
  });

  test("DESIGN.md locks Update all and origin fetch vs Sync", () => {
    expect(designSource).toContain("Update all");
    expect(designSource).toContain("origin fetch");
  });

  test("ResourcesPanel assembles Update N plugins from origin confirm copy", () => {
    expect(panelSource).toContain("Update from origin");
    expect(panelSource).toContain("Update ${count} plugin");
    expect(panelSource).toContain("from origin?");
  });
});
