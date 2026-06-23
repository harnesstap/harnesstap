import { describe, expect, it } from "bun:test";
import {
  matchesListSearchQuery,
  parseListSearchQuery,
} from "../../src/ui/list-search.ts";

describe("parseListSearchQuery", () => {
  it("parses section:text prefix", () => {
    expect(parseListSearchQuery("skill:dbt")).toEqual({
      section: "skill",
      text: "dbt",
      raw: "skill:dbt",
    });
  });

  it("splits on first colon syntactically (semantic validation is in filters)", () => {
    expect(parseListSearchQuery("notatype:foo")).toEqual({
      section: "notatype",
      text: "foo",
      raw: "notatype:foo",
    });
  });

  it("returns empty text for section-only query", () => {
    expect(parseListSearchQuery("skill:")).toEqual({
      section: "skill",
      text: "",
      raw: "skill:",
    });
  });

  it("handles plain text without colon", () => {
    expect(parseListSearchQuery("dbt")).toEqual({
      section: undefined,
      text: "dbt",
      raw: "dbt",
    });
  });

  it("trims outer whitespace", () => {
    expect(parseListSearchQuery("  skill:dbt  ")).toEqual({
      section: "skill",
      text: "dbt",
      raw: "skill:dbt",
    });
  });
});

describe("matchesListSearchQuery", () => {
  it("matches case-insensitively", () => {
    expect(
      matchesListSearchQuery("Migrating-DBT-Core", parseListSearchQuery("dbt")),
    ).toBe(true);
  });

  it("matches all rows when text is empty", () => {
    expect(
      matchesListSearchQuery("anything", parseListSearchQuery("skill:")),
    ).toBe(true);
  });
});
