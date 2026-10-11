import { describe, expect, it } from "bun:test";
import { publishVersionRequiredMessage } from "../../src/cli/handlers/plugin-publish.ts";

describe("profile vs plugin publish dirty copy (W2-10)", () => {
  it("tells profile publish to cut a version instead of passing --version", () => {
    expect(
      publishVersionRequiredMessage(
        "work",
        "Plugin work@1.0.0 has unpublished edits.",
        "profile",
      ),
    ).toBe(
      "Plugin work@1.0.0 has unpublished edits. Cut a version first, then publish. For example: ht plugin cut work --version 1.1.0",
    );
  });

  it("keeps --version on plugin publish", () => {
    expect(
      publishVersionRequiredMessage(
        "demo",
        "Plugin demo@1.0.0 has unpublished edits.",
        "plugin",
      ),
    ).toContain("ht plugin publish demo --version 1.1.0");
  });
});
