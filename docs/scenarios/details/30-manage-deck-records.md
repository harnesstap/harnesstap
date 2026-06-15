# Scenario 30: Import, inspect, and remove deck records

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you work with portable deck repos, need to see which layers a
deck contains, or want to clear a stale deck record from the local database
without deleting layers or on-disk files.

Typical commands:

```bash
harnessdeck deck list
harnessdeck deck import ./team-deck
harnessdeck deck show team-platform
harnessdeck deck show team-platform --format json
harnessdeck deck export team-platform --output ./team-deck-export
harnessdeck deck delete old-deck
```

`deck delete` removes only the SQLite record and `deck_layers` membership.
Imported **layers**, **environments**, and the git repo directory are left
unchanged. When the deck has a `root_path`, the CLI prompts for confirmation
unless you pass `--force`.

Round-trip a deck for git transport:

```bash
harnessdeck deck export team-platform --output ./team-deck --with-layer-exports
harnessdeck deck import ./team-deck --as team-platform-copy
harnessdeck deck doctor ./team-deck
```

After import, apply the stack with [Scenario 29](./29-apply-deck.md). For
single-layer portable sharing, see [Scenario 10](./10-export-import-layer.md).
