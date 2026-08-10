import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { listProfilePlugins } from "../../src/constants/profile.ts";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { getActiveProfileName } from "../../src/services/active-profile.ts";
import { ensureDefaultProfilePlugin } from "../../src/services/ensure-default-profile.ts";
import { createProfileCommand } from "../../src/services/profile-commands.ts";

describe("ensureDefaultProfilePlugin", () => {
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
    expect(listProfilePlugins()).toHaveLength(0);

    const result = ensureDefaultProfilePlugin();
    expect(result.created).toBe(true);
    expect(result.plugin.name).toBe("default");
    expect(listProfilePlugins().map((plugin) => plugin.name)).toEqual(["default"]);
    expect(getActiveProfileName()).toBe("default");
  });

  it("is a no-op when a profile already exists", () => {
    withHome();
    createProfileCommand({ name: "work" });

    const result = ensureDefaultProfilePlugin();
    expect(result.created).toBe(false);
    expect(result.plugin.name).toBe("work");
    expect(listProfilePlugins().map((plugin) => plugin.name)).toEqual(["work"]);
  });
});
