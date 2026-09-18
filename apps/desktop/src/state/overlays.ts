import { useCallback, useMemo, useReducer } from "react";
import type { ProfileCreateSource } from "../lib/types";

/** Shell-level overlays that are mutually exclusive: opening one closes the rest. */
export type OverlayName =
  | "createProfile"
  | "stashBrowse"
  | "settings"
  | "cloudAccount"
  | "migrateExport"
  | "migrateImport";

export interface CreateProfileOptions {
  source: ProfileCreateSource;
  switchAfterCreate: boolean;
}

export interface OverlaysState {
  open: OverlayName | null;
  createProfile: CreateProfileOptions;
}

export type OverlaysAction =
  | { type: "open"; name: Exclude<OverlayName, "createProfile"> }
  | { type: "open-create-profile"; options: CreateProfileOptions }
  | { type: "close"; name?: OverlayName };

const DEFAULT_CREATE_PROFILE: CreateProfileOptions = {
  source: "compose",
  switchAfterCreate: false,
};

export const initialOverlaysState: OverlaysState = {
  open: null,
  createProfile: DEFAULT_CREATE_PROFILE,
};

export function overlaysReducer(
  state: OverlaysState,
  action: OverlaysAction,
): OverlaysState {
  switch (action.type) {
    case "open":
      return { ...state, open: action.name };
    case "open-create-profile":
      return { open: "createProfile", createProfile: action.options };
    case "close":
      if (action.name !== undefined && action.name !== state.open) {
        return state;
      }
      return {
        open: null,
        createProfile:
          state.open === "createProfile" ? DEFAULT_CREATE_PROFILE : state.createProfile,
      };
    default: {
      const neverAction: never = action;
      return neverAction;
    }
  }
}

export interface Overlays {
  open: OverlayName | null;
  createProfile: CreateProfileOptions;
  isOpen: (name: OverlayName) => boolean;
  openOverlay: (name: Exclude<OverlayName, "createProfile">) => void;
  openCreateProfile: (
    source?: ProfileCreateSource,
    switchAfterCreate?: boolean,
  ) => void;
  /** Close the named overlay if it is the open one; with no name close whatever is open. */
  closeOverlay: (name?: OverlayName) => void;
}

export function useOverlays(): Overlays {
  const [state, dispatch] = useReducer(overlaysReducer, initialOverlaysState);
  const openOverlay = useCallback(
    (name: Exclude<OverlayName, "createProfile">) => dispatch({ type: "open", name }),
    [],
  );
  const openCreateProfile = useCallback(
    (source: ProfileCreateSource = "compose", switchAfterCreate = false) =>
      dispatch({
        type: "open-create-profile",
        options: { source, switchAfterCreate },
      }),
    [],
  );
  const closeOverlay = useCallback(
    (name?: OverlayName) => dispatch({ type: "close", name }),
    [],
  );
  return useMemo(
    () => ({
      open: state.open,
      createProfile: state.createProfile,
      isOpen: (name: OverlayName) => state.open === name,
      openOverlay,
      openCreateProfile,
      closeOverlay,
    }),
    [closeOverlay, openCreateProfile, openOverlay, state],
  );
}
