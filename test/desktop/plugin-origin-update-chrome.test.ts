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
  test("plugin package detail has an icon-only Update action", () => {
    expect(detailSource).toContain('label="Update"');
    expect(detailSource).toContain("CloudDownload");
  });

  test("DESIGN.md locks Update all and plugin Update vs Sync", () => {
    expect(designSource).toContain("Update all");
    expect(designSource).toContain("whole plugin package");
    expect(designSource).toContain("Never labeled Sync");
  });

  test("ResourcesPanel assembles Update N plugins from origin confirm copy", () => {
    expect(panelSource).toContain("Update from origin");
    expect(panelSource).toContain("Update ${count} plugin");
    expect(panelSource).toContain("from origin?");
  });

  test("ResourcesPanel clears originOutdatedIds when origin check fails", () => {
    const originCheck = panelSource.slice(
      panelSource.indexOf("void fetchPluginOriginCheck"),
    );
    const catchStart = originCheck.indexOf(".catch(");
    const catchBody = originCheck.slice(
      catchStart,
      originCheck.indexOf("});", catchStart) + 3,
    );
    expect(catchBody).toContain("setOriginOutdatedIds(new Set())");
  });
});
