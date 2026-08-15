import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const packagesSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/PluginsWorkspace.tsx",
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
});
