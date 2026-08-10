import { describe, expect, it } from "bun:test";
import {
  API_VERSION_HEADER,
  CLIENT_API_VERSION,
  CLI_VERSION_HEADER,
  CliTooOldError,
  cloudRequestHeaders,
  throwIfCliTooOld,
} from "../../src/services/cloud-api-version.ts";
import { PACKAGE_VERSION } from "../../src/version.ts";

describe("cloudRequestHeaders", () => {
  it("declares the CLI and API versions", () => {
    const headers = cloudRequestHeaders();
    expect(headers[CLI_VERSION_HEADER]).toBe(PACKAGE_VERSION);
    expect(headers[API_VERSION_HEADER]).toBe(String(CLIENT_API_VERSION));
  });

  it("speaks contract 1", () => {
    expect(CLIENT_API_VERSION).toBe(1);
  });

  it("merges caller headers without dropping them", () => {
    const headers = cloudRequestHeaders({ "content-type": "application/json" });
    expect(headers["content-type"]).toBe("application/json");
    expect(headers[CLI_VERSION_HEADER]).toBe(PACKAGE_VERSION);
  });
});

describe("throwIfCliTooOld", () => {
  it("does nothing for a normal response", async () => {
    await throwIfCliTooOld(new Response("{}", { status: 200 }));
  });

  it("throws an actionable error on 426", async () => {
    const response = new Response(
      JSON.stringify({
        error: "cli_too_old",
        minimumVersion: "0.1.0",
        fix: "npm install -g harnesstap@latest",
      }),
      { status: 426, headers: { "content-type": "application/json" } },
    );
    let caught: unknown;
    try {
      await throwIfCliTooOld(response);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliTooOldError);
    expect((caught as CliTooOldError).message).toContain("0.1.0");
    expect((caught as CliTooOldError).message).toContain("npm install -g harnesstap@latest");
  });

  it("still throws when the 426 body is unparseable", async () => {
    await expect(throwIfCliTooOld(new Response("<html>", { status: 426 }))).rejects.toBeInstanceOf(
      CliTooOldError,
    );
  });

  it("leaves the response body readable for the caller", async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    await throwIfCliTooOld(response);
    expect(await response.json()).toEqual({ ok: true });
  });
});
