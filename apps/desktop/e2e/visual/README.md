Committed screenshot baselines for `scripts/ui-shots.mjs --compare`.

Regenerate only inside the pinned Playwright image so fonts and Chromium match CI (G8). Host Chrome and host `--update-baselines` are rejected (`SHOTS_PINNED_IMAGE=1` required).

```bash
bash apps/desktop/scripts/update-visual-baselines.sh
```

Without Docker, dispatch `.github/workflows/desktop-e2e.yml` with `update_baselines=true` and copy the `desktop-visual-baselines` (or `desktop-visual-container-shots`) artifact into this directory.

Pin: `apps/desktop/scripts/visual-pin.env` (`mcr.microsoft.com/playwright:v1.63.0-noble`, Playwright 1.63.0). Baseline updates belong in PRs that change Desktop UI or this capture pipeline. CI uploads `diff-*.png` under `e2e/artifacts/` for review.
