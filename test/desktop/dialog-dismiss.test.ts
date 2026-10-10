import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  shouldCloseDialogOnBackdrop,
  shouldCloseDialogOnKey,
} from "../../apps/desktop/src/lib/dialog-dismiss.ts";

const dismissSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/lib/dialog-dismiss.ts"),
  "utf8",
);

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

describe("dialog initial focus", () => {
  it("does not force initial focus onto Close", () => {
    expect(dismissSource).not.toContain("initialFocusRef: closeRef");
  });
});
