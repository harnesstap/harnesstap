import { describe, expect, it } from "bun:test";
import {
  shouldCloseDialogOnBackdrop,
  shouldCloseDialogOnKey,
} from "../../apps/desktop/src/lib/dialog-dismiss.ts";

const backdrop = { id: "backdrop" };
const inner = { id: "dialog" };

describe("shouldCloseDialogOnKey", () => {
  it("closes on Escape when enabled", () => {
    expect(shouldCloseDialogOnKey("Escape")).toBe(true);
    expect(shouldCloseDialogOnKey("Escape", true)).toBe(false);
  });

  it("ignores other keys", () => {
    expect(shouldCloseDialogOnKey("Enter")).toBe(false);
  });
});

describe("shouldCloseDialogOnBackdrop", () => {
  it("closes only when the click hits the backdrop itself", () => {
    expect(shouldCloseDialogOnBackdrop(backdrop, backdrop)).toBe(true);
    expect(shouldCloseDialogOnBackdrop(inner, backdrop)).toBe(false);
  });

  it("does not close when dismiss is disabled", () => {
    expect(shouldCloseDialogOnBackdrop(backdrop, backdrop, true)).toBe(false);
  });
});
