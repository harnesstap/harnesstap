# GitHub login for private marketplace reads

Design spike. Not a shipping OAuth product. Ask before merge. Do not release or bump versions from this work.

Auto-detect of marketplace catalog type is out of scope (owned by another change). This note is only about how Desktop and CLI get a GitHub credential so private git content can be read.

## Problem

HarnessTap already clones and lists git remotes for marketplaces, plugin Pull, and APM git deps (`git clone`, `git ls-remote`). Spawns use `stdio: ignore` for stdin, so Git cannot prompt. There is no `GIT_ASKPASS`, extra header, or token in clone URLs.

Public HTTPS remotes work. Private GitHub remotes succeed only if ambient Git already has credentials (SSH agent, OS credential helper, or `gh` registered as a helper). Desktop and a stock `ht` install often have none of that: Tauri does not ship `gh`, GUI PATH is thin, and unsigned Desktop still needs a token path that does not depend on a developer shell.

HarnessTap Cloud login (`ht auth`, `cloud-accounts.json`, device flow) is a different identity (catalog publish/search). It must not be reused as a GitHub token.

Goal: a first-class GitHub session so users can read private plugin marketplaces and private `plugin add` / Pull sources without installing or depending only on `gh`.

## What we actually need from GitHub

Private marketplace UX is git-shaped today: register a URL, `ls-remote` branches, clone the catalog, clone plugin trees at tags. The GitHub REST Contents API is optional later (preview a `marketplace.json` without a clone). It is not required for v1 if git clone is authenticated.

Minimum permission: **read contents** of repositories the user can already access (their private marketplace, or an org marketplace they belong to). We do not need issues, PRs, Actions, or repo administration.

GitHub.com only for v1. GitHub Enterprise Server / Data Residency host knobs can wait.

## Options

### A. Reuse `gh` / `GH_TOKEN` / `GITHUB_TOKEN` (no product login)

- **CLI:** `gh auth token`, or env `GH_TOKEN` / `GITHUB_TOKEN` (GitHub CLI and Actions conventions).
- **Desktop:** same resolver inside `ht-agent` if those exist in the agent process environment.
- **Pros:** Zero GitHub App review. Matches CI. Power users already have this.
- **Cons:** Desktop users often have no `gh`. Env tokens in a GUI session are easy to miss. Scope is whatever the PAT/`gh` login already granted (often classic `repo`, which is write). No branded login. No refresh of our own.

This is a **resolver fallback**, not a product.

### B. Classic OAuth App (authorization code or device flow)

- Public `client_id`. Device flow matches Cloud login UX (`visit URL`, enter code). Loopback/PKCE is nicer on Desktop only.
- **Pros:** Familiar. GitHub documents device flow well. No backend required if the app is public.
- **Cons:** Classic scopes only. Private git clone requires `repo`, which is **read and write** on all private repositories the user can access. Far more power than marketplace reads. GitHub App review for `repo` is slower and a worse security story.

Reject as the primary login. Too much scope for the job.

### C. GitHub App, user-to-server (device or web flow)

- Permissions: Repository **Contents: Read**, **Metadata: Read**. Optional later: **Contents: Write** only if we add publish-to-GitHub.
- Enable device flow on the App so CLI and Desktop share one grant. Desktop can still open `verification_uri_complete` in the browser (same pattern as `CloudAccountDrawer`).
- Enable expiring user tokens and persist refresh tokens.
- **Pros:** Least privilege that still clones private git over HTTPS. Works for any repo the user can read, not only one org install. No HarnessTap Cloud dependency. Same session for CLI and `ht-agent`.
- **Cons:** Requires a GitHub App in the `harnesstap` org, device-flow flag, token storage, and GitHub’s App review for user-to-server. Refresh/expiry handling (Cloud already does this for catalog tokens). User must approve the App once.

### D. GitHub App installation (org install, installation tokens)

- Org installs the App on selected marketplace repos. HarnessTap (or Cloud) mints short-lived installation tokens.
- **Pros:** Best for a hosted “private org marketplace” product. Tokens never impersonate a human for all their repos. Fine-grained repo allow-list.
- **Cons:** Needs a backend that holds the App private key. Does not help a person cloning **their** private marketplace without an org install. Wrong first step for “GitHub login” in Desktop/CLI.

Keep as a later Cloud offering, not v1 login.

### E. Paste a fine-grained PAT

- CLI flag or Desktop field. Store like a login token.
- **Pros:** Ships without App review. User can restrict to one repo, Contents: Read.
- **Cons:** Long-lived secrets, easy to over-scope, poor Desktop UX. Fine as an escape hatch (`HARNESSTAP_GITHUB_TOKEN` or a `--token-stdin` later), not the default login.

### F. OS keychain vs `chmod 600` JSON

Cloud accounts live in `~/.harnesstap/cloud-accounts.json` mode `0600`. That is already a credential file on disk.

- **Keychain / Credential Manager / libsecret:** better for Desktop (OS prompt, not a world-readable home copy in backups as easily). Tauri has no keychain plugin in tree today. CLI on Linux headless often has no secret service.
- **Encrypted file under `HARNESSTAP_HOME`:** works everywhere; same as Cloud.
- **Split:** keychain when a secret service exists, file fallback otherwise. More code, two stores to migrate.

