---
name: harness-docs-copilot-cli
description: Use when checking whether HarnessTap is in sync with the official Copilot CLI docs, changelog, or config schema, or when asked what Copilot CLI added or changed since the last review. Produces a gap report for the `copilot-cli` harness; the harness-docs-sync skill runs it as part of a full sweep.
---

# harness-docs-copilot-cli

Compare the official Copilot CLI documentation with what HarnessTap supports for the `copilot-cli` harness and write a gap report. Read-only: do not change product code from this skill.

## Upstream sources

Start here. If a link is dead or moved, find the new official page, use it, and list the replacement under "Source changes" in the report so the next run can update this file.

- Docs: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli
- Changelog: https://github.com/github/copilot-cli/blob/main/changelog.md
- Releases: https://github.com/github/copilot-cli/releases
- Agent skills: https://docs.github.com/en/copilot/concepts/agents/about-agent-skills

Prefer official vendor pages, the vendor's own repo, and machine-readable schemas over blog posts or third-party summaries.

## HarnessTap implementation

Integration tier: dedicated serializer.

- `src/platforms/registry.ts` (entry `copilot-cli`: supported features and paths)
- `src/services/platform-serializers.ts` (serializer dispatch)
- `src/platforms/copilot.ts`
- `src/plugins/providers/copilot-cli.ts`
- `src/plugins/copilot-installed.ts`
- `test/platforms/copilot.test.ts`
- `docs/supported-harnesses.md` (user-facing mirror of the registry)

The list above can go stale. Refresh it before comparing:

```sh
rg -l '"copilot-cli"' src test
```

## Procedure

1. Read `.agents/skills/harness-docs-sync/state.json`. Take `harnesses["copilot-cli"]` (`lastReviewed`, `lastSeenVersion`). When present, only review changelog or release entries newer than that date or version, plus any doc page that changed since. When absent, do a full baseline review.
2. Follow the shared steps in `.agents/skills/harness-docs-sync/procedure.md`: collect upstream facts, read the HarnessTap files above, and classify each feature area.
3. Write the report in the format from `.agents/skills/harness-docs-sync/report-format.md` to the report directory given there. Never write reports inside tracked repo paths.
4. Update `harnesses["copilot-cli"]` in the state file with today's date, the newest upstream version or release you reviewed (or `null` if the harness publishes none), and any replaced source URLs. Skip this step when the orchestrator runs you; it updates the state file once at the end.
