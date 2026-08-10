import { describe, expect, it } from "bun:test";
import {
  computeMaxVisibleRows,
  computeMaxVisibleTableRows,
  computeRemoteListFetchLimit,
  renderFoldedHintLine,
  VIEWPORT_CHROME_LINES,
} from "../../src/ui/list-viewport.ts";

describe("computeRemoteListFetchLimit", () => {
  it("scales fetch limit with terminal height", () => {
    const short = computeRemoteListFetchLimit(12, VIEWPORT_CHROME_LINES.pluginListBrowse);
    const tall = computeRemoteListFetchLimit(40, VIEWPORT_CHROME_LINES.pluginListBrowse);
    expect(tall).toBeGreaterThan(short);
  });

  it("requests at least the browse minimum", () => {
    expect(
      computeRemoteListFetchLimit(12, VIEWPORT_CHROME_LINES.pluginListBrowse),
    ).toBeGreaterThanOrEqual(10);
  });

  it("requests more rows when searching", () => {
    const browse = computeRemoteListFetchLimit(
      24,
      VIEWPORT_CHROME_LINES.pluginListBrowse,
    );
    const search = computeRemoteListFetchLimit(
      24,
      VIEWPORT_CHROME_LINES.pluginListBrowse,
      { search: true },
    );
    expect(search).toBeGreaterThanOrEqual(browse);
    expect(search).toBeGreaterThanOrEqual(25);
  });
});

describe("computeMaxVisibleTableRows", () => {
  it("shows fewer rows than flat row budget on the same terminal", () => {
    const flat = computeMaxVisibleRows(24, VIEWPORT_CHROME_LINES.pluginListBrowse);
    const table = computeMaxVisibleTableRows(24, VIEWPORT_CHROME_LINES.pluginListBrowse);
    expect(table).toBeLessThan(flat);
  });

  it("caps a 13-row section on a typical laptop terminal", () => {
    const visible = computeMaxVisibleTableRows(
      36,
      VIEWPORT_CHROME_LINES.pluginListBrowse,
      { sectionOverhead: 6 },
    );
    expect(visible).toBeLessThan(13);
  });
});

describe("renderFoldedHintLine", () => {
  it("returns empty string when no segments", () => {
    expect(renderFoldedHintLine([], 80)).toBe("");
  });

  it("joins segments on one line when they fit", () => {
    const output = renderFoldedHintLine(
      ["↑ 7 above", "↓ 4 more in skill", "plugin_pin (14)", "↓ next type"],
      120,
    );
    expect(output).toBe(
      "  ↑ 7 above · ↓ 4 more in skill · plugin_pin (14) · ↓ next type",
    );
  });

  it("folds at segment boundaries when too narrow", () => {
    const output = renderFoldedHintLine(
      ["↑ 7 above", "↓ 4 more in skill", "plugin_pin (14)", "↓ next type"],
      42,
    );
    expect(output.split("\n").length).toBeGreaterThan(1);
    expect(output).toContain("↑ 7 above");
    expect(output).toContain("↓ next type");
  });

  it("truncates an overlong single segment", () => {
    const long = "plugin_pin_with_a_very_long_section_name (999)";
    const output = renderFoldedHintLine([long], 20);
    expect(output.endsWith("…")).toBe(true);
    expect(output.length).toBeLessThanOrEqual(20);
  });
});

describe("plugin list browse chrome budget", () => {
  it("reserves extra chrome for the unified browse prompt", () => {
    expect(VIEWPORT_CHROME_LINES.pluginListBrowse).toBeGreaterThan(
      VIEWPORT_CHROME_LINES.resourceList,
    );
  });

  it("yields fewer visible rows on short terminals", () => {
    expect(
      computeMaxVisibleTableRows(12, VIEWPORT_CHROME_LINES.pluginListBrowse),
    ).toBeLessThan(
      computeMaxVisibleTableRows(40, VIEWPORT_CHROME_LINES.pluginListBrowse),
    );
  });
});
