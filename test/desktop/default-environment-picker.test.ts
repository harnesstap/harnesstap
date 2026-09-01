import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ENV_CREATE,
  DEFAULT_ENV_NONE,
  defaultEnvironmentSelectValue,
  interpretDefaultEnvironmentChoice,
} from "../../apps/desktop/src/lib/default-environment-picker.ts";

describe("default environment picker choices", () => {
  test("maps a missing binding to the empty None choice", () => {
    expect(defaultEnvironmentSelectValue(null)).toBe(DEFAULT_ENV_NONE);
    expect(defaultEnvironmentSelectValue("staging")).toBe("staging");
  });

  test("interprets None, create, and named choices", () => {
    expect(interpretDefaultEnvironmentChoice(DEFAULT_ENV_NONE)).toBe("none");
    expect(interpretDefaultEnvironmentChoice(DEFAULT_ENV_CREATE)).toBe("create");
    expect(interpretDefaultEnvironmentChoice("prod")).toEqual({
      kind: "named",
      name: "prod",
    });
  });
});
