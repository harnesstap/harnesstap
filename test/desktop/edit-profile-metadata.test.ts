import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const editSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/EditProfilePane.tsx"),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

function sliceBetween(
  source: string,
  startNeedle: string,
  endNeedle: string,
): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start === -1 ? 0 : start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const editBody = sliceBetween(
  editSource,
  'className="edit-profile-body"',
  "<PluginCompositionFields",
);

describe("edit profile metadata chrome", () => {
  test("shows name and description as the first fields, not behind a Metadata disclosure", () => {
    expect(editBody).toContain('id="edit-profile-name"');
    expect(editBody).toContain('id="edit-profile-description"');
    expect(editBody).not.toContain("<details");
    expect(editBody).not.toContain("<summary>Metadata</summary>");
    const nameIdx = editBody.indexOf('id="edit-profile-name"');
    const descriptionIdx = editBody.indexOf('id="edit-profile-description"');
    expect(descriptionIdx).toBeGreaterThan(nameIdx);
  });

  test("keeps composition below the identity fields", () => {
    const nameIdx = editSource.indexOf('id="edit-profile-name"');
    const compositionIdx = editSource.indexOf("<PluginCompositionFields");
    expect(compositionIdx).toBeGreaterThan(nameIdx);
  });

  test("documents uncollapsed name and description on the edit pane", () => {
    expect(designSource).toContain("Name and description are the first fields");
  });
});
