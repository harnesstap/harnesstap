import type { LibraryPluginAttachmentAdd } from "./api/library-plugins";
import type { SourcesHit } from "./sources-search";

export interface SourcesInstallState {
  pulledName?: string;
  pinnedTargetName?: string;
}

export interface SourcesHitActions {
  showPull: boolean;
  showPinToPlugin: boolean;
  showAttachToPlugin: boolean;
  showOpenInLibrary: boolean;
  openInLibrarySelector: string | null;
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

export function sourcesHitActions(
  hit: SourcesHit,
  state: SourcesInstallState = {},
): SourcesHitActions {
  switch (hit.kind) {
    case "standalone": {
      const selector = hit.identity.localSelector ?? null;
      return {
        showPull: false,
        showPinToPlugin: false,
        showAttachToPlugin: true,
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
    const target = state.pinnedTargetName;
    return {
      showPull: false,
      showPinToPlugin: true,
      showAttachToPlugin: false,
      showOpenInLibrary: Boolean(target),
      openInLibrarySelector: target ?? null,
    };
  }

  if (hit.identity.cloud) {
    const pulledName = state.pulledName;
    const inLibrary = hit.presence === "in_library";
    const openSelector = pulledName ?? (inLibrary ? hit.identity.cloud.name : null);
    return {
      showPull: !inLibrary && !pulledName,
      showPinToPlugin: true,
      showAttachToPlugin: false,
      showOpenInLibrary: Boolean(openSelector),
      openInLibrarySelector: openSelector,
    };
  }

  const localName = hit.identity.localPluginName ?? null;
  return {
    showPull: false,
    showPinToPlugin: true,
    showAttachToPlugin: false,
    showOpenInLibrary: Boolean(localName),
    openInLibrarySelector: localName,
  };
}
