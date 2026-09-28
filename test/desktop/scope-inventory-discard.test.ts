import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readLiveInventorySource } from "../helpers/desktop-shell-source";

const inventorySectionSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/live/InventorySection.tsx"),
  "utf8",
);
const inventoryRowSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/live/InventoryRow.tsx"),
  "utf8",
);
const shellSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/live/ScopeInventoryShell.tsx"),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

describe("scope inventory discard controls", () => {
  it("renders Discard all beside Add all on Not in profile", () => {
    expect(inventorySectionSource).toContain('label="Add all"');
    expect(inventorySectionSource).toContain('label="Discard all"');
    expect(inventorySectionSource).toContain("profile-remove-action");
    expect(inventorySectionSource).toContain("disabled={rows.length === 0}");
    expect(designSource).toContain("Discard all");
  });

  it("renders per-row Discard beside Add with confirm", () => {
    expect(inventoryRowSource).toContain('label="Discard"');
    expect(inventoryRowSource).toContain("inventory-row-not-in-profile-actions");
    expect(shellSource).toContain("Discard live resource?");
    expect(shellSource).toContain("Discard all live resources?");
    expect(shellSource).toContain("onDiscardResource");
  });

  it("wires discard handlers from scope workspace", () => {
    const workspaceSource = readFileSync(
      join(import.meta.dir, "../../apps/desktop/src/components/shell/ScopeWorkspace.tsx"),
      "utf8",
    );
    expect(workspaceSource).toContain("handleDiscardResource");
    const liveStateSource = readLiveInventorySource();
    expect(liveStateSource).toContain("onDiscardResource");
  });
});
