import { describe, expect, test } from "bun:test";
import { cn } from "../../apps/desktop/src/lib/utils";

describe("cn", () => {
  test("merges class names and resolves tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", false && "hidden", "font-medium")).toBe(
      "text-sm font-medium",
    );
  });
});
