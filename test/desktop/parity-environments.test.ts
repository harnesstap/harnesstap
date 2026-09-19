import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canSubmitEnvironmentCreate,
  type EnvironmentListRow,
  environmentApplyAvailable,
  environmentDeleteNeedsForce,
  filterEnvironmentsByQuery,
  formatEnvironmentClipboard,
  isSecretLikeEnvKey,
} from "../../apps/desktop/src/lib/api/environments.ts";
import { readDesktopShellSource } from "../helpers/desktop-shell-source";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const workspaceSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/environments/EnvironmentsWorkspace.tsx",
  ),
  "utf8",
);
const drawerSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/environments/EnvironmentDrawer.tsx",
  ),
  "utf8",
);
const stylesSource = readDesktopCss();
const appSource = readDesktopShellSource();

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
    expect(appSource).toContain('nav.go("library")');
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

  it("renders an explicit back control before the Environments title", () => {
    const headerStart = workspaceSource.indexOf(
      'className="resources-panel-header-row"',
    );
    const header = workspaceSource.slice(
      headerStart,
      workspaceSource.indexOf("resources-panel-layout", headerStart),
    );
    const backIdx = header.indexOf("WorkspaceBackButton");
    const titleIdx = header.indexOf(">Environments<");
    expect(backIdx).toBeGreaterThan(-1);
    expect(titleIdx).toBeGreaterThan(backIdx);
    expect(workspaceSource).toContain("onWorkspaceBack");
  });

  it("hides Back at the list entrypoint and makes Create accent", () => {
    expect(workspaceSource).toContain("<WorkspaceBackButton");
    expect(workspaceSource).toContain("hidden");
    expect(workspaceSource).not.toContain("hidden={!canWorkspaceBack}");
    expect(workspaceSource).toContain('label="Create environment"');
    expect(workspaceSource).toContain("primary");
  });

  it("shows skeleton rows on first load and clears detail when switching", () => {
    expect(workspaceSource).toContain("listLoading");
    expect(workspaceSource).toContain("SkeletonRow");
    expect(workspaceSource).toContain("m-skeleton");
    expect(workspaceSource).toContain("selectEnvironment");
    expect(workspaceSource).toContain("setDetail(null)");
  });

  it("copies values and masks secret-like keys", () => {
    expect(workspaceSource).toContain('label="Copy all"');
    expect(workspaceSource).toContain("isSecretLikeEnvKey");
    expect(workspaceSource).toContain("formatEnvironmentClipboard");
  });

  it("includes create values and lands on detail", () => {
    expect(drawerSource).toContain("An environment with this name already exists.");
    expect(drawerSource).not.toContain("A environment with this name already exists.");
    expect(drawerSource).toContain("Secret refs can be added after you create this environment.");
    expect(drawerSource).toContain('title="Values"');
    expect(drawerSource).toContain("onSaved(`Created environment");
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

describe("isSecretLikeEnvKey", () => {
  it("matches *_KEY, *TOKEN*, and *SECRET*", () => {
    expect(isSecretLikeEnvKey("OPENAI_API_KEY")).toBe(true);
    expect(isSecretLikeEnvKey("AUTH_TOKEN")).toBe(true);
    expect(isSecretLikeEnvKey("DB_SECRET")).toBe(true);
    expect(isSecretLikeEnvKey("REGION")).toBe(false);
  });
});

describe("formatEnvironmentClipboard", () => {
  it("formats env vars as KEY=value lines", () => {
    expect(
      formatEnvironmentClipboard({
        environment: {
          id: "1",
          name: "dev",
          description: "",
          created_at: "",
          updated_at: "",
        },
        values: {
          env_vars: { REGION: "us-west" },
          model_configs: [],
          permissions: [],
        },
        secret_refs: { API_KEY: { provider: "env", ref: "API_KEY" } },
        references: { plugins: [] },
      }),
    ).toBe("REGION=us-west\nAPI_KEY=env:API_KEY");
  });
});
