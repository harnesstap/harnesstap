import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { CloudApiError } from "../../src/services/cloud-api-error.ts";
import type { CloudClient, CloudDuplicateRequest } from "../../src/services/cloud-client.ts";
import { duplicateInCloud } from "../../src/services/plugin-duplicate-cloud.ts";
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
});
