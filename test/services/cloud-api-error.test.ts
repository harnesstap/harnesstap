import { describe, expect, it } from "bun:test";
import { CloudApiError, parseCloudErrorBody, parseCloudErrorText } from "../../src/services/cloud-api-error.ts";
import { cloudPublishErrorMessage } from "../../src/services/plugin-extends.ts";
import type { Plugin } from "../../src/types.ts";

const child = {
  id: "p1",
  name: "backend-qa",
  upstream: { kind: "extends", ref: "acme/team/backend@^1.0.0", version_at_link: "1.0.0" },
} as unknown as Plugin;

describe("Cloud error shapes (harnesstap-cloud#143)", () => {
  it("reads code, entry, message and request id inside or beside error", () => {
    const nested = { error: { code: "invalid_exclude", entry: "foo:bar", message: "Unknown type foo.", requestId: "req_1" } };
    expect(parseCloudErrorBody(nested)).toEqual({
      code: "invalid_exclude",
      entry: "foo:bar",
      message: "Unknown type foo.",
      requestId: "req_1",
      ref: undefined,
    });
    const beside = { error: { code: "upstream_unpublished", ref: "acme/team/backend@^1" }, message: "Not published.", requestId: "req_2" };
    expect(parseCloudErrorBody(beside)).toMatchObject({ code: "upstream_unpublished", ref: "acme/team/backend@^1", message: "Not published.", requestId: "req_2" });
    expect(parseCloudErrorText('HTTP 400: {"error":"upstream_unpublished","ref":"a/b/c@^1"}')).toMatchObject({ code: "upstream_unpublished", ref: "a/b/c@^1" });
  });

  it("names the rejected hidden item and how to fix it", () => {
    const error = new CloudApiError("publish failed", 400, {
      error: { code: "invalid_exclude", entry: "foo:bar", message: "Unknown resource type foo.", requestId: "req_9" },
    });
    expect(error.message).toBe("publish failed: 400 Unknown resource type foo.");
    expect(cloudPublishErrorMessage(child, error)).toBe(
      'Cloud rejected the hidden item "foo:bar" of backend-qa (Unknown resource type foo). Each hidden item is <type>:<name>, where type is one of instruction, skill, rule, mcp_server, permission, hook, agent, command, env_var, model_config, plugin. Run `ht plugin edit backend-qa --unhide foo:bar` and publish again. (request req_9)',
    );
  });

  it("names Cloud's ref for an unpublished parent", () => {
    const error = new CloudApiError("publish failed", 400, {
      error: { code: "upstream_unpublished", ref: "acme/team/backend@^1", message: "Upstream is not published.", requestId: "req_3" },
    });
    expect(cloudPublishErrorMessage(child, error)).toBe(
      "backend-qa keeps in sync with acme/team/backend@^1, which is not published. Publish the parent first, or detach this profile to publish it as a separate copy. (request req_3)",
    );
  });

  it("leaves other errors to the caller", () => {
    expect(cloudPublishErrorMessage(child, new CloudApiError("publish failed", 403, { error: { code: "forbidden" } }))).toBeUndefined();
    expect(cloudPublishErrorMessage(child, new Error("network down"))).toBeUndefined();
  });
});
