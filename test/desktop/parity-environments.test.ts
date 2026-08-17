import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  canSubmitEnvironmentCreate,
  environmentApplyAvailable,
  environmentDeleteNeedsForce,
  filterEnvironmentsByQuery,
  type EnvironmentListRow,
} from "../../apps/desktop/src/lib/api/environments.ts";

const workspaceSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/EnvironmentsWorkspace.tsx",
  ),
  "utf8",
);
const stylesSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/styles.css"),
  "utf8",
);
const appSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
  "utf8",
);

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

describe("environments workspace chrome", () => {
  it("marks the active environment on the list, not as a header sidecar status", () => {
    expect(workspaceSource).toContain("row.is_global_active");
    expect(workspaceSource).toContain('<span className="badge">active</span>');
    expect(workspaceSource).not.toContain("sidecarStatusCopy");
    expect(workspaceSource).not.toContain("Sidecar in sync");
    expect(workspaceSource).not.toContain("edit-active-badge");
    expect(workspaceSource).not.toContain("fetchEnvironmentStatus");
    expect(stylesSource).toContain(".resources-list-name .badge");
  });

  it("keeps plugin references in details, not the sidebar inventory line", () => {
    expect(workspaceSource).toContain(
      "{row.value_count} values · {row.secret_ref_count} secrets",
    );
    expect(workspaceSource).not.toContain("{row.reference_count} plugins");
    expect(workspaceSource).toContain("Plugins referencing this environment");
    expect(workspaceSource).toContain("link-btn");
    expect(workspaceSource).toContain("onOpenPlugin");
    expect(appSource).toContain("setLibraryFocusPlugin");
    expect(appSource).toContain("focusPluginName={libraryFocusPlugin}");
  });

  it("opens a library plugin detail without a Packages tab", () => {
    expect(appSource).toContain("setLibraryFocusPlugin");
    expect(appSource).toContain('setWorkspaceFocus("library")');
    expect(appSource).not.toContain('setLibraryTab("packages")');
  });

  it("puts icon apply, edit, and delete in the detail header, not the sidebar", () => {
    expect(workspaceSource).not.toContain("Use globally");
    expect(workspaceSource).not.toContain("CirclePlay");
    expect(workspaceSource).toContain("edit-profile-header-actions");
    expect(workspaceSource).toContain('data-testid="apply-environment"');
    expect(workspaceSource).toContain("environmentApplyAvailable");
    expect(workspaceSource).toContain("Pencil");
    expect(workspaceSource).toContain("Trash2");
    expect(workspaceSource).toContain("<Check");
    expect(workspaceSource).not.toContain("{busy ? \"Applying…\" : \"Apply\"}");
    expect(workspaceSource).toContain("useEnvironmentGlobally");
  });

  it("uses keyed detail layout and selected list chrome", () => {
    expect(workspaceSource).toContain("resource-detail-kv");
    expect(workspaceSource).toContain("harness-block");
    expect(workspaceSource).toContain("aria-current");
    expect(workspaceSource).toContain("is-selected");
    expect(stylesSource).toContain(".resources-list-env");
  });

  it("puts the name filter in the list sidebar, not the panel header", () => {
    const layoutPos = workspaceSource.indexOf("resources-panel-layout");
    const filterPos = workspaceSource.indexOf('aria-label="Filter environments"');
    expect(layoutPos).toBeGreaterThan(-1);
    expect(filterPos).toBeGreaterThan(layoutPos);
    expect(workspaceSource).toContain('aria-label="Environment list"');
    expect(stylesSource).toContain(".environment-list-sidebar");
  });
});

describe("environmentApplyAvailable", () => {
  it("shows Apply only when detected values drifted from this environment", () => {
    expect(environmentApplyAvailable({ has_detected_drift: false })).toBe(false);
    expect(environmentApplyAvailable({ has_detected_drift: true })).toBe(true);
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
