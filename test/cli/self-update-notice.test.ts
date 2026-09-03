import { afterEach, describe, expect, it, mock } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI published-version notice", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("still succeeds when the published-version lookup fails", async () => {
    const context = await createTestContext("cli-update-lookup-fail");
    globalThis.fetch = mock(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;

    try {
      const result = await runCli(["help"], {
        env: {
          HARNESSTAP_UPDATE_CHECK: "1",
          HARNESSTAP_UPDATE_CHANNEL: "github",
        },
      });
      expect(result.exitCode).toBeUndefined();
      expect(result.stderr).not.toContain("A newer HarnessTap CLI is available");
    } finally {
      await context.cleanup();
    }
  });

  it("prints current versus newer version after a successful command", async () => {
    const context = await createTestContext("cli-update-notice");
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            tag_name: "v9.9.9",
            body: "test notes",
            html_url: "https://github.com/harnesstap/harnesstap/releases/tag/v9.9.9",
            assets: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;

    try {
      const result = await runCli(["help"], {
        env: {
          HARNESSTAP_UPDATE_CHECK: "1",
          HARNESSTAP_UPDATE_CHANNEL: "github",
        },
      });
      expect(result.exitCode).toBeUndefined();
      expect(result.stderr).toContain("A newer HarnessTap CLI is available: 1.0.2 → 9.9.9");
    } finally {
      await context.cleanup();
    }
  });
});
