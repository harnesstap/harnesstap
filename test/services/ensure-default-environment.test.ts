import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { createEnvironment, listEnvironments } from "../../src/models/environment.ts";
import { ensureDefaultEnvironment } from "../../src/services/ensure-default-environment.ts";
import { getGlobalActiveEnvironmentName } from "../../src/services/environment-session.ts";

describe("ensureDefaultEnvironment", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "ht-ensure-default-env-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    initializeSchema(getDb());
    return dir;
  }

  it("creates and activates a default environment when none exist", () => {
    withHome();
    expect(listEnvironments()).toHaveLength(0);

    const result = ensureDefaultEnvironment();
    expect(result.created).toBe(true);
    expect(result.environment.name).toBe("default");
    expect(listEnvironments().map((environment) => environment.name)).toEqual(["default"]);
    expect(getGlobalActiveEnvironmentName()).toBe("default");
  });

  it("is a no-op when an environment already exists", () => {
    withHome();
    createEnvironment({ name: "staging" });

    const result = ensureDefaultEnvironment();
    expect(result.created).toBe(false);
    expect(result.environment.name).toBe("staging");
    expect(listEnvironments().map((environment) => environment.name)).toEqual(["staging"]);
    expect(getGlobalActiveEnvironmentName()).toBeUndefined();
  });
});
