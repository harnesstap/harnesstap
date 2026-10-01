import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readLiveInventorySource } from "../helpers/desktop-shell-source";
import {
  collectDiscardPathRows,
  discardAllDescription,
  discardAllTitle,
  discardPathForResource,
  discardResourceDescription,
  discardResourceTitle,
  DISCARD_PATHS_PAGE_SIZE,
  formatDiscardFileCount,
  formatDiscardResourceSubject,
  sliceDiscardPaths,
} from "../../apps/desktop/src/lib/scope-inventory-discard.ts";

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
const pathListSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/live/DiscardPathList.tsx"),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

function notInProfileActionBlock(): string {
  const start = inventoryRowSource.indexOf("inventory-row-not-in-profile-actions");
  const end = inventoryRowSource.indexOf("} else if (showActivate");
  return inventoryRowSource.slice(start, end);
}

function headerToolbarBlock(): string {
  const start = inventorySectionSource.indexOf("contents-header-toolbar");
  const end = inventorySectionSource.indexOf("canActivateAll && onActivateAll");
  return inventorySectionSource.slice(start, end);
}

describe("scope inventory discard controls", () => {
  it("renders Add all then Discard all on Not in profile", () => {
    const toolbar = headerToolbarBlock();
    expect(toolbar.indexOf('label="Add all"')).toBeGreaterThan(-1);
    expect(toolbar.indexOf('label="Add all"')).toBeLessThan(
      toolbar.indexOf('label="Discard all"'),
    );
    expect(inventorySectionSource).toContain("profile-remove-action");
    expect(inventorySectionSource).toContain("disabled={rows.length === 0}");
    expect(toolbar.indexOf("inventory-batch-progress")).toBeGreaterThan(-1);
    expect(toolbar.indexOf("inventory-batch-progress")).toBeLessThan(
      toolbar.indexOf('label="Add all"'),
    );
    expect(designSource).toContain("section **Add all**");
    expect(designSource).toContain("then **Discard all**");
  });

  it("renders per-row Add then Discard with confirm", () => {
    const actions = notInProfileActionBlock();
    expect(actions.indexOf('label="Add"')).toBeGreaterThan(-1);
    expect(actions.indexOf('label="Add"')).toBeLessThan(
      actions.indexOf('label="Discard"'),
    );
    expect(inventoryRowSource).toContain("inventory-row-not-in-profile-actions");
    expect(shellSource).toContain("discardResourceTitle");
    expect(shellSource).toContain("discardAllTitle");
    expect(shellSource).toContain("DiscardPathList");
    expect(shellSource).toContain("onDiscardResource");
    expect(designSource).toContain("Row **Add** (`Plus`) then **Discard**");
    expect(designSource).not.toContain(
      "Row **Discard** (`X`, `profile-remove-action`) then **Add**",
    );
  });

  it("wires discard handlers from scope workspace", () => {
    const workspaceSource = readFileSync(
      join(import.meta.dir, "../../apps/desktop/src/components/shell/ScopeWorkspace.tsx"),
      "utf8",
    );
    expect(workspaceSource).toContain("handleDiscardResource");
    expect(workspaceSource).toContain("handleDiscardAllResources");
    const liveStateSource = readLiveInventorySource();
    expect(liveStateSource).toContain("onDiscardResource");
    expect(liveStateSource).toContain("onDiscardAllResources");
  });

  it("Discard all uses one bulk sidecar call instead of N per-row discards", () => {
    const runStart = shellSource.indexOf("const runDiscardAll");
    const runEnd = shellSource.indexOf("const runAddAll");
    const runDiscardAll = shellSource.slice(runStart, runEnd);
    expect(runDiscardAll).toContain("onDiscardAllResources");
    expect(runDiscardAll).not.toContain("settleInChunks");
    expect(runDiscardAll).not.toContain("onDiscardResource(row.resource)");

    const controllerSource = readFileSync(
      join(import.meta.dir, "../../apps/desktop/src/state/scope-controller.ts"),
      "utf8",
    );
    const bulkStart = controllerSource.indexOf("const handleDiscardAllResources");
    const bulkEnd = controllerSource.indexOf("const handleAddResource");
    const bulkHandler = controllerSource.slice(bulkStart, bulkEnd);
    expect(bulkHandler).toContain("discardAllProfileResources");
    expect(bulkHandler).not.toContain("discardProfileResource");
    expect(bulkHandler).toContain("loadPreviewFor");
    expect(bulkHandler.indexOf("refreshStatus(\"full\")")).toBe(
      bulkHandler.lastIndexOf("refreshStatus(\"full\")"),
    );

    expect(inventorySectionSource).toContain("addingAllDisabled");
  });
});

