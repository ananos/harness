# harness

This repo holds ananos's Claude Code workflows, plus optional guardrails
(hooks and a git commit-msg check) and the lints and metrics that measure the
setup. This file is the map. Detail lives in `docs/`.

## Where things are

| Path | What it is |
| :- | :- |
| `workflows/build.js` | plan, skeleton, parallel tasks, verify, land; local only |
| `workflows/verify.js` | gate + four review lenses + fix loop on a branch |
| `workflows/review.js` | PR review: finders, vote per finding, risk tier, fix loop; posts on ack |
| `workflows/review-sweep.js` | `/review` over a repo's open PRs by people, with state |
| `bin/review-watch` | launchd entry point for `/review-sweep`; `templates/review-watch.plist` |
| `workflows/paper.js` | research plan, parallel section drafts, reviewer lenses on a paper in git; local only |
| `workflows/ship.js` | push, draft PR, watch CI, triage failures |
| `workflows/triage.js` | classify open issues from people; report |
| `templates/workflow.js` | the starting point for `make new-workflow NAME=x` |
| `tests/workflows/` | control-flow and model-routing tests, stubbed agents |
| `hooks/guard.py` | optional: ack-gated push/post/merge |
| `hooks/git/` | optional: global `core.hooksPath`, chains to repo hooks |
| `hooks/checks/commit-msg` | Conventional Commits, sign-off, no bot co-author |
| `hooks/zshenv-guard.zsh` | optional: bash-like options for the tool shell |
| `bin/install.py` | dry-run installer; `--with guard,git,zsh`, `--apply` |
| `bin/harness-ack` | grant acks by hand when the guard is on |
| `bin/gate` | the repo gate, JSON out; `make agent-gate` |
| `lints/memory_freshness.py` | stale PR claims in auto-memory, index size |
| `metrics/baseline.py` | friction metrics from session transcripts |

## Read next

- `docs/workflows.md` -- the suite, model routing, writing a workflow.
- `docs/principles.md` -- the rules, and which of them code enforces.
- `docs/architecture.md` -- how the pieces fit and where they install.
- `docs/baseline.md` -- the numbers we measure progress against.
- `docs/exec-plans/active/` -- the work in flight, with decision logs.

## Working here

- Run `make agent-gate` before you commit. It prints JSON with a
  remediation line per failing check.
- A new workflow gets a test in `tests/workflows/` that asserts its control
  flow and the model of every stage.
- Every rule that blocks something needs a negative test in `tests/`.
- Scripts target macOS defaults: python3 3.9, bash 3.2, BSD sed.
- Plans for multi-step work go in `docs/exec-plans/active/` from
  `docs/exec-plans/TEMPLATE.md`, and move to
  `docs/exec-plans/completed/` when done.
- Workflows stay local, except `/ship`, which a person runs on purpose.
