import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { listProfileLayers } from "../../src/constants/profile.ts";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { getActiveProfileName } from "../../src/services/active-profile.ts";
import { ensureDefaultProfileLayer } from "../../src/services/ensure-default-profile.ts";
import { createProfileCommand } from "../../src/services/profile-commands.ts";

describe("ensureDefaultProfileLayer", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = previousHome;
    }
  });

  function withHome() {
    const dir = mkdtempSync(join(tmpdir(), "ht-ensure-default-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    initializeSchema(getDb());
    return dir;
  }

  it("creates and activates a default profile when none exist", () => {
    withHome();
    expect(listProfileLayers()).toHaveLength(0);

    const result = ensureDefaultProfileLayer();
    expect(result.created).toBe(true);
    expect(result.layer.name).toBe("default");
    expect(listProfileLayers().map((layer) => layer.name)).toEqual(["default"]);
    expect(getActiveProfileName()).toBe("default");
  });

  it("is a no-op when a profile already exists", () => {
    withHome();
    createProfileCommand({ name: "work" });

    const result = ensureDefaultProfileLayer();
    expect(result.created).toBe(false);
    expect(result.layer.name).toBe("work");
    expect(listProfileLayers().map((layer) => layer.name)).toEqual(["work"]);
  });
});
