import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { ResourceDeletePlan } from "../../apps/desktop/src/lib/api/resource-mutate.ts";
import {
  formatResourceDeleteAttachers,
  formatResourceDeletePlanSummary,
  formatResourceDeleteSuccess,
  RESOURCE_DELETE_DISK_LABEL,
  RESOURCE_DELETE_LIBRARY_LABEL,
  resourceCanRemoveFromActiveProfile,
  resourceDeleteDiskDisabled,
  type ResourceAttachers,
} from "../../apps/desktop/src/lib/resource-delete.ts";

const empty: ResourceAttachers = {
  profiles: [],
  plugins: [],
  active_profile: null,
  in_active_profile: false,
};

const detailSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourceDetailBody.tsx",
  ),
  "utf8",
);
const confirmSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/ConfirmDialog.tsx"),
  "utf8",
);
const mutateSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/lib/api/resource-mutate.ts"),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

function samplePlan(
  overrides: Partial<ResourceDeletePlan> = {},
): ResourceDeletePlan {
  return {
    resource: {
      id: "1",
      type: "skill",
      name: "ship",
      namespace: null,
    },
    locations: [
      {
        scope: "global",
        project_id: null,
        project_name: null,
        root_path: "/home",
        path: "/home/.cursor/skills/ship/SKILL.md",
        action: "delete-directory",
        ownership_key: "skill:ship",
        reason: "Owned skill directory",
      },
      {
        scope: "project",
        project_id: "p1",
        project_name: "demo",
        root_path: "/proj",
        path: "/proj/.cursor/skills/ship/SKILL.md",
        action: "delete-directory",
        ownership_key: "skill:ship",
        reason: "Owned skill directory",
      },
      {
        scope: "source",
        project_id: null,
        project_name: null,
        root_path: "/src",
        path: "/src/ship.md",
        action: "delete-file",
        ownership_key: "skill:ship",
        reason: "Source path",
      },
    ],
    blockers: [],
    can_delete_from_disk: true,
    ...overrides,
  };
}

describe("formatResourceDeleteAttachers", () => {
  test("lists attached profiles and plugins", () => {
    const copy = formatResourceDeleteAttachers({
      profiles: ["work", "default"],
      plugins: ["formatter"],
      active_profile: "work",
      in_active_profile: true,
    });
    expect(copy.profilesLine).toBe("Profiles: work, default");
    expect(copy.pluginsLine).toBe("Plugins: formatter");
    expect(copy.emptyLine).toBeNull();
  });

  test("says when nothing attaches the resource", () => {
    const copy = formatResourceDeleteAttachers(empty);
    expect(copy.profilesLine).toBeNull();
    expect(copy.pluginsLine).toBeNull();
    expect(copy.emptyLine).toBe("No profiles or plugins currently attach this resource.");
  });
});

describe("resourceCanRemoveFromActiveProfile", () => {
  test("is true only when the resource is enabled on the active profile", () => {
    expect(
      resourceCanRemoveFromActiveProfile({
        ...empty,
        active_profile: "work",
        in_active_profile: true,
      }),
    ).toBe(true);
    expect(
      resourceCanRemoveFromActiveProfile({
        ...empty,
        active_profile: "work",
        in_active_profile: false,
      }),
    ).toBe(false);
    expect(resourceCanRemoveFromActiveProfile(empty)).toBe(false);
  });
});

describe("resource delete plan helpers", () => {
  test("exposes both delete action labels", () => {
    expect(RESOURCE_DELETE_LIBRARY_LABEL).toBe("Delete from library");
    expect(RESOURCE_DELETE_DISK_LABEL).toBe("Delete from library + disk");
  });

  test("groups plan locations by scope", () => {
    const summary = formatResourceDeletePlanSummary(samplePlan());
    expect(summary.groups.map((group) => group.scope)).toEqual([
      "global",
      "project",
      "source",
    ]);
    expect(summary.emptyMessage).toBeNull();
  });

  test("disables disk deletion when the plan is protected", () => {
    const plan = samplePlan({
      can_delete_from_disk: false,
      blockers: ["Modified file is protected"],
      locations: [
        {
          scope: "global",
          project_id: null,
          project_name: null,
          root_path: "/home",
          path: "/home/.cursor/rules/ship.mdc",
          action: "protected",
          ownership_key: "rule:ship",
          reason: "Modified file is protected",
        },
      ],
    });
    expect(resourceDeleteDiskDisabled(plan)).toBe(true);
    expect(formatResourceDeletePlanSummary(plan).blockers).toContain(
      "Modified file is protected",
    );
  });

  test("shows a safe empty message when no locations exist", () => {
    const summary = formatResourceDeletePlanSummary(
      samplePlan({ locations: [], can_delete_from_disk: true }),
    );
    expect(summary.emptyMessage).toBe(
      "No on-disk locations were found for this resource.",
    );
  });

  test("formats success copy for both modes", () => {
    expect(formatResourceDeleteSuccess("library", "skill ship", {
      deleted_files: [],
      edited_files: [],
    })).toBe("Deleted skill ship");
    expect(
      formatResourceDeleteSuccess("library_and_disk", "skill ship", {
        deleted_files: ["a"],
        edited_files: ["b", "c"],
      }),
    ).toBe("Deleted skill ship from library and disk (1 deleted, 2 edited)");
  });
});

describe("resource delete confirm chrome", () => {
  test("lists attachers and offers Remove from active profile", () => {
    expect(detailSource).toContain("formatResourceDeleteAttachers");
    expect(detailSource).toContain("resourceCanRemoveFromActiveProfile");
    expect(detailSource).toContain("Remove from active profile");
    expect(detailSource).toContain("tertiaryLabel={canRemoveFromActive");
    expect(detailSource).toContain("removeProfileResource");
    expect(confirmSource).toContain("tertiaryLabel");
    expect(confirmSource).toContain("onTertiary");
  });

  test("loads the delete plan and exposes both delete modes", () => {
    expect(detailSource).toContain("previewLibraryResourceDelete");
    expect(detailSource).toContain("RESOURCE_DELETE_LIBRARY_LABEL");
    expect(detailSource).toContain("RESOURCE_DELETE_DISK_LABEL");
    expect(detailSource).toContain('runDelete("library")');
    expect(detailSource).toContain('runDelete("library_and_disk")');
    expect(mutateSource).toContain("delete-plan");
    expect(mutateSource).toContain("library_and_disk");
  });

  test("documents listing attachers on resource delete", () => {
    expect(designSource).toContain("list profiles and plugins that still attach");
    expect(designSource).toContain("Remove from active profile");
    expect(designSource).toContain("Delete from library + disk");
    expect(designSource).toContain("Protected");
  });
});

describe("resource delete documentation", () => {
  test("SPEC documents library_and_disk mode", () => {
    const specSource = readFileSync(
      join(import.meta.dir, "../../SPEC.md"),
      "utf8",
    );
    expect(specSource).toContain("library_and_disk");
    expect(specSource).toContain("delete-plan");
  });
});