describe("scope inventory discard confirm copy", () => {
  it("names the resource type and resource in the title", () => {
    expect(formatDiscardResourceSubject({ type: "skill", label: "agent-creator" })).toBe(
      "skill agent-creator",
    );
    expect(discardResourceTitle({ type: "skill", label: "agent-creator" })).toBe(
      "Discard skill agent-creator?",
    );
    expect(discardResourceTitle({ type: "mcp_server", label: "slack" })).toBe(
      "Discard MCP slack?",
    );
    expect(discardResourceDescription()).toBe("This deletes the live copy on disk.");
  });

  it("uses a count title for Discard all", () => {
    expect(discardAllTitle(1)).toBe("Discard 1 resource?");
    expect(discardAllTitle(358)).toBe("Discard 358 resources?");
    expect(discardAllDescription(1)).toBe("This deletes the live copy on disk.");
    expect(discardAllDescription(358)).toBe("This deletes their live copies on disk.");
    expect(formatDiscardFileCount(1)).toBe("Deletes 1 file.");
    expect(formatDiscardFileCount(358)).toBe("Deletes 358 files.");
  });

  it("lists skill package directories and truncates long path lists", () => {
    expect(
      discardPathForResource({
        source: "~/.claude/skills/agent-creator/SKILL.md",
      }),
    ).toBe("~/.claude/skills/agent-creator");
    expect(discardPathForResource({ source: "manual" })).toBeNull();
    expect(discardPathForResource({ source: "" })).toBeNull();

    const rows = collectDiscardPathRows([
      {
        key: "skill:agent-creator",
        type: "skill",
        label: "agent-creator",
        resource: { source: "~/.claude/skills/agent-creator/SKILL.md" },
      },
      {
        key: "skill:analyst",
        type: "skill",
        label: "analyst",
        resource: { source: "~/.claude/skills/analyst/SKILL.md" },
      },
      {
        key: "skill:dup",
        type: "skill",
        label: "dup",
        resource: { source: "~/.claude/skills/agent-creator/SKILL.md" },
      },
    ]);
    expect(rows).toEqual([
      {
        key: "skill:agent-creator",
        label: "skill agent-creator",
        path: "~/.claude/skills/agent-creator",
      },
      {
        key: "skill:analyst",
        label: "skill analyst",
        path: "~/.claude/skills/analyst",
      },
    ]);

    const many = Array.from({ length: 25 }, (_, index) => ({
      key: `skill:row-${index}`,
      type: "skill",
      label: `row-${index}`,
      resource: { source: `~/.claude/skills/row-${index}/SKILL.md` },
    }));
    const collected = collectDiscardPathRows(many);
    expect(DISCARD_PATHS_PAGE_SIZE).toBe(20);
    expect(sliceDiscardPaths(collected, DISCARD_PATHS_PAGE_SIZE)).toHaveLength(20);
    expect(sliceDiscardPaths(collected, collected.length)).toHaveLength(25);
    expect(pathListSource).toContain("Show more");
    expect(pathListSource).toContain("Show all");
    expect(pathListSource).toContain("confirm-discard-path");
    expect(designSource).toContain("Discard skill agent-creator?");
    expect(designSource).toContain("Discard 358 resources?");
    expect(designSource).toContain("text **Show more** and **Show all**");
  });
});
