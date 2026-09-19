import type { LibraryPluginAttachmentAdd } from "./api/library-plugins";
import type { SourcesHit } from "./sources-search";

export interface SourcesInstallState {
  pulledName?: string;
  addedName?: string;
  pinnedTargetName?: string;
}

export interface SourcesHitActions {
  showAddToLibrary: boolean;
  showPinToPlugin: boolean;
  showOpenInLibrary: boolean;
  openInLibrarySelector: string | null;
}

export const DISCOVER_ACTION_HELPER =
  "Add copies it into your Library. Pin links it into one of your plugins.";

export const PIN_TO_PLUGIN_TOOLTIP = "Link into an authored plugin";

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

export function sourcesHitActions(
  hit: SourcesHit,
  state: SourcesInstallState = {},
): SourcesHitActions {
  switch (hit.kind) {
    case "standalone": {
      const selector = hit.identity.localSelector ?? null;
      return {
        showAddToLibrary: false,
        showPinToPlugin: true,
        showOpenInLibrary: Boolean(selector),
        openInLibrarySelector: selector,
      };
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
    return {
      showAddToLibrary: !inLibrary,
      showPinToPlugin: true,
      showOpenInLibrary: inLibrary,
      openInLibrarySelector: added ?? hit.identity.marketplace.plugin,
    };
  }

  if (hit.identity.cloud) {
    const added = libraryNameFromState(state);
    const inLibrary = hit.presence === "in_library" || Boolean(added);
    const openSelector = added ?? (inLibrary ? hit.identity.cloud.name : null);
    return {
      showAddToLibrary: !inLibrary,
      showPinToPlugin: true,
      showOpenInLibrary: Boolean(openSelector),
      openInLibrarySelector: openSelector,
    };
  }

  const localName = hit.identity.localPluginName ?? null;
  return {
    showAddToLibrary: false,
    showPinToPlugin: true,
    showOpenInLibrary: Boolean(localName),
    openInLibrarySelector: localName,
  };
}
