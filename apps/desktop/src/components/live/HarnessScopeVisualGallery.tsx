import { Tooltip } from "radix-ui";
import { useState, type ReactNode } from "react";
import type { ProfileInventoryItem } from "../../lib/profile-inventory";
import type { ProfileContentsResource } from "../../lib/types";
import { InventoryRow } from "./InventoryRow";
import { TypeGroupSuggestion } from "./InventorySection";

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
  | "chip-row"
  | "tooltip"
  | "suggestion";

function galleryStateFromSearch(): HarnessScopeGalleryState {
  const raw = new URLSearchParams(window.location.search).get("state");
  switch (raw) {
    case "all-hover":
    case "subset":
    case "orphaned":
    case "popover":
    case "chip-row":
    case "tooltip":
    case "suggestion":
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
  ...Array.from({ length: 14 }, (_, index) =>
    item(
      `skill-${String(index + 1).padStart(2, "0")}`,
      index % 5 === 1 ? ["cursor", "codex"] : index % 5 === 3 ? ["opencode"] : undefined,
    ),
  ),
  ...Array.from({ length: 10 }, (_, index) =>
    item(`untracked-${String(index + 1).padStart(2, "0")}`, undefined, { section: "not_in_profile" }),
  ),
];

/** MCP section for the suggestion line: three could also run elsewhere. */
const MCP_SECTION: ProfileInventoryItem[] = [
  item("remote-docs", ["claude-code"], { type: "mcp_server" }),
  item("github", ["claude-code", "cursor"], { type: "mcp_server" }),
  item("oc-mcp", ["opencode"], { type: "mcp_server" }),
  item("filesystem", undefined, { type: "mcp_server" }),
];

function Chip({
  entry,
  editMode = false,
  popoverOpen = false,
  hoverCard = false,
}: {
  entry: ProfileInventoryItem;
  editMode?: boolean;
  popoverOpen?: boolean;
  hoverCard?: boolean;
}): ReactNode {
  const [stored, setStored] = useState(entry.resource.harness_scope);
  const live = { ...entry, resource: { ...entry.resource, harness_scope: stored } } as ProfileInventoryItem;
  return (
    <InventoryRow
      item={live}
      editMode={editMode}
      profileName="work"
      pending={false}
      selectedIsActive
      onOpenResource={() => undefined}
      onAdd={entry.section === "not_in_profile" ? () => undefined : undefined}
      onDiscard={entry.section === "not_in_profile" ? () => undefined : undefined}
      registeredHarnesses={REGISTERED}
      harnessNames={NAMES}
      scopeTarget="global"
      onHarnessScopeChange={(scope) => setStored(scope.kind === "all" ? undefined : [...scope.harnesses])}
      scopePopoverOpen={popoverOpen}
      disableHover={!hoverCard}
    />
  );
}

function ChipRow(): ReactNode {
  return (
    <section className="harness-scope-gallery-chip-row" data-testid="chip-row-gallery">
      <div className="inventory-chip-cluster">
        {CHIP_ROW.map((entry) => (
          <Chip key={entry.key} entry={entry} editMode />
        ))}
      </div>
    </section>
  );
}

function SuggestionSection(): ReactNode {
  const [items, setItems] = useState(MCP_SECTION);
  return (
    <section className="inventory-type-group" data-testid="suggestion-gallery">
      <TypeGroupSuggestion
        items={items}
        registered={REGISTERED}
        harnessNames={NAMES}
        onHarnessScopeChange={(target, scope) => {
          setItems((current) =>
            current.map((entry) =>
              entry.key === target.key
                ? ({
                    ...entry,
                    resource: {
                      ...entry.resource,
                      harness_scope: scope.kind === "all" ? undefined : [...scope.harnesses],
                    },
                  } as ProfileInventoryItem)
                : entry,
            ),
          );
        }}
      />
      <div className="inventory-chip-cluster">
        {items.map((entry) => (
          <Chip key={`${entry.key}:${String(entry.resource.harness_scope)}`} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function GalleryRow({
  label,
  inventoryItem,
  editMode,
  popoverOpen,
  hoverCard,
}: {
  label: string;
  inventoryItem: ProfileInventoryItem;
  editMode?: boolean;
  popoverOpen?: boolean;
  hoverCard?: boolean;
}): ReactNode {
  return (
    <div className="harness-scope-gallery-row">
      <span className="muted">{label}</span>
      <div>
        <Chip entry={inventoryItem} editMode={editMode} popoverOpen={popoverOpen} hoverCard={hoverCard} />
      </div>
    </div>
  );
}

export function HarnessScopeVisualGallery(): ReactNode {
  const state = galleryStateFromSearch();
  const allItem = item("notes", undefined);
  const oneItem = item("opencode-only-skill", ["opencode"]);
  const someItem = item("cursor-and-codex-skill", ["cursor", "codex"]);
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
          <GalleryRow label="On hover" inventoryItem={allItem} editMode />
        ) : null}
        {state === "subset" ? (
          <>
            <GalleryRow label="One tool" inventoryItem={oneItem} />
            <GalleryRow label="Some tools" inventoryItem={someItem} />
            <GalleryRow label="Every tool" inventoryItem={allItem} />
          </>
        ) : null}
        {state === "orphaned" ? (
          <GalleryRow label="Orphaned" inventoryItem={orphanedItem} />
        ) : null}
        {state === "chip-row" ? <ChipRow /> : null}
        {state === "popover" ? (
          <GalleryRow label="Popover" inventoryItem={someItem} editMode popoverOpen />
        ) : null}
        {state === "tooltip" ? (
          <GalleryRow label="Tooltip" inventoryItem={someItem} hoverCard />
        ) : null}
        {state === "suggestion" ? <SuggestionSection /> : null}
      </main>
    </Tooltip.Provider>
  );
}
