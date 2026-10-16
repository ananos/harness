# Architecture

The harness has a workflow suite and three optional guardrails. Each part
installs into one place on the machine, and `bin/install.py` owns all of
them. Only the workflows install by default.

```
 prompt ──> UserPromptSubmit ──> guard.py ──> acks.json   (+push grants)
                                                  │
 Bash/Write/Edit ──> PreToolUse ──> guard.py ─────┘ consume, else ask/deny
                                       │
                                       └──> guard.log    (every decision)

 git commit ──> core.hooksPath=hooks/git/<name> ──> checks/<name>
                                                └─> <repo>/.git/hooks/<name>

 /build ──> Recon ─> Plan ─> Critique ─> Skeleton ─> [wave: task worktrees ─> integrate]*
                                                    ─> /verify ─> Land   (local only)
 /verify ──> [Gate + 4 lenses ─> skeptics ─> Fix (escalates)]*
 /ship ──> Preflight ─> push + draft PR ─> watch CI ─> triage failures
```

## Guard

`hooks/guard.py` runs on two events.

On **PreToolUse** it parses the Bash command into simple commands. It
follows `&&`, `;`, pipes, `$(...)`, backticks, `bash -c`, `eval`, env
prefixes and wrappers such as `sudo` and `env`. Each `git` and `gh` command
falls into one of three outcomes:

- **local** -- no output, the call proceeds.
- **outward** (push, post, merge) -- it consumes an ack for the session if
  one exists. Otherwise it returns `ask`, which is Claude Code's own
  permission prompt. In `bypassPermissions` mode it returns `deny`, because
  `ask` may not reach a person there.
- **hard deny** -- the call breaks a rule (non-draft PR, merge commit,
  plain force-push, `--no-verify`, touching the ack store). It fails with
  the remediation, ack or not.

A compound command needs an ack for every class it contains. If one is
missing, it consumes none.

On **UserPromptSubmit** it grants acks from `+push`-style tokens at the
start of the prompt. This event also fires for subagent reports, scheduled
tasks and messages from other sessions. The guard ignores prompts that
start with `<` or `/` or carry those markers on the first line. The
`! harness-ack` route does not depend on that check.

State lives in `~/.claude/harness/` (`acks.json` under `flock`,
`guard.log` as JSONL). `HARNESS_STATE_DIR` moves it for tests.

The guard is a guardrail against reflexes, not a sandbox. A command built
to hide from a parser (eg. a Python one-liner that shells out to `gh`)
gets through. The hook fails open: if `guard.py` crashes, the call
proceeds and the transcript shows a hook error.

## Git hooks

A global `core.hooksPath` replaces every repo's `.git/hooks`. To keep
those working, each name in `hooks/git/` is a symlink to `dispatch`. It
runs `hooks/checks/<name>` if one exists, then `exec`s the repo's own hook
from `git rev-parse --git-common-dir`. A repo that sets its own
`core.hooksPath` locally (husky, pre-commit) bypasses the harness.

## Workflows

The suite lives in `workflows/` and is described in `docs/workflows.md`.
Two mechanics matter for how the pieces fit:

- `/build` calls `/verify` with `workflow('verify', ...)`. Nesting is one
  level deep, so `/verify` must not call another workflow.
- Parallel task agents run with `isolation: 'worktree'`. Each one checks
  out the current tip by sha, commits on `harness/<slug>/<task>`, and the
  integrator cherry-picks those commits in the main checkout. Worktrees
  share the object database, so unpushed commits are visible across them.

The guard, when installed, sees workflow agents too: hooks from settings
run inside subagents. `/ship` then needs `+push` and `+post`, or the
permission prompt.

## Lints and metrics

`lints/memory_freshness.py` and `metrics/baseline.py` are read-only. They
are meant for `make sweep` / `make metrics`, by hand or from a scheduled
job that writes a report. They do not open PRs.
