---
name: harness-docs-windsurf
description: Use when checking whether HarnessTap is in sync with the official Windsurf docs, changelog, or config schema, or when asked what Windsurf added or changed since the last review. Produces a gap report for the `windsurf` harness; the harness-docs-sync skill runs it as part of a full sweep.
---

# harness-docs-windsurf

Compare the official Windsurf documentation with what HarnessTap supports for the `windsurf` harness and write a gap report. Read-only: do not change product code from this skill.

## Upstream sources

Start here. If a link is dead or moved, find the new official page, use it, and list the replacement under "Source changes" in the report so the next run can update this file.

- Docs: https://docs.devin.ai/desktop/getting-started
- Changelog: https://docs.devin.ai/desktop/changelog
- Rules / memories: https://docs.devin.ai/desktop/devin-local/customizations
- MCP: https://docs.devin.ai/desktop/devin-local/customizations
- Skills: https://docs.devin.ai/desktop/devin-local/customizations
- Hooks: https://docs.devin.ai/desktop/devin-local/customizations

Prefer official vendor pages, the vendor's own repo, and machine-readable schemas over blog posts or third-party summaries.

## HarnessTap implementation

Integration tier: generic serializer (src/platforms/generic-agents.ts).

- `src/platforms/registry.ts` (entry `windsurf`: supported features and paths)
- `src/platforms/generic-agents.ts` (shared serializer for registry-only harnesses)
- `test/platforms/generic-agents.test.ts`
- `test/platforms/registry.test.ts`
- `docs/supported-harnesses.md` (user-facing mirror of the registry)

The list above can go stale. Refresh it before comparing:

```sh
rg -l '"windsurf"' src test
```

## Procedure

1. Read `.agents/skills/harness-docs-sync/state.json`. Take `harnesses["windsurf"]` (`lastReviewed`, `lastSeenVersion`). When present, only review changelog or release entries newer than that date or version, plus any doc page that changed since. When absent, do a full baseline review.
2. Follow the shared steps in `.agents/skills/harness-docs-sync/procedure.md`: collect upstream facts, read the HarnessTap files above, and classify each feature area.
3. Write the report in the format from `.agents/skills/harness-docs-sync/report-format.md` to the report directory given there. Never write reports inside tracked repo paths.
4. Update `harnesses["windsurf"]` in the state file with today's date, the newest upstream version or release you reviewed (or `null` if the harness publishes none), and any replaced source URLs. Skip this step when the orchestrator runs you; it updates the state file once at the end.
