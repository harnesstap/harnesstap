import { describe, expect, it } from "bun:test";
import {
  buildEnvironmentEditViewportHintSegments,
  renderGroupedEnvironmentEditViewport,
} from "../../src/ui/environment-edit-render.ts";
import { resolveSectionViewport } from "../../src/ui/list-viewport.ts";

describe("environment edit render", () => {
  it("renders viewport with folded overflow hints", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      kind: "env_var" as const,
      key: `KEY_${index + 1}`,
      value: `value-${index + 1}`,
    }));

    const output = renderGroupedEnvironmentEditViewport(rows, {
      activeIndex: 10,
      navigable: rows,
      terminalRows: 12,
      maxWidth: 80,
    });

    expect(output).toContain("KEY_11");
    expect(output).toMatch(/↑ \d+ above/);
  });

  it("builds folded hint segments for section overflow", () => {
    const ctx = {
      kind: "env_var" as const,
      indexInSection: 5,
      sectionRows: Array.from({ length: 10 }, (_, index) => ({
        kind: "env_var" as const,
        key: `KEY_${index + 1}`,
        value: "value",
      })),
      nextSection: { kind: "secret_ref" as const, count: 2 },
    };
    const viewport = resolveSectionViewport(10, 5, 4);
    const segments = buildEnvironmentEditViewportHintSegments(ctx, viewport);

    expect(segments).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/↑ \d+ above/),
        expect.stringMatching(/↓ \d+ more in ENV VARS/),
        "SECRET REFS (2)",
        "↓ next section",
      ]),
    );
  });
});
