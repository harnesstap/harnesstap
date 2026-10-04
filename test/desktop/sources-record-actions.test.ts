import { describe, expect, test } from "bun:test";
import {
  discoverActionHelper,
  discoverAddToProfileLabel,
  discoverAddToProfileTooltip,
  discoverAttachTarget,
  sourcesAttachmentAdd,
  sourcesHitActions,
} from "../../apps/desktop/src/lib/sources-record-actions.ts";
import type { SourcesHit } from "../../apps/desktop/src/lib/sources-search.ts";

function cloudHit(presence: SourcesHit["presence"]): SourcesHit {
  return {
    id: "cloud:plugin:acme/tools/focus",
    kind: "plugin",
    name: "Focus",
    typeLabel: "plugin",
    sourceId: "cloud-org:acme",
    sourceLabel: "acme",
    presence,
    identity: { cloud: { org: "acme", catalog: "tools", name: "focus" } },
  };
}

function marketplaceHit(): SourcesHit {
  return {
    id: "mkt:plugin:demo",
    kind: "plugin",
    name: "demo",
    typeLabel: "plugin",
    sourceId: "marketplace:official",
    sourceLabel: "official",
    presence: "remote_only",
    identity: { marketplace: { marketplace: "official", plugin: "demo" } },
  };
}

function localPluginHit(): SourcesHit {
  return {
    id: "local:plugin:team",
    kind: "plugin",
    name: "team",
    typeLabel: "plugin",
    sourceId: "local",
    sourceLabel: "Local",
    presence: "in_library",
    identity: { localPluginName: "team" },
  };
}

function standaloneHit(): SourcesHit {
  return {
    id: "local:standalone:skill:hello@ns",
    kind: "standalone",
    name: "hello",
    typeLabel: "skill",
    sourceId: "local",
    sourceLabel: "Local",
    presence: "in_library",
    identity: { localSelector: "skill:hello@ns" },
  };
}

describe("sourcesHitActions", () => {
  test("Cloud remote-only shows Add to Library and Pin, Open in Library after add", () => {
    const remote = sourcesHitActions(cloudHit("remote_only"));
    expect(remote.showAddToLibrary).toBe(true);
    expect(remote.showAddToProfile).toBe(true);
    expect(remote.showPinToPlugin).toBe(true);
    expect(remote.showOpenInLibrary).toBe(false);
    expect(remote.openInLibrarySelector).toBeNull();

    const pulled = sourcesHitActions(cloudHit("remote_only"), {
      pulledName: "focus-copy",
    });
    expect(pulled.showAddToLibrary).toBe(false);
    expect(pulled.showOpenInLibrary).toBe(true);
    expect(pulled.openInLibrarySelector).toBe("focus-copy");
  });

  test("Cloud in-library hides Add to Library and opens the catalog plugin name", () => {
    const actions = sourcesHitActions(cloudHit("in_library"));
    expect(actions.showAddToLibrary).toBe(false);
    expect(actions.showAddToProfile).toBe(true);
    expect(actions.showPinToPlugin).toBe(true);
    expect(actions.showOpenInLibrary).toBe(true);
    expect(actions.openInLibrarySelector).toBe("focus");
  });

  test("Marketplace Add to Library uses name@marketplace with sync, Open in Library after add", () => {
    const before = sourcesHitActions(marketplaceHit());
    expect(before.showAddToLibrary).toBe(true);
    expect(before.showAddToProfile).toBe(true);
    expect(before.showPinToPlugin).toBe(true);
    expect(before.showOpenInLibrary).toBe(false);
    expect(sourcesAttachmentAdd(marketplaceHit())).toEqual({
      type: "plugin",
      selector: "demo@official",
      sync: true,
    });

    const after = sourcesHitActions(marketplaceHit(), {
      addedName: "demo",
    });
    expect(after.showAddToLibrary).toBe(false);
    expect(after.showOpenInLibrary).toBe(true);
    expect(after.openInLibrarySelector).toBe("demo");
  });

  test("Local plugin pins as a nested plugin ref", () => {
    const actions = sourcesHitActions(localPluginHit());
    expect(actions.showAddToLibrary).toBe(false);
    expect(actions.showAddToProfile).toBe(true);
    expect(actions.showPinToPlugin).toBe(true);
    expect(actions.showOpenInLibrary).toBe(true);
    expect(actions.openInLibrarySelector).toBe("team");
    expect(sourcesAttachmentAdd(localPluginHit())).toEqual({
      type: "plugin",
      selector: "team",
    });
  });

  test("Local standalone folds Attach into Pin", () => {
    const actions = sourcesHitActions(standaloneHit());
    expect(actions.showAddToLibrary).toBe(false);
    expect(actions.showAddToProfile).toBe(true);
    expect(actions.showPinToPlugin).toBe(true);
    expect(actions.showOpenInLibrary).toBe(true);
    expect(actions.openInLibrarySelector).toBe("skill:hello@ns");
    expect(sourcesAttachmentAdd(standaloneHit())).toEqual({
      type: "skill",
      selector: "skill:hello@ns",
    });
  });
});

describe("discover add to profile", () => {
  test("labels Add to profile with a current-profile tooltip", () => {
    expect(discoverAddToProfileLabel()).toBe("Add to profile");
    expect(discoverAddToProfileTooltip("demo", "work")).toBe(
      "Add demo to current profile work",
    );
    expect(discoverAddToProfileTooltip("demo", null)).toBe("No profile selected");
    expect(discoverActionHelper("work")).toBe(
      "Add copies it into your Library. Add to profile attaches it and applies. Pin links it into one of your plugins.",
    );
  });

  test("resolves a marketplace add from install state, else the library package", () => {
    expect(
      discoverAttachTarget(marketplaceHit(), {
        addedName: "demo",
        addedId: "plg_1",
      }, []),
    ).toEqual({ kind: "plugin", id: "plg_1", name: "demo" });

    expect(
      discoverAttachTarget(
        { ...marketplaceHit(), presence: "in_library" },
        {},
        [{ id: "plg_lib", name: "demo", type: "plugin", listKind: "plugin-package" }],
      ),
    ).toEqual({ kind: "plugin", id: "plg_lib", name: "demo" });
  });

  test("resolves standalone library resources from the local selector", () => {
    expect(
      discoverAttachTarget(standaloneHit(), {}, [
        {
          id: "res_1",
          name: "hello",
          type: "skill",
          namespace: "ns",
          listKind: "resource",
        },
      ]),
    ).toEqual({ kind: "resource", id: "res_1", name: "hello" });
  });
});
