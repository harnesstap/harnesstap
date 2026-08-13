import { describe, expect, it } from "bun:test";
import { tryParityRoutes } from "../../src/agent/parity-routes.ts";

describe("tryParityRoutes", () => {
  it("returns null for unrelated paths so existing routes still win", async () => {
    const request = new Request("http://127.0.0.1/v1/health");
    const result = await tryParityRoutes(request, "token", {
      isAgentSwitchInProgress: () => false,
    });
    expect(result).toBeNull();
  });
});
