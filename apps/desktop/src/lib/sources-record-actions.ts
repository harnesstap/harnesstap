import type { LibraryPluginAttachmentAdd } from "./api/library-plugins";
import { nameMatchesMarketplacePlugin, type SourcesHit } from "./sources-search";

export interface SourcesInstallState {
  pulledName?: string;
  addedName?: string;
  addedId?: string;
  pinnedTargetName?: string;
}

export interface SourcesHitActions {
  showAddToLibrary: boolean;
  showAddToProfile: boolean;
  showPinToPlugin: boolean;
  showOpenInLibrary: boolean;
  openInLibrarySelector: string | null;
}

export type DiscoverAttachKind = "plugin" | "resource";

export interface DiscoverAttachTarget {
  kind: DiscoverAttachKind;
  id: string;
  name: string;
}

export interface DiscoverLibraryRow {
  id: string;
  name: string;
  type: string;
  namespace?: string | null;
  listKind?: string;
}

export const DISCOVER_ACTION_HELPER =
  "Add copies it into your Library. Pin links it into one of your plugins.";

export const PIN_TO_PLUGIN_TOOLTIP = "Link into an authored plugin";

export const DISCOVER_ADD_TO_PROFILE_LABEL = "Add to profile";
export const DISCOVER_ADD_TO_LIBRARY_LABEL = "Add to Library";
export const DISCOVER_ADD_TO_LIBRARY_TOOLTIP = "Add to library";
export const DISCOVER_IN_LIBRARY_LINK_TOOLTIP = "Add to a profile";

export function discoverAddToProfileLabel(): string {
  return DISCOVER_ADD_TO_PROFILE_LABEL;
}

export function discoverAddToProfileTooltip(
  pluginName: string,
  profileName: string | null,
): string {
  if (!profileName) {
    return "No profile selected";
  }
  return `Add ${pluginName} to current profile ${profileName}`;
}

export function discoverActionHelper(profileName: string | null): string {
  if (!profileName) {
    return DISCOVER_ACTION_HELPER;
  }
  return "Add copies it into your Library. Add to profile attaches it and applies. Pin links it into one of your plugins.";
}

export function cloudAttachSelector(hit: SourcesHit): string | null {
  const identity = hit.identity.cloud;
  if (!identity) {
    return null;
  }
  return `${identity.org}/${identity.catalog}/${identity.name}`;
}

export function marketplacePinSelector(hit: SourcesHit): string | null {
  const identity = hit.identity.marketplace;
  if (!identity) {
    return null;
  }
  return `${identity.plugin}@${identity.marketplace}`;
}

export function sourcesAttachmentAdd(hit: SourcesHit): LibraryPluginAttachmentAdd {
  const marketplaceSelector = marketplacePinSelector(hit);
  if (marketplaceSelector) {
    return { type: "plugin", selector: marketplaceSelector, sync: true };
  }
  const cloudSelector = cloudAttachSelector(hit);
  if (cloudSelector) {
    return { type: "plugin", selector: cloudSelector };
  }
  if (hit.identity.localPluginName) {
    return { type: "plugin", selector: hit.identity.localPluginName };
  }
  if (hit.identity.localSelector) {
    return { type: hit.typeLabel, selector: hit.identity.localSelector };
  }
  throw new Error("Cannot attach this Sources hit");
}

function libraryNameFromState(state: SourcesInstallState): string | null {
  return state.addedName ?? state.pulledName ?? state.pinnedTargetName ?? null;
}

function isPluginPackageRow(row: DiscoverLibraryRow): boolean {
  if (row.listKind === "plugin-package") {
    return true;
  }
  if (row.listKind === "resource") {
    return false;
  }
  return row.type === "plugin";
}

function findPluginPackage(
  rows: DiscoverLibraryRow[],
  matches: (row: DiscoverLibraryRow) => boolean,
): DiscoverAttachTarget | null {
  const row = rows.find((entry) => isPluginPackageRow(entry) && matches(entry));
  if (!row) {
    return null;
  }
  return { kind: "plugin", id: row.id, name: row.name };
}

function resourceSelector(row: DiscoverLibraryRow): string {
  return row.namespace
    ? `${row.type}:${row.name}@${row.namespace}`
    : `${row.type}:${row.name}`;
}

export function discoverAttachTarget(
  hit: SourcesHit,
  state: SourcesInstallState,
  libraryRows: DiscoverLibraryRow[],
): DiscoverAttachTarget | null {
  const addedName = libraryNameFromState(state);
  if (state.addedId && addedName) {
    return { kind: "plugin", id: state.addedId, name: addedName };
  }

  if (hit.identity.marketplace) {
    const marketplace = hit.identity.marketplace;
    return findPluginPackage(libraryRows, (row) =>
      nameMatchesMarketplacePlugin(
        row.name,
        marketplace.plugin,
        marketplace.marketplace,
      ),
    );
  }

  if (hit.identity.cloud) {
    const cloudName = hit.identity.cloud.name;
    return findPluginPackage(
      libraryRows,
      (row) => row.name === cloudName || row.name === addedName,
    );
  }

  if (hit.identity.localPluginName) {
    const localName = hit.identity.localPluginName;
    return findPluginPackage(libraryRows, (row) => row.name === localName);
  }

  if (hit.identity.localSelector) {
    const selector = hit.identity.localSelector;
    const row = libraryRows.find(
      (entry) =>
        entry.listKind !== "plugin-package"
        && resourceSelector(entry) === selector,
    );
    if (!row) {
      return null;
    }
    return { kind: "resource", id: row.id, name: row.name };
  }

  return null;
}

function withAddToProfile(actions: Omit<SourcesHitActions, "showAddToProfile">): SourcesHitActions {
  return { ...actions, showAddToProfile: true };
}

export function sourcesHitActions(
  hit: SourcesHit,
  state: SourcesInstallState = {},
): SourcesHitActions {
  switch (hit.kind) {
    case "standalone": {
      const selector = hit.identity.localSelector ?? null;
      return withAddToProfile({
        showAddToLibrary: false,
        showPinToPlugin: true,
        showOpenInLibrary: Boolean(selector),
        openInLibrarySelector: selector,
      });
    }
    case "plugin":
      break;
    default: {
      const neverKind: never = hit.kind;
      return neverKind;
    }
  }

  if (hit.identity.marketplace) {
    const added = libraryNameFromState(state);
    const inLibrary = hit.presence === "in_library" || Boolean(added);
    return withAddToProfile({
      showAddToLibrary: !inLibrary,
      showPinToPlugin: true,
      showOpenInLibrary: inLibrary,
      openInLibrarySelector: added ?? hit.identity.marketplace.plugin,
    });
  }

  if (hit.identity.cloud) {
    const added = libraryNameFromState(state);
    const inLibrary = hit.presence === "in_library" || Boolean(added);
    const openSelector = added ?? (inLibrary ? hit.identity.cloud.name : null);
    return withAddToProfile({
      showAddToLibrary: !inLibrary,
      showPinToPlugin: true,
      showOpenInLibrary: Boolean(openSelector),
      openInLibrarySelector: openSelector,
    });
  }

  const localName = hit.identity.localPluginName ?? null;
  return withAddToProfile({
    showAddToLibrary: false,
    showPinToPlugin: true,
    showOpenInLibrary: Boolean(localName),
    openInLibrarySelector: localName,
  });
}
