import { useCallback, useMemo, useReducer } from "react";
import type { Scope } from "../lib/api/scope";
import type { Destination } from "../lib/header-destination";
import {
  canPopScreenHistory,
  popScreenHistory,
  pushScreenHistory,
} from "../lib/screen-history";

export type { Destination } from "../lib/header-destination";
export type { Scope } from "../lib/api/scope";

/** ⌘/Ctrl+1..3. Other keys return null. */
export function destinationForNumberKey(key: string): Destination | null {
  switch (key) {
    case "1":
      return "library";
    case "2":
      return "discover";
    case "3":
      return "environments";
    default:
      return null;
  }
}

export interface NavigationState {
  destination: Destination;
  scope: Scope;
  /** Destinations only. Scope changes never push history. */
  history: Destination[];
  /** Depth of nested panes inside the current destination (reported by the workspace). */
  nestedDepth: number;
  /** Bumped when the active destination is re-clicked; workspaces reset to their root. */
  resetNonce: number;
}

export type NavigationAction =
  | { type: "go"; destination: Destination }
  | { type: "back" }
  | { type: "set-scope"; scope: Scope }
  | { type: "set-nested-depth"; depth: number }
  | { type: "reset-current" };

export const initialNavigationState: NavigationState = {
  destination: "scope",
  scope: "global",
  history: [],
  nestedDepth: 0,
  resetNonce: 0,
};

export function navigationReducer(
  state: NavigationState,
  action: NavigationAction,
): NavigationState {
  switch (action.type) {
    case "go": {
      if (action.destination === state.destination) {
        return state;
      }
      return {
        ...state,
        history: pushScreenHistory(state.history, state.destination, action.destination),
        destination: action.destination,
        nestedDepth: 0,
      };
    }
    case "back": {
      const { stack, previous } = popScreenHistory(state.history);
      if (!previous) {
        return state;
      }
      return { ...state, history: stack, destination: previous, nestedDepth: 0 };
    }
    case "set-scope":
      if (action.scope === state.scope) {
        return state;
      }
      return { ...state, scope: action.scope };
    case "set-nested-depth":
      if (action.depth === state.nestedDepth) {
        return state;
      }
      return { ...state, nestedDepth: action.depth };
    case "reset-current":
      return { ...state, resetNonce: state.resetNonce + 1 };
    default: {
      const neverAction: never = action;
      return neverAction;
    }
  }
}

export interface Navigation {
  destination: Destination;
  scope: Scope;
  nestedDepth: number;
  canGoBack: boolean;
  /** True when a previous destination exists (ignores nested panes). */
  hasHistory: boolean;
  resetNonce: number;
  back: () => void;
  go: (destination: Destination) => void;
  setScope: (scope: Scope) => void;
  setNestedDepth: (depth: number) => void;
  resetCurrent: () => void;
}

export function useNavigation(
  initial: NavigationState = initialNavigationState,
): Navigation {
  const [state, dispatch] = useReducer(navigationReducer, initial);
  const back = useCallback(() => dispatch({ type: "back" }), []);
  const go = useCallback(
    (destination: Destination) => dispatch({ type: "go", destination }),
    [],
  );
  const setScope = useCallback(
    (scope: Scope) => dispatch({ type: "set-scope", scope }),
    [],
  );
  const setNestedDepth = useCallback(
    (depth: number) => dispatch({ type: "set-nested-depth", depth }),
    [],
  );
  const resetCurrent = useCallback(() => dispatch({ type: "reset-current" }), []);
  const hasHistory = canPopScreenHistory(state.history);
  return useMemo(
    () => ({
      destination: state.destination,
      scope: state.scope,
      nestedDepth: state.nestedDepth,
      canGoBack: state.nestedDepth > 0 || hasHistory,
      hasHistory,
      resetNonce: state.resetNonce,
      back,
      go,
      setScope,
      setNestedDepth,
      resetCurrent,
    }),
    [back, go, hasHistory, resetCurrent, setNestedDepth, setScope, state],
  );
}
