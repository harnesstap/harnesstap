import { describe, expect, it } from "bun:test";
import { hashResourceBody } from "../../src/services/resource-hash.js";

describe("hashResourceBody", () => {
  it("is stable for same text after newline normalization", () => {
    const a = hashResourceBody({ type: "skill", content: "hello\n", metadata: {} });
    const b = hashResourceBody({ type: "skill", content: "hello", metadata: {} });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("differs when content differs", () => {
    const a = hashResourceBody({ type: "skill", content: "a", metadata: {} });
    const b = hashResourceBody({ type: "skill", content: "b", metadata: {} });
    expect(a).not.toBe(b);
  });
});
