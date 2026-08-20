import { describe, expect, test } from "bun:test";
import {
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
  test("Cloud remote-only shows Pull and Pin, Open in Library after pull", () => {
    const remote = sourcesHitActions(cloudHit("remote_only"));
    expect(remote.showPull).toBe(true);
    expect(remote.showPinToPlugin).toBe(true);
    expect(remote.showAttachToPlugin).toBe(false);
    expect(remote.showOpenInLibrary).toBe(false);
    expect(remote.openInLibrarySelector).toBeNull();

    const pulled = sourcesHitActions(cloudHit("remote_only"), {
      pulledName: "focus-copy",
    });
    expect(pulled.showOpenInLibrary).toBe(true);
    expect(pulled.openInLibrarySelector).toBe("focus-copy");
  });

  test("Cloud in-library hides Pull and opens the catalog plugin name", () => {
    const actions = sourcesHitActions(cloudHit("in_library"));
    expect(actions.showPull).toBe(false);
    expect(actions.showPinToPlugin).toBe(true);
    expect(actions.showOpenInLibrary).toBe(true);
    expect(actions.openInLibrarySelector).toBe("focus");
  });

  test("Marketplace pin uses name@marketplace with sync, Open in Library is the target plugin", () => {
    const before = sourcesHitActions(marketplaceHit());
    expect(before.showPull).toBe(false);
    expect(before.showPinToPlugin).toBe(true);
    expect(before.showOpenInLibrary).toBe(false);
    expect(sourcesAttachmentAdd(marketplaceHit())).toEqual({
      type: "plugin",
      selector: "demo@official",
      sync: true,
    });

    const after = sourcesHitActions(marketplaceHit(), {
      pinnedTargetName: "authored-app",
    });
    expect(after.showOpenInLibrary).toBe(true);
    expect(after.openInLibrarySelector).toBe("authored-app");
  });

  test("Local plugin attaches as a nested plugin ref", () => {
    const actions = sourcesHitActions(localPluginHit());
    expect(actions.showPull).toBe(false);
    expect(actions.showPinToPlugin).toBe(true);
    expect(actions.showAttachToPlugin).toBe(false);
    expect(actions.showOpenInLibrary).toBe(true);
    expect(actions.openInLibrarySelector).toBe("team");
    expect(sourcesAttachmentAdd(localPluginHit())).toEqual({
      type: "plugin",
      selector: "team",
    });
  });

  test("Local standalone attaches the resource selector", () => {
    const actions = sourcesHitActions(standaloneHit());
    expect(actions.showPull).toBe(false);
    expect(actions.showPinToPlugin).toBe(false);
    expect(actions.showAttachToPlugin).toBe(true);
    expect(actions.showOpenInLibrary).toBe(true);
    expect(actions.openInLibrarySelector).toBe("skill:hello@ns");
    expect(sourcesAttachmentAdd(standaloneHit())).toEqual({
      type: "skill",
      selector: "skill:hello@ns",
    });
  });
});
