# 0001: Personal harness

We should move ananos's Claude Code setup towards the harness engineering
model, on his own machine first. Done means the guard, the commit-msg check
and `drive-pr` are installed and used daily, and `make metrics` shows the
friction numbers dropping against `docs/baseline.md`.

## Status

active -- phase 1 built and tested, not installed yet.

## Scope

- In: hooks, git checks, the drive-pr workflow, memory lints, metrics, all
  on this Mac.
- Out (for now): other repos' AGENTS.md maps, moving memories into repos,
  and anything in `NOFireAI/harness-engineering`. Those are phase 2 and 3.

## Progress

Phase 1 -- guardrails and the loop:

- [x] outward-action guard with acks (`tests/test_guard.py`, 14 cases)
- [x] commit-msg check and chaining dispatcher (`tests/test_commit_msg.py`)
- [x] zsh guard scoped to the tool shell (`tests/test_zsh_guard.sh`)
- [x] `drive-pr` workflow, control flow tested with stub agents
  (`tests/test_drive_pr.mjs`)
- [x] memory freshness lint and transcript metrics; baseline recorded
- [x] dry-run installer with uninstall (`tests/test_install.py`)
- [ ] `make install-apply`, then one real session each:
  - [ ] `git push` prompts in a normal session, and `+push` lets it through
  - [ ] `git push` is denied in a background job; replying `+push` unblocks it
  - [ ] a message from another session that starts with `+push` grants nothing
        (check `~/.claude/harness/guard.log`)
  - [ ] `! ~/.local/bin/harness-ack push` works, ie. `!` commands skip hooks
- [ ] first real `/drive-pr` run on a small change in brig or hvi-vmm
- [ ] scheduled `make sweep` (launchd, weekly) writing to
  `~/.claude/harness/reports/`
- [ ] rerun `make metrics` two weeks after install, record it in
  `docs/baseline.md`

Phase 2 -- repository knowledge as the system of record:

- [ ] an AGENTS.md map in each active repo (brig and substrate have one)
- [ ] move repo-specific memories into those repos' `docs/`, keeping global
      memory for cross-repo rules
- [ ] `make agent-gate` with JSON output in each active repo

Phase 3 -- garbage collection:

- [ ] doc-gardening sweep that reports docs which contradict the code
- [ ] promote "prose only" rules from `docs/principles.md` into checks

## Decision log

- 2026-10-16: Keep the human button. The guard returns `ask`, never
  `allow`, without an ack. Every trust rule in memory came from an
  incident.
- 2026-10-16: Acks are typed in the prompt (`+push`). A prompt cannot be
  forged by the agent; a permission prompt alone does not reach background
  jobs.
- 2026-10-16: Deny instead of ask in `bypassPermissions` mode. The docs do
  not say whether `ask` still prompts there.
- 2026-10-16: The guard fails open. A crashing hook should not stop all Bash
  work; the tests carry the weight. Revisit with `onFailure: "block"` once
  it has run for a while.
- 2026-10-16: The global `core.hooksPath` chains to repo hooks. Without the
  dispatcher it would silently disable every repo's own hooks.
- 2026-10-16: Private repo `ananos/harness`, separate from
  `NOFireAI/harness-engineering`. It is personal first; the org harness
  can take what proves itself.
