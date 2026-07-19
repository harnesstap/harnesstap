import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { getHarnesstapDir, getDbPath } from "../../src/db/connection.js";

describe("harnesstap home", () => {
  const prevHome = process.env.HARNESSTAP_HOME;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HARNESSTAP_HOME;
    else process.env.HARNESSTAP_HOME = prevHome;
  });

  it("uses HARNESSTAP_HOME when set", () => {
    process.env.HARNESSTAP_HOME = "/tmp/ht-home-test";
    expect(getHarnesstapDir()).toBe("/tmp/ht-home-test");
    expect(getDbPath()).toBe(join("/tmp/ht-home-test", "harnesstap.db"));
  });

  it("defaults to ~/.harnesstap under HOME", () => {
    delete process.env.HARNESSTAP_HOME;
    process.env.HOME = "/tmp/fake-home";
    expect(getHarnesstapDir()).toBe(join("/tmp/fake-home", ".harnesstap"));
  });
});
