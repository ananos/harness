# harness

This repo is the Claude Code harness for ananos's own sessions. It holds the
hooks, the git commit-msg check, the `drive-pr` workflow, and the lints and
metrics that keep the setup honest. This file is the map. Detail lives in
`docs/`.

## Where things are

| Path | What it is |
| :- | :- |
| `hooks/guard.py` | PreToolUse + UserPromptSubmit guard for outward actions |
| `hooks/git/` | global `core.hooksPath`; every hook chains to the repo's own |
| `hooks/checks/commit-msg` | Conventional Commits, sign-off, no bot co-author |
| `hooks/zshenv-guard.zsh` | bash-like options for the Bash tool's zsh only |
| `bin/harness-ack` | grant acks by hand (`! ~/.local/bin/harness-ack push`) |
| `bin/install.py` | dry-run installer; `--apply`, `--uninstall` |
| `bin/gate` | the repo gate, JSON out; `make agent-gate` |
| `workflows/drive-pr.js` | scope, implement, gate, review, fix; stops before push |
| `lints/memory_freshness.py` | stale PR claims in auto-memory, index size |
| `metrics/baseline.py` | friction metrics from session transcripts |
| `tests/` | unit, negative and control-flow tests for all of the above |

## Read next

- `docs/principles.md` -- the rules, and which of them code enforces.
- `docs/architecture.md` -- how the pieces fit and where they install.
- `docs/baseline.md` -- the numbers we measure progress against.
- `docs/exec-plans/active/` -- the work in flight, with decision logs.

## Working here

- Run `make agent-gate` before you commit. It prints JSON with a
  remediation line per failing check.
- Every rule that blocks something needs a negative test in `tests/` that
  shows the blocked case being blocked.
- Scripts target macOS defaults: python3 3.9, bash 3.2, BSD sed.
- Commits follow `docs/principles.md`; the commit-msg hook checks them.
- Plans for multi-step work go in `docs/exec-plans/active/` from
  `docs/exec-plans/TEMPLATE.md`, and move to
  `docs/exec-plans/completed/` when done.
- Nothing here pushes, posts or merges on its own. The guard asks a person.
