---
name: harness-docs-cursor
description: Use when checking whether HarnessTap is in sync with the official Cursor docs, changelog, or config schema, or when asked what Cursor added or changed since the last review. Produces a gap report for the `cursor` harness; the harness-docs-sync skill runs it as part of a full sweep.
---

# harness-docs-cursor

Compare the official Cursor documentation with what HarnessTap supports for the `cursor` harness and write a gap report. Read-only: do not change product code from this skill.

## Upstream sources

Start here. If a link is dead or moved, find the new official page, use it, and list the replacement under "Source changes" in the report so the next run can update this file.

- Docs: https://cursor.com/docs
- Changelog: https://cursor.com/changelog
- Rules: https://cursor.com/docs/rules
- MCP: https://cursor.com/docs/mcp
- Skills: https://cursor.com/docs/skills
- Subagents: https://cursor.com/docs/subagents
- Commands: https://cursor.com/help/customization/skills
- Hooks: https://cursor.com/docs/hooks
- Plugins: https://cursor.com/docs/plugins

Prefer official vendor pages, the vendor's own repo, and machine-readable schemas over blog posts or third-party summaries.

## HarnessTap implementation

Integration tier: dedicated serializer.

- `src/platforms/registry.ts` (entry `cursor`: supported features and paths)
- `src/services/platform-serializers.ts` (serializer dispatch)
- `src/platforms/cursor.ts`
- `src/services/cursor-marketplace-bootstrap.ts`
- `src/services/cursor-host-managed-skills.ts`
- `src/services/host-native-mcp.ts`
- `src/services/hook-serialization.ts`
- `test/platforms/cursor.test.ts`
- `docs/supported-harnesses.md` (user-facing mirror of the registry)

The list above can go stale. Refresh it before comparing:

```sh
rg -l '"cursor"' src test
```

## Procedure

1. Read `.agents/skills/harness-docs-sync/state.json`. Take `harnesses["cursor"]` (`lastReviewed`, `lastSeenVersion`). When present, only review changelog or release entries newer than that date or version, plus any doc page that changed since. When absent, do a full baseline review.
2. Follow the shared steps in `.agents/skills/harness-docs-sync/procedure.md`: collect upstream facts, read the HarnessTap files above, and classify each feature area.
3. Write the report in the format from `.agents/skills/harness-docs-sync/report-format.md` to the report directory given there. Never write reports inside tracked repo paths.
4. Update `harnesses["cursor"]` in the state file with today's date, the newest upstream version or release you reviewed (or `null` if the harness publishes none), and any replaced source URLs. Skip this step when the orchestrator runs you; it updates the state file once at the end.
