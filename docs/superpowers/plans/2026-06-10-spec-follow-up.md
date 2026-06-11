# SPEC follow-up implementation plan

> **Status: shipped** in [harnessdeck#40](https://github.com/harnessdeck/harnessdeck/pull/40) (CLI) and [harnessdeck-cloud#34](https://github.com/harnessdeck/harnessdeck-cloud/pull/34) (cloud SPEC). Track 3.3 (keychain) remains deferred.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]` / `- [ ]`) syntax for tracking.

**Goal:** Close the gap between `SPEC.md` and the codebase after schema v15 layer unification, and ship the remaining Phase 4.3+ transport/apply behaviors called out in the layer model plan.

**Architecture:** Work in four tracks — (1) documentation truth sync, (2) deck.json transport modernization with backward-compatible import, (3) remote layer resolution on `project apply`, (4) secret ref dereferencing at apply time. Each track is independently mergeable; docs sync lands first.

**Tech Stack:** Bun, TypeScript, SQLite (schema v15), existing services in `src/services/`, tests in `test/`.

**Prerequisite context:** [2026-06-09-layer-model-spec-alignment.md](./2026-06-09-layer-model-spec-alignment.md) Phases 1–3 and 4.1–4.2 are done. This plan continues from Phase 4.3+.

---

## Track 0 — SPEC truth sync (docs only, ship first)

**Why:** Several SPEC sections still describe pre-v15 `plugins` / `configured_layers` split. The environment known gap is stale (commands shipped in #35).

### Task 0.1: Refresh Known gaps

**Files:**
- Modify: `SPEC.md` (lines 726–734)

- [x] **Step 1: Remove stale environment gap**

Delete:

```markdown
- `environment` commands are specified but not yet implemented in the CLI (environment schema and cascade exist today).
```

- [x] **Step 2: Fix deck.json gap reference**

Change `Phase 4.4` → `Phase 4.3+` in the deck.json transport bullet.

- [x] **Step 3: Add explicit open gaps from layer model plan**

Append after the deck.json bullet:

```markdown
- **`project apply` remote layers** — published selectors (`org/catalog/name@version`) are not resolved at apply time; use `layer add` first or pass a bundle path/URL.
- **Secret dereferencing at apply** — cascade merges `env_var` values but does not yet read `keychain`, `env`, or `file` secret refs into materialized env vars.
```

- [x] **Step 4: Commit**

```bash
git add SPEC.md
git commit -m "docs: refresh SPEC known gaps after v15 and environment CLI"
```

### Task 0.2: Update naming map and storage sections

**Files:**
- Modify: `SPEC.md` (lines 102–110, 485–489, 556–558, 630–632)

- [x] **Step 1: Fix naming map table**

Replace the Layer and Deck storage columns and remove the “Until SQLite unification” paragraph:

| Concept | Storage (SQLite v15) |
| --- | --- |
| **Layer** | `layers` + `layer_resources` |
| **Deck** | `decks`, `deck_layers` |

Add one sentence: compat shims (`configured-layer.ts`, `listDeckConfiguredLayers`) delegate to `layer-model.ts` / `deck_layers` and are deprecated.

- [x] **Step 2: Remove “Current SQLite (pre-unification)” block**

Delete lines 485–489. The target model list (lines 475–483) is now the actual schema.

- [x] **Step 3: Update Layer model implementation note**

Replace the paragraph at line 558 with:

> **Implementation (SQLite v15):** composition and apply identity share one `layers` row per capability. `layer_resources` holds ordered attachments. Published identity uses nullable `org_slug` / `catalog_slug` (empty strings for local layers).

- [x] **Step 4: Fix bundle import note**

Change “Import creates a local layer… (`plugins` row plus implicit `configured_layers` linkage)” to “Import creates a local `layers` row and associated `layer_resources`.”

- [x] **Step 5: Commit**

```bash
git add SPEC.md
git commit -m "docs: align SPEC storage sections with schema v15"
```

### Task 0.3: Mark layer model plan Phase 3–4.2 done

**Files:**
- Modify: `docs/superpowers/plans/2026-06-09-layer-model-spec-alignment.md`

- [x] **Step 1: Annotate completed phases**

Add `(done)` to Phase 3 header and 4.1 / 4.2 subsections. Link to this follow-up plan for 4.3+.

- [x] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-06-09-layer-model-spec-alignment.md
git commit -m "docs: mark layer model phases 3 and 4.1–4.2 complete"
```

---

## Track 1 — Deck.json selector-only transport (Phase 4.3a)

**Why:** `exportDeckToDeckJson` still emits `plugins: [{ name, version }]` per layer. Target shape is layer selector only (`name`, `version`, optional `org`/`catalog`, optional `environment`).

### Task 1.1: Evolve DeckJson types

**Files:**
- Modify: `src/types.ts` (DeckJsonLayer, DeckJsonEnvironmentSecretRef)
- Test: `test/services/exporter-deck.test.ts`

- [x] **Step 1: Write failing test for selector-only export**

In `test/services/exporter-deck.test.ts`, add:

```typescript
it("exports deck layers without plugins[] when selector-only mode is used", () => {
  // setup deck with one layer via layer-model helpers
  const deckJson = exportDeckToDeckJson(deckId, { selectorOnly: true });
  expect(deckJson.layers[0]).toMatchObject({
    name: "backend-oncall",
    version: "1.0.0",
  });
  expect(deckJson.layers[0]).not.toHaveProperty("plugins");
});
```

- [x] **Step 2: Run test — expect FAIL**

```bash
bun run test:run test/services/exporter-deck.test.ts
```

- [x] **Step 3: Update types**

In `src/types.ts`:

```typescript
export interface DeckJsonLayer {
  name: string;
  version: string;
  org?: string;
  catalog?: string;
  /** @deprecated Import only — use name/version/org/catalog */
  plugins?: DeckJsonLayerPluginRef[];
  environment?: string;
}
```

Add `selectorOnly?: boolean` to export options type used by `exportDeckToDeckJson`.

- [x] **Step 4: Implement export path**

In `src/services/exporter.ts` `exportDeckToDeckJson` and `parsedBundleToDeckJson`:

- When `selectorOnly: true` (default for new exports): emit `name`, `version`, and `org`/`catalog` when non-empty on the layer row; omit `plugins`.
- When `selectorOnly: false`: keep current `plugins[]` emission for backward compat.

- [x] **Step 5: Run tests — expect PASS**

```bash
bun run test:run test/services/exporter-deck.test.ts
bun run typecheck
```

- [x] **Step 6: Commit**

```bash
git add src/types.ts src/services/exporter.ts test/services/exporter-deck.test.ts
git commit -m "feat(deck): export selector-only deck.json layer entries"
```

### Task 1.2: Backward-compatible deck.json import

**Files:**
- Modify: `src/services/exporter.ts` (deck import parser)
- Test: `test/services/exporter-deck.test.ts`
- Fixture: `test/fixtures/decks/minimal-deck.json` (keep legacy shape for regression)

- [x] **Step 1: Write failing test — import legacy plugins[] deck**

```typescript
it("imports deck.json with legacy plugins[] arrays", async () => {
  const deckId = await importDeckJsonFromFile("test/fixtures/decks/minimal-deck.json");
  const layer = listDeckLayers(deckId)[0];
  expect(getLayerById(layer.layer_id)?.name).toBe("backend-oncall");
});
```

- [x] **Step 2: Write failing test — import selector-only deck**

New fixture `test/fixtures/decks/selector-only-deck.json` with layers lacking `plugins[]`.

- [x] **Step 3: Implement import branch**

In deck import: if `layer.plugins` present, resolve by `name@version` (current behavior). Else resolve by `name`, `version`, optional `org`/`catalog` via `resolveLayerSelector`.

- [x] **Step 4: Update deck doctor / materializer if they assume plugins[]**

Check `src/services/deck-materializer.ts`, `src/services/deck-doctor/` — adjust only if tests fail.

- [x] **Step 5: Run full suite**

```bash
bun run test:run
```

- [x] **Step 6: Commit**

```bash
git add src/services/exporter.ts test/services/exporter-deck.test.ts test/fixtures/decks/
git commit -m "feat(deck): import selector-only and legacy deck.json layer entries"
```

### Task 1.3: Flip default export + update SPEC example

**Files:**
- Modify: `src/services/exporter.ts` (default `selectorOnly: true`)
- Modify: `SPEC.md` (Deck v1 example ~lines 640–658)
- Modify: `test/fixtures/decks/minimal-deck.json` only if doctor tests require both shapes

- [x] **Step 1: Default new exports to selector-only**

- [x] **Step 2: Update SPEC deck.json example** — remove `plugins[]` from layer entry; show optional `org`/`catalog` on published deck layers.

- [x] **Step 3: Remove deck.json from Known gaps** once import + export + doctor pass.

- [x] **Step 4: Commit**

```bash
git add SPEC.md src/services/exporter.ts
git commit -m "docs: deck.json selector-only is default transport shape"
```

---

## Track 2 — `project apply` remote layer resolution (Phase 4.3b)

**Why:** Users must run `layer add` before `project apply org/catalog/foo`. SPEC promises published selectors; apply should fetch-on-miss when authenticated.

### Task 2.1: Resolve published selectors at apply time

**Files:**
- Modify: `src/services/layer-source.ts`
- Modify: `src/index.ts` (`project apply` layer resolution path)
- Modify: `src/services/layer-selector.ts` (reuse `resolveRemoteLayerSelector`)
- Test: `test/cli/project-apply.test.ts` or nearest integration test

- [x] **Step 1: Write failing test**

```typescript
it("project apply fetches published layer when not installed locally", async () => {
  // mock cloud fetch + import; assert apply proceeds without prior layer add
});
```

Use existing CLI test helpers in `test/helpers/cli.ts`.

- [x] **Step 2: Add `resolveApplyLayerSource(selector)` helper**

In `src/services/layer-source.ts`:

1. If local `resolveLayerSelector` succeeds → return local layer id.
2. If selector matches published grammar (`org/catalog/name` or `org/name`) → call existing `layer add` import path (no duplicate if version exists).
3. If bundle path/URL → existing behavior.

- [x] **Step 3: Wire into `project apply`**

Before `applyBundle` merge, map each positional selector through `resolveApplyLayerSource`.

- [x] **Step 4: Human-mode messaging**

Print one line: `Fetched org/catalog/name@version from catalog` when remote install occurs.

- [x] **Step 5: Run tests**

```bash
bun run test:run test/cli/
bun run typecheck
```

- [x] **Step 6: Update SPEC** — remove `project apply remote layers` known gap; document fetch-on-miss in Apply section.

- [x] **Step 7: Commit**

```bash
git add src/services/layer-source.ts src/index.ts test/
git commit -m "feat(apply): resolve published layer selectors from catalog on miss"
```

---

## Track 3 — Secret dereferencing at apply (Phase 4.3c)

**Why:** `mergeResolvedEnvironmentIntoResources` only overlays `fragment.vars`. Secret refs in cascade are counted but never read. SPEC claims partial `keychain`/`env` support; reality is storage-only.

### Task 3.1: Add secret resolver module

**Files:**
- Create: `src/services/secret-resolver.ts`
- Test: `test/services/secret-resolver.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
describe("resolveSecretRef", () => {
  it("reads env provider from process.env", () => {
    process.env.MY_TOKEN = "secret";
    expect(resolveSecretRef({ provider: "env", ref: "MY_TOKEN" })).toBe("secret");
  });

  it("reads file provider from path", () => {
    // temp file fixture
    expect(resolveSecretRef({ provider: "file", ref: path })).toBe("contents\n");
  });

  it("returns undefined for missing keychain (stub with clear error)", () => {
    expect(() => resolveSecretRef({ provider: "keychain", ref: "svc/token" }))
      .toThrow(/keychain/i);
  });
});
```

Start with `env` + `file`; keychain can delegate to macOS `security` CLI or remain explicit unsupported with a actionable error until a follow-up.

- [x] **Step 2: Implement `resolveSecretRefs(fragment)`**

```typescript
export function resolveSecretRefs(
  secretRefs: Record<string, { provider: string; ref: string }>,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, ref] of Object.entries(secretRefs)) {
    vars[key] = resolveSecretRef(ref);
  }
  return vars;
}
```

- [x] **Step 3: Run tests**

```bash
bun run test:run test/services/secret-resolver.test.ts
```

- [x] **Step 4: Commit**

```bash
git add src/services/secret-resolver.ts test/services/secret-resolver.test.ts
git commit -m "feat(secrets): add env and file secret ref resolver"
```

### Task 3.2: Merge resolved secrets into apply cascade

**Files:**
- Modify: `src/services/environment-cascade.ts`
- Modify: `src/services/applier.ts` (or call site in `index.ts`)
- Test: `test/services/environment-cascade.test.ts`

- [x] **Step 1: Write failing test**

After `resolveEnvironmentCascadeForApply`, secrets with `provider: env` become vars merged into resources.

- [x] **Step 2: In `resolveEnvironmentCascadeForApply` post-merge**, call `resolveSecretRefs` on `acc.secretRefs` and merge into `acc.vars` (secrets win over plain vars for same key).

- [x] **Step 3: Extend `DeckJsonSecretProvider`** to include `"file"` in `src/types.ts` if deck transport should carry file refs (path relative to deck root).

- [x] **Step 4: Run full suite**

```bash
bun run test:run
```

- [x] **Step 5: Update SPEC** — tighten secret gap to “keychain provider not yet implemented” only; remove file from incomplete list once done.

- [x] **Step 6: Commit**

```bash
git add src/services/environment-cascade.ts src/types.ts test/
git commit -m "feat(apply): dereference env and file secret refs into cascade vars"
```

### Task 3.3: Keychain provider (optional follow-up PR)

**Files:**
- Modify: `src/services/secret-resolver.ts`
- Test: platform-gated (`process.platform === "darwin"`)

Defer unless macOS keychain integration is required for a near-term deck. Document in SPEC as open gap if deferred.

---

## Track 4 — harnessdeck-cloud SPEC alignment (docs)

**Why:** Cloud SPEC still says “configured layers” / “design plugins” while CLI unified on `layers`.

### Task 4.1: Terminology pass on cloud SPEC

**Files:**
- Modify: `../harnessdeck-cloud/SPEC.md`
- Modify: `../harnessdeck-cloud/README.md` (if it repeats old terms)

- [x] **Step 1: Replace configured layer / design plugin** with **layer** in Shared concepts table.

- [x] **Step 2: Update cascade line** — “layer default environment” not “configured-layer default”.

- [x] **Step 3: Commit in harnessdeck-cloud repo**

```bash
cd ../harnessdeck-cloud
git add SPEC.md README.md
git commit -m "docs: align cloud SPEC terminology with unified layer model"
```

---

## Explicitly deferred (keep as known gaps / non-goals)

Do **not** schedule in this plan unless product priority changes:

| Item | Rationale |
| --- | --- |
| Native serializers for all 31 harnesses | Large surface; generic path works |
| Interactive conflict resolution on `project apply` | `applier.ts` has hooks; UX not specced |
| Full deck-repo round-trip via bundle export | Deck.json + Cloud catalogs are the path |
| Plugin marketplace / `claude plugin install` wrapper | Documented non-goal |
| Remove `org/library` wire compat | Keep until Cloud API exposes catalog-native routes everywhere |

---

## Verification checklist (before closing the epic)

```bash
cd harnessdeck
bun run lint
bun run typecheck
bun run test:run
```

Manual smoke:

```bash
hd layer list
hd environment list
hd project apply <local-layer> --dry-run
# After Track 2:
hd project apply harnessdeck-cloud/default/<layer> --dry-run
# After Track 1:
cat .harnessdeck/deck.json  # no plugins[] on new exports
```

---

## Suggested PR breakdown

| PR | Tracks | Risk |
| --- | --- | --- |
| 1 | Track 0 (docs only) | Low — merge immediately |
| 2 | Track 1 (deck.json) | Medium — transport compat |
| 3 | Track 2 (apply remote) | Medium — network + auth |
| 4 | Track 3.1–3.2 (secrets env/file) | Medium — security review |
| 5 | Track 3.3 (keychain) + Track 4 | Low–medium |

Track 0 is independent and should land first so SPEC matches reality before feature PRs reference it.
