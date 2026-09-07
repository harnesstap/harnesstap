import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const modalSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourceTypeModal.tsx",
  ),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

describe("create-resource type picker Import", () => {
  test("puts a primary labeled Import action in the type-picker header", () => {
    expect(modalSource).toContain("What do you want to create?");
    expect(modalSource).toContain('data-testid="resource-type-import"');
    expect(modalSource).toContain('label="Import"');
    expect(modalSource).toContain("showLabel");
    expect(modalSource).toContain("primary");
    expect(modalSource).toContain("FolderDown");
    expect(modalSource).toContain("resource-type-header-actions");
  });

  test("keeps the create-from-scratch type list", () => {
    expect(modalSource).toContain("CREATE_RESOURCE_TYPES.map");
    expect(modalSource).toContain("resource-type-option");
  });

  test("opens a GitHub paste field instead of adding Import to the type list", () => {
    expect(modalSource).toContain("Import from GitHub");
    expect(modalSource).toContain('data-testid="resource-type-import-source"');
    expect(modalSource).toContain("gh:owner/repo");
    expect(modalSource).not.toContain("resource-type-option-import");
  });

  test("documents the type-picker header Import in DESIGN.md", () => {
    expect(designSource).toContain("primary labeled **Import**");
    expect(designSource).toContain("gh:owner/repo");
  });
});
