import { describe, expect, it } from "bun:test";
import { sourcesHitActions } from "../../apps/desktop/src/lib/sources-record-actions.ts";
import type { SourcesHit } from "../../apps/desktop/src/lib/sources-search.ts";

function marketplaceHit(presence: SourcesHit["presence"]): SourcesHit {
  return {
    id: "mkt:cursor-public:continual-learning",
    kind: "plugin",
    name: "continual-learning",
    typeLabel: "plugin",
    sourceId: "marketplace:cursor-public",
    sourceLabel: "cursor-public",
    presence,
    identity: { marketplace: { marketplace: "cursor-public", plugin: "continual-learning" } },
  };
}

describe("sourcesHitActions for marketplace plugins", () => {
  it("has no Library selector for a remote-only hit, so Add to profile imports it first", () => {
    const actions = sourcesHitActions(marketplaceHit("remote_only"));
    expect(actions.showAddToLibrary).toBe(true);
    expect(actions.showOpenInLibrary).toBe(false);
    expect(actions.openInLibrarySelector).toBeNull();
  });

  it("opens the Library row once the plugin is in the Library", () => {
    expect(sourcesHitActions(marketplaceHit("in_library")).openInLibrarySelector).toBe(
      "continual-learning",
    );
    expect(
      sourcesHitActions(marketplaceHit("remote_only"), { addedName: "cl-local" })
        .openInLibrarySelector,
    ).toBe("cl-local");
  });
});
