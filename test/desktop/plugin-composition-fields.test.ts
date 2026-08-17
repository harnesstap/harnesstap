import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const packagesSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/PluginPackageDetail.tsx",
  ),
  "utf8",
);
const editSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/EditProfilePane.tsx"),
  "utf8",
);

describe("plugin composition fields", () => {
  test("package detail and edit profile share one composition surface", () => {
    expect(packagesSource).toContain("PluginCompositionFields");
    expect(editSource).toContain("PluginCompositionFields");
    expect(editSource).toContain('pluginRefTestId="edit-plugin-ref"');
    expect(editSource).toContain('pinTestId="edit-plugin-add"');
  });

  test("package apply tooltip distinguishes apply from sync", () => {
    expect(packagesSource).toContain(
      "Write this plugin’s graph into the selected project",
    );
  });

  test("package detail has no plugin rail and no default-environment Label", () => {
    expect(packagesSource).not.toContain("profiles-rail");
    expect(packagesSource).not.toContain("<Label>Default environment</Label>");
  });

  test("authored tags combobox allows free text", () => {
    expect(packagesSource).toContain("allowCustom");
  });

  test("tag chips do not stay optimistic after a failed PATCH", () => {
    expect(packagesSource).not.toMatch(
      /setDraftTags\(next\);\s*void commitTags\(next\)/,
    );
    expect(packagesSource).toMatch(
      /catch[\s\S]*setDraftTags\(detail\.plugin\.tags\)/,
    );
  });

  test("failed default-environment PATCH is retried when leaving the field", () => {
    const commitCurrent = packagesSource.slice(
      packagesSource.indexOf("async function commitCurrent"),
      packagesSource.indexOf("async function startEdit"),
    );
    expect(commitCurrent).toContain("fieldError");
    expect(commitCurrent).toContain("commitEnvironment");
  });
});
