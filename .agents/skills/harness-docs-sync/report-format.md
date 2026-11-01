# Gap report format

## Location

Write reports outside tracked files, to either:

- `.harness-docs-sync/reports/harness-docs-sync-YYYY-MM-DD.md` in the repo root (gitignored), or
- a path outside the repo when the caller gives one.

Never commit reports. Per-harness scratch sections can go in `.harness-docs-sync/reports/YYYY-MM-DD/<id>.md`.

## Structure

```markdown
# Harness docs sync report YYYY-MM-DD

Mode: incremental | full. Harnesses: <ids>. HarnessTap commit: <sha>.

## Summary
- Top P0/P1 items (one line each, with harness id)
- Top cross-harness items

## Cross-harness
| Capability | Upstream support (harness: URL) | HarnessTap today (file) | Suggested shared change | Priority |

## Coverage
Registry ids without a skill, skills without a registry id, dead or moved source URLs.

## <harness id> (<name>)
Reviewed range: <lastReviewed or baseline> to <newest version or date seen>.
Source changes: <replaced URLs, or none>.

### New or changed upstream
| Item | Area | Source URL | Status | HarnessTap file | Priority | Shareable |

### Deprecations
| Item | Source URL | HarnessTap impact (file) | Priority |

### Already covered
| Item | Area | HarnessTap file |

### Suggested backfill
- [P1] <change>, files to touch: <paths>. Source: <URL>.

### Unverified
- <URL>: <why it could not be read>
```

Keep each table row short. Link, do not quote, long upstream text.
