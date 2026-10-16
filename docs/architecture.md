# Architecture

The harness has four parts. Each part installs into one place on the
machine, and `bin/install.py` owns all of them.

```
 prompt ──> UserPromptSubmit ──> guard.py ──> acks.json   (+push grants)
                                                  │
 Bash/Write/Edit ──> PreToolUse ──> guard.py ─────┘ consume, else ask/deny
                                       │
                                       └──> guard.log    (every decision)

 git commit ──> core.hooksPath=hooks/git/<name> ──> checks/<name>
                                                └─> <repo>/.git/hooks/<name>

 /drive-pr ──> Scope ─> Implement ─> [Gate + 3 lenses ─> verify ─> Fix]* ─> Finalize
                                                           stops before push
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

## Workflow

`workflows/drive-pr.js` is a Claude Code saved workflow, installed as
`~/.claude/workflows/drive-pr.js` and invoked as `/drive-pr <task>`. It
loops gate and review up to `maxRounds` (default 3). Every agent that can
write is told to stay local, and the guard enforces that independently.
It returns `ready-for-ack` with the branch, the commits and a PR body
file, or `needs-human` with what is unresolved.

## Lints and metrics

`lints/memory_freshness.py` and `metrics/baseline.py` are read-only. They
are meant for `make sweep` / `make metrics`, by hand or from a scheduled
job that writes a report. They do not open PRs.
