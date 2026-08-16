import { describe, expect, test } from "bun:test";
import {
  draftHasTypedContent,
  escapeAction,
  sidebarChangeAction,
} from "../../apps/desktop/src/lib/library-pane.ts";

describe("library pane navigation", () => {
  test("escape cancels field edit, dismisses confirm, otherwise leaves detail", () => {
    expect(escapeAction({ fieldEditing: true, confirmOpen: false })).toBe("cancel-field");
    expect(escapeAction({ fieldEditing: false, confirmOpen: true })).toBe("dismiss-confirm");
    expect(escapeAction({ fieldEditing: false, confirmOpen: false })).toBe("leave-pane");
  });

  test("sidebar change is blocked while busy or a non-draft confirm is open", () => {
    expect(sidebarChangeAction({ busy: true, confirmOpen: false, draftTyped: false })).toBe("block");
    expect(sidebarChangeAction({ busy: false, confirmOpen: true, draftTyped: false })).toBe("block");
    expect(sidebarChangeAction({ busy: false, confirmOpen: false, draftTyped: false })).toBe("leave-and-apply");
    expect(sidebarChangeAction({ busy: false, confirmOpen: false, draftTyped: true })).toBe("confirm-discard");
  });

  test("empty create draft has no typed content; name or description counts", () => {
    expect(draftHasTypedContent({ name: "", description: "" })).toBe(false);
    expect(draftHasTypedContent({ name: "  ", description: "" })).toBe(false);
    expect(draftHasTypedContent({ name: "eng", description: "" })).toBe(true);
    expect(draftHasTypedContent({ name: "", description: "x" })).toBe(true);
  });
});
