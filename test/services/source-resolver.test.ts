// test/services/source-resolver.test.ts
import { describe, expect, it } from "bun:test";
import {
  resolveRemoteSource,
  sourceCacheDir,
} from "../../src/services/source-resolver.ts";

describe("source-resolver", () => {
  it("resolves owner/repo to github git URL", () => {
    expect(resolveRemoteSource("mattpocock/skills")).toEqual({
      kind: "git",
      url: "https://github.com/mattpocock/skills.git",
      label: "mattpocock/skills",
      owner: "mattpocock",
      repo: "skills",
    });
  });

  it("normalizes https github URLs", () => {
    expect(resolveRemoteSource("https://github.com/mattpocock/skills")).toMatchObject({
      kind: "git",
      url: "https://github.com/mattpocock/skills.git",
      label: "mattpocock/skills",
    });
  });

  it("passes through local directories", () => {
    const fixture = new URL("../fixtures/skill-packages/mattpocock-minimal", import.meta.url).pathname;
    expect(resolveRemoteSource(fixture)).toEqual({
      kind: "local",
      path: fixture,
      label: "mattpocock-minimal",
    });
  });

  it("builds stable cache dir under harnesstap home", () => {
    expect(sourceCacheDir("/ht/home", "mattpocock", "skills")).toBe(
      "/ht/home/cache/sources/mattpocock/skills",
    );
  });
});
