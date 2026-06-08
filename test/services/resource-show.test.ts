import { describe, expect, it } from "bun:test";
import {
  renderResourceShow,
  truncateResourceContent,
} from "../../src/services/resource-show.ts";
import { makeResourceInput } from "../helpers/resources.ts";

function makeResource(overrides: Partial<ReturnType<typeof makeResourceInput>> = {}) {
  const input = makeResourceInput({
    type: "skill",
    name: "example",
    description: "Example resource",
    content: "line 1\nline 2",
    ...overrides,
  });
  return {
    ...input,
    id: "01JEXAMPLE0000000000000000",
    namespace: "",
    origin_kind: "manual" as const,
    origin_ref: "",
    content_hash: "abc123",
    content_blob_ref: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };
}

describe("resource show", () => {
  it("hides extended metadata fields by default", () => {
    const output = renderResourceShow(makeResource());

    expect(output).toContain("Updated");
    expect(output).not.toContain("Content hash");
    expect(output).not.toContain("Metadata");
    expect(output).not.toMatch(/\bID\b/);
    expect(output).not.toContain("Created");
    expect(output).not.toContain("01JEXAMPLE0000000000000000");
    expect(output).not.toContain("abc123");
  });

  it("shows extended metadata fields with showAllFields", () => {
    const output = renderResourceShow(makeResource(), { showAllFields: true });

    expect(output).toContain("Content hash");
    expect(output).toContain("abc123");
    expect(output).toContain("01JEXAMPLE0000000000000000");
    expect(output).toContain("Created");
    expect(output).toContain("Metadata");
  });

  it("truncates content after 15 lines with a total line count", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const truncated = truncateResourceContent(lines.join("\n"));

    expect(truncated.split("\n")).toHaveLength(16);
    expect(truncated).toContain("line 15");
    expect(truncated).not.toContain("line 16");
    expect(truncated).toContain("… (20 lines in content)");
  });

  it("keeps short content unchanged", () => {
    const content = "line 1\nline 2\nline 3";
    expect(truncateResourceContent(content)).toBe(content);
  });
});
