import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const paneSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourceDetailPane.tsx",
  ),
  "utf8",
);
const bodySource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourceDetailBody.tsx",
  ),
  "utf8",
);
const fieldRowSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/LibraryFieldRow.tsx",
  ),
  "utf8",
);
const stylesSource = readDesktopCss();
const pathAccessSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/PathAccessActions.tsx",
  ),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

function cssBlock(source: string, selector: string): string {
  const needle = `\n${selector} {`;
  const start = source.indexOf(needle);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 1);
}

describe("resource inspect dialog layout", () => {
  test("keeps the inspect overlay as a dialog, not a full-screen panel", () => {
    expect(paneSource).toContain("dialog-backdrop resource-detail-backdrop");
    expect(paneSource).toContain("dialog resource-detail-dialog");
    expect(paneSource).not.toContain("full-screen-panel");
  });

  test("dialog rules beat generic .dialog width and stay inside the viewport", () => {
    const dialogIdx = stylesSource.indexOf("\n.dialog {");
    const inspectIdx = stylesSource.indexOf("\n.dialog.resource-detail-dialog {");
    expect(dialogIdx).toBeGreaterThan(-1);
    expect(inspectIdx).toBeGreaterThan(dialogIdx);
    const dialog = cssBlock(stylesSource, ".dialog.resource-detail-dialog");
    expect(dialog).toContain("max-height");
    expect(dialog).toContain("overflow: hidden");
    expect(dialog).toContain("flex-direction: column");
    const body = cssBlock(stylesSource, ".resource-detail-body");
    expect(body).toContain("overflow-y: auto");
    expect(body).toContain("min-height: 0");
  });
});

describe("resource inspect content preview", () => {
  test("renders content in a code block using the 15-line preview helper", () => {
    expect(bodySource).toContain("previewResourceContent");
    expect(bodySource).toContain("RESOURCE_CONTENT_PREVIEW_LINES");
    expect(bodySource).toContain("<pre");
    expect(bodySource).toContain("resource-detail-content");
    expect(bodySource).toContain("<code>");
  });

  test("keeps path copy, Finder reveal, and open-in-editor on Path and contained file rows", () => {
    expect(bodySource).toContain("PathAccessActions");
    expect(bodySource).toContain("REVEAL_PATH_LABEL");
    expect(bodySource).toContain("renderPathActions(actionPath, !resourcePathIsDirectory(detail), true)");
    expect(bodySource).toContain("openContainedPath(next, true)");
    expect(bodySource).toContain("openCurrentResource(true)");
    expect(bodySource).toContain("{ path, reveal }");
    expect(bodySource).toContain('fieldName="Path"');
    const contentBlock = bodySource.slice(bodySource.indexOf('fieldName="Content"'));
    expect(contentBlock).not.toContain("action={renderPathActions");
    expect(bodySource).toContain("onReveal={(path) => void openContainedPath(path, true)}");
    expect(bodySource).toContain("onOpenEditor={(path) => void openContainedPath(path, false)}");
    const nonPluginSection = bodySource.slice(bodySource.indexOf('fieldName="Description"'));
    expect(nonPluginSection).toContain("PluginRefResourceList");
    expect(nonPluginSection).toContain("detail.contained_resources");
    expect(fieldRowSource).toContain("action?: ReactNode");
    expect(fieldRowSource).toContain("onIconClick");
    expect(pathAccessSource).toContain("COPY_PATH_LABEL");
    expect(pathAccessSource).toContain("REVEAL_PATH_LABEL");
    expect(pathAccessSource).toContain("FolderOpen");
    expect(pathAccessSource).toContain("Copy");
  });

  test("uses even field-row gap without per-row vertical margin", () => {
    const body = cssBlock(stylesSource, ".resource-detail-body");
    expect(body).toContain("gap: 0.75rem");
    const libraryBody = cssBlock(stylesSource, ".library-detail-body");
    expect(libraryBody).toContain("gap: 0.75rem");
    const row = cssBlock(stylesSource, ".library-field-row");
    expect(row).toContain("margin: 0");
    expect(row).not.toContain("margin: 0.5rem 0");
  });

  test("field rows expose a Pencil edit trigger and skip the delete-plan banner", () => {
    expect(fieldRowSource).toContain('label="Edit"');
    expect(fieldRowSource).toContain("Pencil");
    expect(fieldRowSource).toContain("library-field-edit-trigger");
    expect(bodySource).not.toContain("Delete from library + disk is unavailable");
    expect(bodySource).toContain('label="Disk delete blocked"');
    expect(bodySource).toContain("onRegisterCancelFieldEdit");
  });

  test("plugin details expose a filterable Version combobox and Pull", () => {
    expect(bodySource).toContain('fieldName="Version"');
    expect(bodySource).toContain("switchLibraryPluginVersion");
    expect(bodySource).toContain("hostPluginVersionOptions");
    expect(bodySource).toContain("Combobox");
    expect(bodySource).toContain("library-field-version-select");
    expect(bodySource).toContain('label="Pull"');
    expect(bodySource).toContain("pullLibraryPluginVersions");
    expect(bodySource).not.toContain("typeLabel={typeLabel}");
    expect(designSource).toContain("**Version** is a filterable combobox");
    expect(designSource).toContain("no type label beside those actions");
  });

  test("DESIGN.md locks inspect as a viewport-capped dialog with a 15-line code block", () => {
    expect(designSource).toContain("15-line");
    expect(designSource).toContain("code block");
    expect(designSource).toContain("open-in-editor");
    expect(designSource).toContain("Reveal in Finder");
    expect(designSource).toContain("viewport-capped");
  });
});
