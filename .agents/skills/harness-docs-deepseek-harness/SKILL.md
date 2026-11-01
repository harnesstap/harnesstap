---
name: harness-docs-deepseek-harness
description: Use when checking whether HarnessTap is in sync with the official DeepSeek Harness docs, changelog, or config schema, or when asked what DeepSeek Harness added or changed since the last review. Produces a gap report for the `deepseek-harness` harness; the harness-docs-sync skill runs it as part of a full sweep.
---

# harness-docs-deepseek-harness

Compare the official DeepSeek Harness documentation with what HarnessTap supports for the `deepseek-harness` harness and write a gap report. Read-only: do not change product code from this skill.

## Upstream sources

Start here. If a link is dead or moved, find the new official page, use it, and list the replacement under "Source changes" in the report so the next run can update this file.

- Repo: https://github.com/deepseek-ai/deepseek-harness
- Releases: https://github.com/deepseek-ai/deepseek-harness/releases
- Bluebook: Cordis, MCP and skills: https://dsh.hicyou.com/en/docs/developer/cordis-mcp-skills

Prefer official vendor pages, the vendor's own repo, and machine-readable schemas over blog posts or third-party summaries.

## HarnessTap implementation

Integration tier: dedicated serializer.

- `src/platforms/registry.ts` (entry `deepseek-harness`: supported features and paths)
- `src/services/platform-serializers.ts` (serializer dispatch)
- `src/platforms/deepseek-harness.ts`
- `src/platforms/deepseek-harness-home.ts`
- `src/plugins/providers/deepseek-harness.ts`
- `test/platforms/deepseek-harness.test.ts`
- `test/platforms/deepseek-harness-home.test.ts`
- `docs/supported-harnesses.md` (user-facing mirror of the registry)

The list above can go stale. Refresh it before comparing:

```sh
rg -l '"deepseek-harness"' src test
```

## Procedure

1. Read `.agents/skills/harness-docs-sync/state.json`. Take `harnesses["deepseek-harness"]` (`lastReviewed`, `lastSeenVersion`). When present, only review changelog or release entries newer than that date or version, plus any doc page that changed since. When absent, do a full baseline review.
2. Follow the shared steps in `.agents/skills/harness-docs-sync/procedure.md`: collect upstream facts, read the HarnessTap files above, and classify each feature area.
3. Write the report in the format from `.agents/skills/harness-docs-sync/report-format.md` to the report directory given there. Never write reports inside tracked repo paths.
4. Update `harnesses["deepseek-harness"]` in the state file with today's date, the newest upstream version or release you reviewed (or `null` if the harness publishes none), and any replaced source URLs. Skip this step when the orchestrator runs you; it updates the state file once at the end.
