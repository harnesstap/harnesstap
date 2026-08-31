import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

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
const stylesSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/styles.css"),
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

  test("keeps open-in-editor on Path rows only, not header or Content", () => {
    expect(bodySource).toContain("ExternalLink");
    expect(bodySource).toContain("Open this file in the default editor.");
    const actionOpens = [
      ...bodySource.matchAll(/action=\{renderOpenInEditor\(editorPath\)\}/g),
    ];
    expect(actionOpens).toHaveLength(2);
    expect(bodySource).toContain('fieldName="Path"');
    expect(bodySource).not.toContain("{renderOpenInEditor(editorPath)}\n                {actionButtons}");
    const contentBlock = bodySource.slice(bodySource.indexOf('fieldName="Content"'));
    expect(contentBlock).not.toContain("action={renderOpenInEditor(editorPath)}");
    expect(fieldRowSource).toContain("action?: ReactNode");
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

  test("DESIGN.md locks inspect as a viewport-capped dialog with a 15-line code block", () => {
    expect(designSource).toContain("15-line");
    expect(designSource).toContain("code block");
    expect(designSource).toContain("open-in-editor");
    expect(designSource).toContain("viewport-capped");
  });
});
