import { describe, expect, it } from "bun:test";
import {
  homeScopePreviewKey,
  isPreviewSettled,
  projectScopePreloadKey,
  shouldStartProjectScopePreload,
} from "../../apps/desktop/src/lib/project-scope-preload.ts";
import type { ProfileSummary } from "../../apps/desktop/src/lib/types.ts";
import type { PreviewKey } from "../../apps/desktop/src/state/status-store.ts";

function profile(name: string, scopes: Array<"home" | "project">): ProfileSummary {
  return { name, version: "1.0.0", tags: [], description: null, scopes };
}

const projectKey: PreviewKey = {
  scope: "project",
  projectPath: "/repo",
  profile: "project default",
};

describe("projectScopePreloadKey", () => {
  it("picks the active profile when it is enabled in project scope", () => {
    expect(
      projectScopePreloadKey({
        projectPath: "/repo",
        activeProfile: "work",
        profiles: [
          profile("global default", ["home"]),
          profile("work", ["home", "project"]),
          profile("project default", ["project"]),
        ],
      }),
    ).toEqual({ scope: "project", projectPath: "/repo", profile: "work" });
  });

  it("falls back to the first project profile when active is Global-only", () => {
    expect(
      projectScopePreloadKey({
        projectPath: "/repo",
        activeProfile: "global default",
        profiles: [
          profile("zeta", ["project"]),
          profile("alpha", ["project"]),
          profile("global default", ["home"]),
        ],
      }),
    ).toEqual({ scope: "project", projectPath: "/repo", profile: "alpha" });
  });

  it("returns null without a project path or project-scoped profiles", () => {
    expect(
      projectScopePreloadKey({
        projectPath: "  ",
        activeProfile: "work",
        profiles: [profile("work", ["project"])],
      }),
    ).toBeNull();
    expect(
      projectScopePreloadKey({
        projectPath: "/repo",
        activeProfile: "work",
        profiles: [profile("work", ["home"]), profile("empty", ["project"])],
      }),
    ).toBeNull();
  });
});

describe("shouldStartProjectScopePreload", () => {
  const ready = {
    connected: true,
    switching: false,
    projectPath: "/repo",
    profilesRefreshing: false,
    projectKey,
    projectPreviewRefreshing: false,
    projectPreviewSettled: false,
    homePreviewSettled: true,
  };

  it("waits until Global preview has settled so first Global open stays unblocked", () => {
    expect(shouldStartProjectScopePreload({ ...ready, homePreviewSettled: false })).toBe(
      false,
    );
    expect(shouldStartProjectScopePreload(ready)).toBe(true);
  });

  it("does not start while disconnected, switching, listing profiles, or already warm", () => {
    expect(shouldStartProjectScopePreload({ ...ready, connected: false })).toBe(false);
    expect(shouldStartProjectScopePreload({ ...ready, switching: true })).toBe(false);
    expect(shouldStartProjectScopePreload({ ...ready, profilesRefreshing: true })).toBe(
      false,
    );
    expect(shouldStartProjectScopePreload({ ...ready, projectKey: null })).toBe(false);
    expect(
      shouldStartProjectScopePreload({ ...ready, projectPreviewRefreshing: true }),
    ).toBe(false);
    expect(
      shouldStartProjectScopePreload({ ...ready, projectPreviewSettled: true }),
    ).toBe(false);
  });
});

describe("homeScopePreviewKey and isPreviewSettled", () => {
  it("selects the Global rail default and treats empty entries as cold", () => {
    expect(
      homeScopePreviewKey({
        activeProfile: "work",
        profiles: [profile("work", ["home"]), profile("project default", ["project"])],
      }),
    ).toEqual({ scope: "global", projectPath: null, profile: "work" });
    expect(isPreviewSettled(undefined)).toBe(false);
    expect(isPreviewSettled({ data: null, error: null })).toBe(false);
    expect(isPreviewSettled({ data: null, error: "offline" })).toBe(true);
  });
});
