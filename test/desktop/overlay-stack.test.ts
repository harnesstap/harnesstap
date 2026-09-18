import { describe, expect, it } from "bun:test";
import {
  createOverlayStack,
  nextTabTarget,
} from "../../apps/desktop/src/state/overlay-stack.ts";

function keyEvent(key = "Escape") {
  const event = {
    key,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
  };
  return event;
}

function layer(onClose: () => void, closeDisabled = false) {
  return {
    getRoot: () => null,
    onClose,
    isCloseDisabled: () => closeDisabled,
    trapFocus: true,
  };
}

describe("overlay stack Esc routing", () => {
  it("routes Esc to the top layer only", () => {
    const stack = createOverlayStack();
    const closed: string[] = [];
    stack.push(layer(() => closed.push("settings")));
    stack.push(layer(() => closed.push("confirm")));

    const event = keyEvent();
    expect(stack.dispatchEscape(event)).toBe("closed");
    expect(closed).toEqual(["confirm"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("falls through to the next layer once the top one is removed", () => {
    const stack = createOverlayStack();
    const closed: string[] = [];
    stack.push(layer(() => closed.push("settings")));
    const confirmId = stack.push(layer(() => closed.push("confirm")));
    stack.remove(confirmId);

    stack.dispatchEscape(keyEvent());
    expect(closed).toEqual(["settings"]);
    expect(stack.isEmpty()).toBe(false);
  });

  it("blocks Esc while the top layer is busy instead of closing the layer below", () => {
    const stack = createOverlayStack();
    const closed: string[] = [];
    stack.push(layer(() => closed.push("settings")));
    stack.push(layer(() => closed.push("busy"), true));

    const event = keyEvent();
    expect(stack.dispatchEscape(event)).toBe("blocked");
    expect(closed).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("runs the newest fallback handler only when no layer is open", () => {
    const stack = createOverlayStack();
    const fired: string[] = [];
    stack.pushFallback(() => fired.push("library-back"));
    const unregister = stack.pushFallback(() => fired.push("discover-back"));

    const id = stack.push(layer(() => fired.push("dialog")));
    expect(stack.dispatchEscape(keyEvent())).toBe("closed");
    expect(fired).toEqual(["dialog"]);

    stack.remove(id);
    expect(stack.dispatchEscape(keyEvent())).toBe("fallback");
    expect(fired).toEqual(["dialog", "discover-back"]);

    unregister();
    expect(stack.dispatchEscape(keyEvent())).toBe("fallback");
    expect(fired).toEqual(["dialog", "discover-back", "library-back"]);
  });

  it("reports none when nothing is registered", () => {
    expect(createOverlayStack().dispatchEscape(keyEvent())).toBe("none");
  });
});

describe("overlay stack focus trap order", () => {
  const tabbables = ["close", "name", "save"];

  it("wraps Tab from the last control to the first and Shift+Tab back", () => {
    expect(nextTabTarget(tabbables, "save", false)).toBe("close");
    expect(nextTabTarget(tabbables, "close", true)).toBe("save");
  });

  it("lets the browser move focus while it stays inside the layer", () => {
    expect(nextTabTarget(tabbables, "close", false)).toBeNull();
    expect(nextTabTarget(tabbables, "name", true)).toBeNull();
  });

  it("pulls focus back into the layer when it escaped", () => {
    expect(nextTabTarget(tabbables, null, false)).toBe("close");
    expect(nextTabTarget(tabbables, null, true)).toBe("save");
    expect(nextTabTarget(tabbables, "outside", false)).toBe("close");
  });

  it("has nowhere to go with no tabbable controls", () => {
    expect(nextTabTarget([], null, false)).toBeNull();
  });
});
