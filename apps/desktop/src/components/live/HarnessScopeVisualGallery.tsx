import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";
import type { HarnessScope } from "../../lib/harness-scope-ui";
import type { ProfileInventoryItem } from "../../lib/profile-inventory";
import type { ProfileContentsResource } from "../../lib/types";
import { InventoryRow } from "./InventoryRow";

const REGISTERED = [
  "claude-code",
  "cursor",
  "codex",
  "goose",
  "opencode",
] as const;

const NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  goose: "Goose",
  opencode: "OpenCode",
};

export type HarnessScopeGalleryState =
  | "all-rest"
  | "all-hover"
  | "subset"
  | "orphaned"
  | "popover"
  | "chip-row";

function galleryStateFromSearch(): HarnessScopeGalleryState {
  const raw = new URLSearchParams(window.location.search).get("state");
  switch (raw) {
    case "all-hover":
    case "subset":
    case "orphaned":
    case "popover":
    case "chip-row":
      return raw;
    default:
      return "all-rest";
  }
}

function resource(
  name: string,
  scope: ProfileContentsResource["harness_scope"],
  type = "skill",
): ProfileContentsResource {
  return {
    type,
    name,
    id: `res-${name}`,
    source: "gallery",
    ...(scope ? { harness_scope: scope } : {}),
  };
}

function item(
  name: string,
  scope: ProfileContentsResource["harness_scope"],
  options: { type?: string; section?: ProfileInventoryItem["section"] } = {},
): ProfileInventoryItem {
  const type = options.type ?? "skill";
  return {
    section: options.section ?? "active",
    key: `${type}:${name}`,
    type,
    label: name,
    resource: resource(name, scope, type),
    drifted: false,
  } as ProfileInventoryItem;
}

/** Badges for the no-reflow check: enough to wrap at 960 and 1440, with every action kind. */
const CHIP_ROW: ProfileInventoryItem[] = [
  item("remote-docs", ["claude-code"], { type: "mcp_server" }),
  ...["SessionStart: ponytail-activate.js", "PreToolUse: guard-bash.sh", "Stop: say"].map((name) =>
    item(name, undefined, { type: "hook" }),
  ),
  ...Array.from({ length: 14 }, (_, index) => item(`skill-${String(index + 1).padStart(2, "0")}`, undefined)),
  ...Array.from({ length: 10 }, (_, index) =>
    item(`untracked-${String(index + 1).padStart(2, "0")}`, undefined, { section: "not_in_profile" }),
  ),
];

function ChipRow(): ReactNode {
  return (
    <section className="harness-scope-gallery-chip-row" data-testid="chip-row-gallery">
      <div className="inventory-chip-cluster">
        {CHIP_ROW.map((entry) => (
          <InventoryRow
            key={entry.key}
            item={entry}
            editMode={false}
            profileName="work"
            pending={false}
            selectedIsActive
            onOpenResource={() => undefined}
            onAdd={entry.section === "not_in_profile" ? () => undefined : undefined}
            onDiscard={entry.section === "not_in_profile" ? () => undefined : undefined}
            registeredHarnesses={REGISTERED}
            harnessNames={NAMES}
            scopeTarget="global"
            onHarnessScopeChange={noopScope}
            disableHover
          />
        ))}
      </div>
    </section>
  );
}

function noopScope(_scope: HarnessScope): void {
  void _scope;
}

function GalleryRow({
  label,
  inventoryItem,
  hover,
  popoverOpen,
}: {
  label: string;
  inventoryItem: ProfileInventoryItem;
  hover?: boolean;
  popoverOpen?: boolean;
}): ReactNode {
  return (
    <div className="harness-scope-gallery-row">
      <span className="muted">{label}</span>
      <div className={hover ? "is-scope-hover-host" : undefined}>
        <InventoryRow
          item={inventoryItem}
          editMode={false}
          profileName="work"
          pending={false}
          selectedIsActive
          onOpenResource={() => undefined}
          registeredHarnesses={REGISTERED}
          harnessNames={NAMES}
          scopeTarget="global"
          onHarnessScopeChange={noopScope}
          scopePopoverOpen={popoverOpen}
          disableHover
        />
      </div>
    </div>
  );
}

export function HarnessScopeVisualGallery(): ReactNode {
  const state = galleryStateFromSearch();
  const allItem = item("notes", undefined);
  const subsetItem = item("subset-skill", [
    "claude-code",
    "cursor",
    "codex",
    "goose",
  ]);
  const orphanedItem = item("orphaned-skill", ["gone-harness"]);

  return (
    <Tooltip.Provider delayDuration={400}>
      <main
        className={[
          "harness-scope-gallery",
          state === "all-hover" ? "is-scope-hover" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="harness-scope-gallery"
        aria-label="Harness scope visual gallery"
      >
        {state === "all-rest" ? (
          <GalleryRow label="At rest" inventoryItem={allItem} />
        ) : null}
        {state === "all-hover" ? (
          <GalleryRow label="On hover" inventoryItem={allItem} hover />
        ) : null}
        {state === "subset" ? (
          <GalleryRow label="Subset with +N" inventoryItem={subsetItem} />
        ) : null}
        {state === "orphaned" ? (
          <GalleryRow label="Orphaned" inventoryItem={orphanedItem} />
        ) : null}
        {state === "chip-row" ? <ChipRow /> : null}
        {state === "popover" ? (
          <GalleryRow label="Popover" inventoryItem={allItem} popoverOpen />
        ) : null}
      </main>
    </Tooltip.Provider>
  );
}
