Committed screenshot baselines for `scripts/ui-shots.mjs --compare`.

Refresh after intentional UI changes:

```bash
# Vite + demo agent already running
SHOTS_BASE_URL=http://127.0.0.1:5173/ bunx --cwd apps/desktop node scripts/ui-shots.mjs --update-baselines
```