v1 recommendation: **file store next to Cloud accounts, mode `0600`, never put the token in git remotes on disk.** Plan a keychain backend as a follow-up, especially for Desktop. Do not block login on keychain.

Do not store tokens in the Tauri renderer or in marketplace URL fields.

## Desktop vs CLI

| | CLI | Desktop (`ht-agent` + Tauri) |
| --- | --- | --- |
| Login UX | `ht github login` device code in the terminal (mirror `ht auth login`) | Account panel sibling of Cloud: start/poll/cancel on agent HTTP, open browser via `plugin-shell` |
| Token use | `git` spawns in the CLI process | `git` spawns in the agent, not the webview |
| `gh` on PATH | Common for developers | Unreliable; do not require it |
| Ambient SSH | Common | Rare for HTTPS marketplace URLs |

Shared library in `src/services/` so both surfaces resolve the same credential. Agent routes analogous to `cloud-auth-handlers.ts`. Do not add a second GitHub client inside Rust.

Keep Cloud `ht auth` exclusively for HarnessTap Cloud. GitHub is a different command group and a different store file (for example `github-accounts.json`). Mixing tokens in `cloud-accounts.json` would confuse org-switch UX and revocation.

## How git should consume the token

Never rewrite stored marketplace URLs to `https://x-access-token:TOKEN@github.com/...` (leaks into config, logs, and `origin_ref`).

Preferred inject for a follow-up implementation:

1. Resolve a token.
2. For HTTPS `github.com` remotes, run git with `GIT_TERMINAL_PROMPT=0` and a short-lived `GIT_ASKPASS` helper (or `GIT_CONFIG_PARAMETERS` / `-c http.extraHeader=Authorization: Bearer …`). Extra-header on argv can leak via `ps`; ASKPASS is better.
3. Leave SSH remotes to the SSH agent. Do not convert SSH to HTTPS just because a token exists, unless clone failed and the URL is GitHub.
4. Existing `githubCloneUrl` already maps `org-id@github.com:owner/repo` SCP to `https://github.com/owner/repo.git`. That dropped GitHub App **installation** usernames on purpose (broken nested URL). User-to-server tokens should authenticate that HTTPS form, not restore the `org-id@` user.

If no token: keep today’s ambient Git behavior. Fail with a specific “private GitHub repo; run `ht github login` or set `HARNESSTAP_GITHUB_TOKEN`” when stderr looks like auth failure.

## Credential resolution order

First non-empty wins:

1. `HARNESSTAP_GITHUB_TOKEN` (explicit product override, CI, PAT escape hatch)
2. `GH_TOKEN`
3. `GITHUB_TOKEN` (Actions; last env because it is often installation-scoped and wrong for arbitrary marketplaces)
4. Stored HarnessTap GitHub session (after login)
5. `gh auth token` when `gh` runs successfully
6. None (ambient Git only)

A thin resolver stub in `src/services/github-credentials.ts` encodes this order. It does not call GitHub OAuth and is not wired into clone yet.

## Recommended path

**Ship later (implementation PR, not this one):**

1. GitHub App (user-to-server) with Contents: Read + Metadata: Read, device flow, expiring tokens.
2. `ht github login | status | logout` and Desktop account UI reusing the Cloud device-flow shape.
3. Shared resolver as above; inject into git HTTPS for marketplace branches, marketplace clone, plugin Pull, `plugin add` GitHub refs, and APM git deps on `github.com`.
4. Store refresh + access tokens in `~/.harnesstap/github-accounts.json` mode `0600` (v1). Keychain follow-up.
5. Keep `gh` / env as zero-login paths so Desktop-less CI does not need the App.

**Do not do in v1:** classic OAuth `repo` scope, GitHub App org-install as the only mode, keychain-only storage, Contents API as the marketplace catalog, merging GitHub identity into Cloud `auth`.

**Security notes:** least privilege via GitHub App permissions; never log tokens; revoke on logout (`DELETE /applications/{client_id}/grant` or GitHub App equivalent); treat Desktop agent token as already gating HTTP, and still keep GitHub tokens off the renderer.

## Implementation sketch (next PR)

- Register the GitHub App under the HarnessTap org; public Client ID in source; no private key in the CLI (user-to-server device flow does not need the App private key).
- `src/services/github-client.ts`: device code, poll, refresh (parallel to `cloud-client.ts`).
- Wire `resolveGithubCredential` into `runGit` helpers in `host-plugin-source.ts`, `marketplace-source-branches.ts`, `plugins/refresh.ts`, `apm-git-resolve.ts`.
- Agent: `GET/POST /v1/github/auth` start/poll/status/logout.
- Desktop: copy the Cloud drawer flow; label it GitHub, not Cloud.
- Docs: user-facing page under `docs/cli/` only when the commands exist. Update `SPEC.md` in that PR.

## Spike in this PR

`src/services/github-credentials.ts` plus tests for env / stored / `gh` precedence. No OAuth, no CLI command, no Desktop UI, no clone wiring.
