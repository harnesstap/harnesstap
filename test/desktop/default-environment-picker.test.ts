import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ENV_COPY,
  DEFAULT_ENV_CREATE,
  defaultEnvironmentFieldState,
  firstEnvironmentName,
  interpretDefaultEnvironmentChoice,
} from "../../apps/desktop/src/lib/default-environment-picker.ts";

const field = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/parity/DefaultEnvironmentField.tsx"),
  "utf8",
);
const css = readFileSync(join(import.meta.dir, "../../apps/desktop/src/styles/features/scope.css"), "utf8");

describe("default environment field", () => {
  test("has two states: empty shows Add, set shows the dropdown and the x", () => {
    expect(defaultEnvironmentFieldState(null)).toBe("empty");
    expect(defaultEnvironmentFieldState("staging")).toBe("set");
    expect(field).toContain('state === "empty" ? (');
    expect(field).toContain('data-testid="default-environment-add"');
    expect(field).toContain('data-testid="default-environment-clear"');
  });

  test("Add preselects the first environment and autosaves it", () => {
    expect(firstEnvironmentName([{ name: "default" }, { name: "staging" }])).toBe("default");
    expect(firstEnvironmentName([])).toBeNull();
    expect(field).toContain("onChange(first);");
  });

  test("the dropdown never offers None; removing goes through the x", () => {
    expect(field).not.toContain(">None<");
    expect(field).not.toContain('placeholder="None"');
    expect(field).not.toContain("DEFAULT_ENV_NONE");
    expect(interpretDefaultEnvironmentChoice(DEFAULT_ENV_CREATE)).toBe("create");
    expect(interpretDefaultEnvironmentChoice("prod")).toEqual({ kind: "named", name: "prod" });
  });

  test("uses plain labels and tooltips", () => {
    expect(DEFAULT_ENV_COPY.add).toBe("Add default environment");
    expect(DEFAULT_ENV_COPY.remove).toBe("Remove default environment");
    expect(field).toContain("label={DEFAULT_ENV_COPY.remove}");
    expect(field).toContain("title={DEFAULT_ENV_COPY.addTooltip}");
    expect(field).toContain("showLabel");
  });

  test("both states share one fixed-height row, so the pane does not shift", () => {
    const row = css.slice(css.indexOf(".default-env-row {"), css.indexOf("}", css.indexOf(".default-env-row {")));
    expect(row).toContain("height: 2rem;");
    expect(field).toContain('className="default-env-row"');
  });
});
