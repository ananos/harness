# Principles

These are the rules the agent works under. Each one says what enforces it.
A rule that only lives in prose is marked so -- it is a candidate for code.

The direction follows OpenAI's [harness engineering][he] post: give the agent
a map, enforce invariants mechanically, and put remediation in the error
message. The one deliberate difference is the merge button. In that post,
agents merge their own PRs. Here, a person approves every action that leaves
the machine.

[he]: https://openai.com/index/harness-engineering/

## Outward actions need a person

| Rule | Enforced by |
| :- | :- |
| `git push` needs an ack | `hooks/guard.py` (ask, or deny in bypass mode) |
| PR/issue comments, reviews, edits, releases, `gh api` writes need an ack | `hooks/guard.py` |
| `gh pr merge` needs an ack | `hooks/guard.py` |
| PRs open as drafts | `hooks/guard.py` hard deny without `--draft` |
| rebase & merge only | `hooks/guard.py` hard deny on `--merge` / `--squash` |
| no plain force-push | `hooks/guard.py` hard deny; `--force-with-lease` is fine |
| agents cannot grant acks | `hooks/guard.py` denies `harness-ack` and writes to the store |

An ack comes from a prompt that starts with `+push`, `+post`, `+merge` or
`+all`, optionally with a count (`+post 3`). It is valid for this session
only, for 30 minutes, and each action consumes one. The other route is
`! ~/.local/bin/harness-ack <class>` from the prompt.

## Commits

| Rule | Enforced by |
| :- | :- |
| `type(scope): Description`, capitalized, at most 50 chars | `hooks/checks/commit-msg` |
| no em dashes, arrows, trailing period or `(#NN)` in the subject | `hooks/checks/commit-msg` |
| `Signed-off-by` from `git config user.*`, last trailer | `hooks/checks/commit-msg` (error if missing, warning if mismatched) |
| no bot/AI `Co-authored-by`; a person co-author is fine | `hooks/checks/commit-msg` |
| no `Claude-Session` line or "Generated with" footer | `hooks/checks/commit-msg` and `attribution` in settings |
| no `--no-verify` | `hooks/guard.py` hard deny |
| `Fixes: #N` / `Refs: #N` above the sign-off when an issue exists | prose only |
| body is 3-4 lines or a few bullets, facts only | prose only |

Repos with another convention set it locally, for instance Kata:

```sh
git config harness.subjectStyle subsystem   # "runtime-rs: Fix x", 75 chars
git config harness.subjectStyle off         # trailers only
```

## Shell

| Rule | Enforced by |
| :- | :- |
| unquoted `$var` splits, `==` is literal, unmatched globs pass through | `hooks/zshenv-guard.zsh` |
| generated scripts: bash 3.2, `set -euo pipefail` | prose only |

## Knowledge

| Rule | Enforced by |
| :- | :- |
| `AGENTS.md` is a map of at most 120 lines, and every path it names exists | `bin/gate` (agents-map) |
| exec plans have Status, Progress and Decision log sections | `bin/gate` (exec-plans) |
| `MEMORY.md` stays under the 200-line / 25KB load limit | `lints/memory_freshness.py` |
| memory does not call a merged PR open | `lints/memory_freshness.py` (candidates) |
| repo-specific knowledge lives in the repo, not in global memory | prose only (phase 2) |

## Review

| Rule | Enforced by |
| :- | :- |
| a finding needs a file, a line and a failing scenario | `workflows/drive-pr.js` schema |
| every blocking finding is checked by a skeptic before it costs a fix round | `workflows/drive-pr.js` |
| false claims in messages, docs and comments are findings | `workflows/drive-pr.js` (claims lens) |
| provenance, token-scope and permission calls go to a person | `workflows/drive-pr.js` (`forPerson`) |
| review and act on people only, never bots | prose only (watchdogs) |
