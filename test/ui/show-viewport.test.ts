import { describe, expect, it } from "bun:test";
import {
  computeShowViewportBounds,
  moveShowScrollOffset,
  renderScrollableShowContent,
} from "../../src/ui/show-viewport.ts";

describe("show viewport", () => {
  it("computes scroll bounds for tall content", () => {
    const bounds = computeShowViewportBounds(40, 0, 12);
    expect(bounds.maxScroll).toBeGreaterThan(0);
    expect(bounds.end - bounds.start).toBeLessThanOrEqual(9);
  });

  it("clamps scroll offset within bounds", () => {
    expect(moveShowScrollOffset(0, -1, 5)).toBe(0);
    expect(moveShowScrollOffset(5, 1, 5)).toBe(5);
    expect(moveShowScrollOffset(2, 1, 5)).toBe(3);
  });

  it("renders a visible slice with overflow hints", () => {
    const content = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join("\n");
    const output = renderScrollableShowContent(content, 3, 10, 80);
    expect(output).toContain("line-4");
    expect(output).toMatch(/↑ 3 above/);
    expect(output).toMatch(/↓ \d+ below/);
  });
});
