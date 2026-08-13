import { describe, expect, it } from "bun:test";
import {
  canSubmitEnvironmentCreate,
  environmentDeleteNeedsForce,
  filterEnvironmentsByQuery,
  sidecarStatusCopy,
  type EnvironmentListRow,
} from "../../apps/desktop/src/lib/api/environments.ts";

const rows: EnvironmentListRow[] = [
  {
    id: "1",
    name: "staging",
    description: "stg west",
    value_count: 3,
    secret_ref_count: 1,
    reference_count: 2,
    is_global_active: true,
  },
  {
    id: "2",
    name: "prod",
    description: null,
    value_count: 0,
    secret_ref_count: 0,
    reference_count: 0,
    is_global_active: false,
  },
];

describe("filterEnvironmentsByQuery", () => {
  it("matches name and description", () => {
    expect(filterEnvironmentsByQuery(rows, "west").map((row) => row.name)).toEqual([
      "staging",
    ]);
    expect(filterEnvironmentsByQuery(rows, "PROD").map((row) => row.name)).toEqual([
      "prod",
    ]);
  });
});

describe("sidecarStatusCopy", () => {
  it("labels sidecar sync, drift count, and none", () => {
    expect(
      sidecarStatusCopy({
        global_environment: "staging",
        has_drift: false,
        drift: [],
      }),
    ).toEqual({
      kind: "sync",
      text: "Sidecar in sync with staging",
    });
    expect(
      sidecarStatusCopy({
        global_environment: "staging",
        has_drift: true,
        drift: [{}, {}],
      }),
    ).toEqual({
      kind: "drift",
      text: "2 keys out of sync with staging",
    });
    expect(sidecarStatusCopy({ global_environment: null, has_drift: false, drift: [] })).toEqual({
      kind: "none",
      text: "No active environment.",
      hint: "Use an environment to set it globally.",
    });
  });
});

describe("environmentDeleteNeedsForce", () => {
  it("requires a force checkbox when reference_count > 0", () => {
    expect(environmentDeleteNeedsForce(rows[0]!)).toBe(true);
    expect(environmentDeleteNeedsForce(rows[1]!)).toBe(false);
  });
});

describe("canSubmitEnvironmentCreate", () => {
  it("gates from-project on projectPath and from-plugin on plugins", () => {
    expect(
      canSubmitEnvironmentCreate({
        name: "x",
        mode: "blank",
        projectPath: null,
        plugins: [],
      }),
    ).toBe(true);
    expect(
      canSubmitEnvironmentCreate({
        name: "x",
        mode: "from-project",
        projectPath: null,
        plugins: [],
      }),
    ).toBe(false);
    expect(
      canSubmitEnvironmentCreate({
        name: "x",
        mode: "from-project",
        projectPath: "/abs/project",
        plugins: [],
      }),
    ).toBe(true);
    expect(
      canSubmitEnvironmentCreate({
        name: "x",
        mode: "from-plugin",
        projectPath: "/abs",
        plugins: [],
      }),
    ).toBe(false);
    expect(
      canSubmitEnvironmentCreate({
        name: "x",
        mode: "from-plugin",
        projectPath: "/abs",
        plugins: ["needs-region"],
      }),
    ).toBe(true);
  });
});
