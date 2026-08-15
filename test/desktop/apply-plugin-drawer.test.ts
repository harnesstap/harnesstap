import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const drawerSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/ApplyPluginDrawer.tsx",
  ),
  "utf8",
);
const packagesSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/PluginsWorkspace.tsx",
  ),
  "utf8",
);

describe("package apply confirm", () => {
  test("does not include a plugin picker", () => {
    expect(drawerSource).not.toContain("Filter plugins");
    expect(drawerSource).not.toContain("Library plugins");
    expect(drawerSource).not.toContain("selectedIds");
    expect(drawerSource).toContain("pluginName: string");
    expect(drawerSource).toContain("isProfile: boolean");
  });

  test("package detail Apply opens the confirm for that package", () => {
    expect(packagesSource).not.toContain(
      'title="Apply is provided by the apply-plugin slice"',
    );
    expect(packagesSource).toContain("ApplyPluginDrawer");
    expect(packagesSource).toContain("pluginName={detail.plugin.name}");
    expect(packagesSource).toContain('data-testid="apply-package"');
  });
});
