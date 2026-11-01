---
name: harness-docs-sync
description: Use when asked to check HarnessTap against the official docs of the harnesses it supports (Claude Code, Cursor, Codex, and the rest), to find new harness features worth backfilling, or to run a periodic harness docs sweep. Runs every harness-docs-<id> skill or a chosen subset, merges the results into one gap report, highlights features shared across harnesses, and updates the review state.
---

# harness-docs-sync

Orchestrates the per-harness `harness-docs-<id>` skills. Read-only for product code: it produces a report and updates `state.json`, nothing else.

## Inputs

- Subset: harness ids to review. Default: every id in `src/platforms/registry.ts`.
- Mode: `incremental` (default, uses `state.json`) or `full` (ignores `lastReviewed`).

## Procedure

1. Enumerate harness ids from the registry, not from memory:

   ```sh
   rg -o '^\s*(def\("[a-z0-9-]+"|\["[a-z0-9-]+", "[A-Z])' src/platforms/registry.ts
   ```

   This should match the count in `docs/supported-harnesses.md`. For each id, check that `.agents/skills/harness-docs-<id>/SKILL.md` exists. A registry id without a skill is a finding: list it under "Coverage" in the report and suggest adding the skill (copy a sibling skill and fill in sources and files). A skill whose id left the registry is also a finding.
2. Read `state.json` in this directory.
3. For each selected id, follow its `harness-docs-<id>` skill (steps 1 to 3; skip its state update). Harnesses are independent, so run them in parallel when your tooling allows (for example one subagent per harness or per batch), each writing its section to the report directory.
4. Merge the sections into one report using `report-format.md`. Then build the cross-harness section: group findings that name the same capability across two or more harnesses (for example a new MCP field such as OAuth or `headers`, a hook event, skill frontmatter keys, a shared path such as `.agents/skills/` or `AGENTS.md`). For each group say which harnesses support it upstream, which HarnessTap already emits, and where a shared HarnessTap code path (for example `src/services/mcp-config-bridge.ts`, `src/services/hook-serialization.ts`, `src/services/agent-bridge.ts`) could cover all of them at once.
5. Sort backfill suggestions by priority, then by number of harnesses affected.
6. Update `state.json`: for each reviewed id set `lastReviewed` (YYYY-MM-DD), `lastSeenVersion` (newest upstream version or release reviewed, or `null`), and `sources` only when a URL was replaced. Set top-level `lastRun`. Keep the file small: no findings in it.
7. Print the report path and the P0/P1 items.

## Rules

- Every upstream feature claim cites the doc, changelog, or schema URL it came from. Every "covered" claim cites a HarnessTap file (and line or symbol when practical).
- Report facts you read this run. If a page could not be fetched, say so and do not guess.
- Do not implement backfill in the same run. Do not commit reports.
- Write ASCII punctuation only (no em dashes, en dashes, or Unicode ellipses), matching `scripts/check-copy.ts`.

## Files

- `procedure.md`: shared per-harness comparison steps.
- `report-format.md`: report location and structure.
- `state.json`: last review date and version per harness.
