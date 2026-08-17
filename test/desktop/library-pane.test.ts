import { describe, expect, test } from "bun:test";
import {
  draftHasTypedContent,
  escapeAction,
  isOutsideLibraryDetail,
  shouldCommitDraftName,
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

  test("draft name commit is skipped while leaving or when the name is empty", () => {
    expect(shouldCommitDraftName({ leaving: true, name: "eng" })).toBe(false);
    expect(shouldCommitDraftName({ leaving: false, name: "" })).toBe(false);
    expect(shouldCommitDraftName({ leaving: false, name: "  " })).toBe(false);
    expect(shouldCommitDraftName({ leaving: false, name: "eng" })).toBe(true);
  });

  test("draft name blur to back does not commit; blur to description and enter do", () => {
    const back = {
      getAttribute: (name: string) =>
        name === "aria-label" ? "Back to library list" : null,
      closest: (selector: string) =>
        selector === '[aria-label="Back to library list"]' ? back : null,
    };
    const description = {
      getAttribute: (name: string) =>
        name === "aria-label" ? "Description" : null,
      closest: () => null,
    };
    expect(
      shouldCommitDraftName({
        leaving: false,
        name: "eng",
        relatedTarget: back as EventTarget,
      }),
    ).toBe(false);
    expect(
      shouldCommitDraftName({
        leaving: false,
        name: "eng",
        relatedTarget: description as EventTarget,
      }),
    ).toBe(true);
    expect(shouldCommitDraftName({ leaving: false, name: "eng" })).toBe(true);
  });

  test("draft name blur to Import or Tracked directories does not commit", () => {
    const importBtn = {
      getAttribute: (name: string) =>
        name === "aria-label" ? "Import into library" : null,
      closest: () => null,
    };
    const trackedBtn = {
      getAttribute: (name: string) =>
        name === "aria-label" ? "Tracked directories" : null,
      closest: () => null,
    };
    expect(
      shouldCommitDraftName({
        leaving: false,
        name: "eng",
        relatedTarget: importBtn as EventTarget,
      }),
    ).toBe(false);
    expect(
      shouldCommitDraftName({
        leaving: false,
        name: "eng",
        relatedTarget: trackedBtn as EventTarget,
      }),
    ).toBe(false);
  });

  test("draft name blur while unmounting does not commit", () => {
    expect(
      shouldCommitDraftName({
        leaving: false,
        name: "eng",
        connected: false,
      }),
    ).toBe(false);
  });

  test("pointer outside library-detail is a draft leave; inside is not", () => {
    const outside = {
      closest: (selector: string) =>
        selector === ".library-detail" ? null : null,
    };
    const inside = {
      closest: (selector: string) =>
        selector === ".library-detail" ? inside : null,
    };
    expect(isOutsideLibraryDetail(outside as EventTarget)).toBe(true);
    expect(isOutsideLibraryDetail(inside as EventTarget)).toBe(false);
    expect(isOutsideLibraryDetail(null)).toBe(true);
  });
});
