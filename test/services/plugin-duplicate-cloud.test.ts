import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { CloudApiError } from "../../src/services/cloud-api-error.ts";
import { type CloudClient, type CloudDuplicateRequest, createCloudClient } from "../../src/services/cloud-client.ts";
import { cloudSlugFromName, duplicateInCloud } from "../../src/services/plugin-duplicate-cloud.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("plugin-duplicate-cloud-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function fakeClient(answer: (input: CloudDuplicateRequest) => unknown): { client: CloudClient; calls: CloudDuplicateRequest[] } {
  const calls: CloudDuplicateRequest[] = [];
  const client = {
    async duplicateCatalogPlugin(input: CloudDuplicateRequest) {
      calls.push(input);
      return answer(input);
    },
  } as unknown as CloudClient;
  return { client, calls };
}

describe("profile duplicate --to (harnesstap-cloud#143)", () => {
  it("asks Cloud with the contract body and returns its selector", async () => {
    const { client, calls } = fakeClient(() => ({
      selector: "my-org/default/planner-copy",
      version: "1.0.0",
      mode: "extends",
      publishedVersion: { version: "1.0.0", upstream: { kind: "extends", ref: "acme/team/planner@^1.0.0", version_at_link: "1.0.0" }, exclude: [] },
    }));
    const outcome = await duplicateInCloud(
      "acme/team/planner",
      { name: "planner-copy", mode: "inherit", to: "my-org/default" },
      { createClient: async () => client },
    );
    expect(calls).toEqual([
      { source: { org: "acme", catalog: "team", slug: "planner" }, mode: "extends", name: "planner-copy", targetOrg: "my-org", targetCatalog: "default" },
    ]);
    expect(outcome.kind === "cloud" && outcome.response.selector).toBe("my-org/default/planner-copy");
  });

  it("sends mode copy and uses a pulled profile's catalog address", async () => {
    createPlugin({ name: "Planner", version: "1.2.0", org_slug: "acme", catalog_slug: "team", origin_locator: "acme/team/planner@1.2.0" });
    const { client, calls } = fakeClient(() => ({ selector: "my-org/default/planner-copy", version: "1.0.0", mode: "copy" }));
    await duplicateInCloud("Planner", { mode: "copy", to: "my-org" }, { createClient: async () => client });
    expect(calls[0]).toMatchObject({ source: { org: "acme", catalog: "team", slug: "planner" }, mode: "copy", name: "planner-copy", targetCatalog: "default" });
  });

  it("falls back to the Library duplicate when Cloud has no endpoint", async () => {
    createPlugin({ name: "planner", version: "1.0.0", org_slug: "acme", catalog_slug: "team" });
    const { client } = fakeClient(() => null);
    const outcome = await duplicateInCloud(
      "planner",
      { name: "planner-qa", mode: "inherit", to: "my-org/default" },
      { createClient: async () => client },
    );
    expect(outcome.kind).toBe("local");
    expect(getPluginByName("planner-qa")?.upstream).toMatchObject({ kind: "extends", ref: "acme/team/planner@^1.0.0" });
  });

  it("names the pull command when there is no endpoint and nothing local", async () => {
    const { client } = fakeClient(() => null);
    await expect(
      duplicateInCloud("acme/team/planner", { mode: "inherit", to: "my-org/default" }, { createClient: async () => client }),
    ).rejects.toThrow("Run `ht profile pull acme/team/planner`, then duplicate without --to.");
  });

  it("shows Cloud's ref and request id for an unpublished source", async () => {
    const { client } = fakeClient(() => {
      throw new CloudApiError("duplicate failed", 400, {
        error: { code: "upstream_unpublished", ref: "acme/team/planner@^1", message: "Not published.", requestId: "req_7" },
      });
    });
    await expect(
      duplicateInCloud("acme/team/planner", { mode: "inherit", to: "my-org/default" }, { createClient: async () => client }),
    ).rejects.toThrow("acme/team/planner@^1 is not published, so it cannot be duplicated. (request req_7)");
  });

  it("refuses a Library-only source before any network call", async () => {
    createPlugin({ name: "mine", version: "1.0.0" });
    const { client, calls } = fakeClient(() => null);
    await expect(
      duplicateInCloud("mine", { mode: "inherit", to: "my-org/default" }, { createClient: async () => client }),
    ).rejects.toThrow("mine is not in a catalog, so Cloud cannot duplicate it. Drop --to to duplicate it in your Library.");
    expect(calls).toHaveLength(0);
  });

  it("mirrors Cloud's slug rule before any network call", async () => {
    expect(cloudSlugFromName("  Planner Copy!! ")).toBe("planner-copy");
    expect(cloudSlugFromName("a--b__c")).toBe("a-b-c");
    expect(cloudSlugFromName("v1.2 build")).toBe("v1-2-build");
    expect(cloudSlugFromName("x".repeat(64))).toBe("x".repeat(64));
    expect(cloudSlugFromName(`${"x".repeat(63)} y`)).toBeUndefined();
    expect(cloudSlugFromName("!!!")).toBeUndefined();
    const { client, calls } = fakeClient(() => null);
    await expect(
      duplicateInCloud("acme/team/planner", { name: "***", mode: "inherit", to: "my-org/default" }, { createClient: async () => client }),
    ).rejects.toThrow('"***" cannot be used as a Cloud profile name');
    expect(calls).toHaveLength(0);
  });

  it("maps each Cloud duplicate error to a clear message", async () => {
    const cases: Array<[number, Record<string, unknown>, string]> = [
      [400, { code: "invalid_input", message: "name cannot be slugified" }, '"Planner QA" cannot be used as a Cloud profile name'],
      [409, { code: "duplicate_slug", message: "exists" }, "my-org/default already has a profile with the slug planner-qa. Pick another name, e.g. `ht profile duplicate acme/team/planner planner-qa-2 --to my-org/default`."],
      [404, { code: "not_found", message: "no such plugin" }, "Cloud cannot find acme/team/planner: it is hidden, private, or does not exist."],
      [403, { code: "forbidden", message: "unknown org" }, "Cloud does not know the organization my-org, or this account cannot publish there. Check --to my-org/default."],
      [404, { code: "catalog_not_found", message: "No catalog default." }, "Cloud cannot find the catalog in my-org/default (No catalog default). Check --to <org>/<catalog>."],
    ];
    for (const [status, error, expected] of cases) {
      const { client } = fakeClient(() => {
        throw new CloudApiError("duplicate failed", status, { error: { ...error, requestId: "req_d1" } });
      });
      const run = duplicateInCloud("acme/team/planner", { name: "Planner QA", mode: "inherit", to: "my-org/default" }, { createClient: async () => client });
      await expect(run).rejects.toThrow(expected);
      await expect(
        duplicateInCloud("acme/team/planner", { name: "Planner QA", mode: "inherit", to: "my-org/default" }, { createClient: async () => client }),
      ).rejects.toThrow("(request req_d1)");
    }
  });

  it("takes the request id from x-request-id when the body has none", async () => {
    const { client } = fakeClient(() => {
      throw new CloudApiError("duplicate failed", 409, { error: { code: "duplicate_slug", message: "exists" } }, new Headers({ "x-request-id": "req_hdr" }));
    });
    await expect(
      duplicateInCloud("acme/team/planner", { name: "planner-qa", mode: "inherit", to: "my-org/default" }, { createClient: async () => client }),
    ).rejects.toThrow("(request req_hdr)");
  });
});

