import { describe, expect, it } from "bun:test";
import {
  destinationForNumberKey,
  initialNavigationState,
  type NavigationAction,
  type NavigationState,
  navigationReducer,
} from "../../apps/desktop/src/state/navigation.ts";

function run(actions: NavigationAction[], start: NavigationState = initialNavigationState) {
  return actions.reduce(navigationReducer, start);
}

describe("navigation history", () => {
  it("records destinations only; scope changes never push history", () => {
    const state = run([
      { type: "set-scope", scope: "project" },
      { type: "set-scope", scope: "global" },
      { type: "set-scope", scope: "project" },
    ]);
    expect(state.history).toEqual([]);
    expect(state.scope).toBe("project");
    expect(state.destination).toBe("scope");
  });

  it("back returns to the previous destination and keeps the current scope", () => {
    const state = run([
      { type: "set-scope", scope: "project" },
      { type: "go", destination: "library" },
      { type: "set-scope", scope: "global" },
      { type: "back" },
    ]);
    expect(state.destination).toBe("scope");
    expect(state.scope).toBe("global");
    expect(state.history).toEqual([]);
  });

  it("pushes one entry per destination change and pops in order", () => {
    const afterGo = run([
      { type: "go", destination: "library" },
      { type: "go", destination: "discover" },
      { type: "go", destination: "discover" },
    ]);
    expect(afterGo.history).toEqual(["scope", "library"]);

    const afterBack = navigationReducer(afterGo, { type: "back" });
    expect(afterBack.destination).toBe("library");
    expect(afterBack.history).toEqual(["scope"]);
    expect(navigationReducer(afterBack, { type: "back" }).destination).toBe("scope");
  });

  it("back on an empty history is a no-op", () => {
    expect(navigationReducer(initialNavigationState, { type: "back" })).toBe(
      initialNavigationState,
    );
  });

  it("clears nested depth when the destination changes and bumps resetNonce on re-click", () => {
    const nested = run([
      { type: "go", destination: "library" },
      { type: "set-nested-depth", depth: 2 },
    ]);
    expect(nested.nestedDepth).toBe(2);
    expect(run([{ type: "go", destination: "environments" }], nested).nestedDepth).toBe(0);
    expect(run([{ type: "back" }], nested).nestedDepth).toBe(0);
    expect(run([{ type: "reset-current" }], nested).resetNonce).toBe(1);
  });

  it("maps ⌘/Ctrl+1..3 keys to destinations", () => {
    expect(destinationForNumberKey("1")).toBe("library");
    expect(destinationForNumberKey("2")).toBe("discover");
    expect(destinationForNumberKey("3")).toBe("environments");
    expect(destinationForNumberKey("4")).toBe(null);
  });
});
