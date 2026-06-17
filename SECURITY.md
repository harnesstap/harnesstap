# Security policy

## Supported versions

HarnessDeck is in active development (`0.x`). Security fixes are applied to the latest release on the `main` branch.

| Version | Supported |
| --- | --- |
| Latest `0.x` release | Yes |
| Older `0.x` releases | Best effort |
| Pre-release / development builds | No |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately using one of these channels:

1. [GitHub private vulnerability reporting](https://github.com/harnessdeck/harnessdeck/security/advisories/new) (preferred)
2. Email the maintainers via the contact address listed on the [GitHub organization profile](https://github.com/harnessdeck)

Include as much detail as you can:

- Description of the issue and potential impact
- Steps to reproduce
- Affected versions or commits
- Proof-of-concept code or logs, if available

We aim to acknowledge reports within **3 business days** and will work with you on a fix and coordinated disclosure timeline.

## Scope

In scope:

- The `harnessdeck` CLI and published npm package
- Official GitHub Actions workflows in this repository
- Documented cloud authentication flows (device code, token refresh)

Out of scope:

- Third-party harness tools (Claude Code, Cursor, Codex, etc.)
- User-managed secrets stored in the OS keychain, environment variables, or local config under `~/.harnessdeck/`
- Misconfigurations in user projects or decks

## Safe disclosure

We appreciate responsible disclosure. We will credit reporters in release notes when they wish to be named.