describe("duplicate client fallback rule", () => {
  const request: CloudDuplicateRequest = {
    source: { org: "acme", catalog: "team", slug: "planner" },
    mode: "extends",
    name: "planner-qa",
    targetOrg: "my-org",
    targetCatalog: "default",
  };
  const client = () =>
    createCloudClient({ baseUrl: "http://cloud.test", token: { access_token: "t", expires_at: Math.floor(Date.now() / 1000) + 3600 } });

  it("reports no endpoint only for an uncoded 404, 405 or 501", async () => {
    const answers = [
      () => new Response("<html>Not Found</html>", { status: 404 }),
      () => Response.json({}, { status: 405 }),
      () => Response.json({ message: "not implemented" }, { status: 501 }),
    ];
    for (const answer of answers) {
      const spy = spyOn(globalThis, "fetch").mockImplementation((async () => answer()) as typeof fetch);
      try {
        expect(await client().duplicateCatalogPlugin(request)).toBeNull();
      } finally {
        spy.mockRestore();
      }
    }
  });

  it("throws on a coded 404 so the caller shows the real error", async () => {
    for (const code of ["not_found", "catalog_not_found"]) {
      const spy = spyOn(globalThis, "fetch").mockImplementation((async () =>
        Response.json({ error: { code, message: "missing" } }, { status: 404, headers: { "x-request-id": "req_404" } })) as typeof fetch);
      try {
        const error = await client().duplicateCatalogPlugin(request).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CloudApiError);
        expect((error as CloudApiError).detail).toMatchObject({ code, requestId: "req_404" });
      } finally {
        spy.mockRestore();
      }
    }
  });
});
