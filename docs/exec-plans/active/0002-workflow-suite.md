# 0002: Workflow suite

We want to kick off a multi-agent run from one prompt and get a concrete,
tested implementation back. Each stage should run on the model it needs.
Done means `/build`, `/verify`, `/ship` and `/triage` run on real repos and
replace the hand-driven loop.

## Status

active -- written and tested with stub agents; no real run yet.

## Scope

- In: the four workflows, model routing, the new-workflow scaffold, tests.
- Out: scheduled runs (cron/launchd), workflows that post to GitHub
  without a person starting them.

## Progress

- [x] `/verify`: gate, four lenses, skeptics, fix with escalation
  (`tests/workflows/test_verify.mjs`, 5 cases)
- [x] `/build`: recon, plan + critique, skeleton, worktree waves,
  integration, verify, land (`tests/workflows/test_build.mjs`, 10 cases)
- [x] `/ship` and `/triage` (`tests/workflows/test_ship_triage.mjs`, 8 cases)
- [x] `make new-workflow NAME=x` from `templates/workflow.js`
- [x] symlinked files in `~/.claude/workflows` load and receive `args`
  (checked 2026-10-16 with a zero-agent workflow)
- [x] `/paper`: recon, analysis, story, evaluation plan, critique, work
  plan, outline; then frame, worktree waves, four reviewer lenses,
  skeptics, fix with escalation, report
  (`tests/workflows/test_paper.mjs`, 11 cases)
- [ ] `make install-apply`, `/reload-skills`
- [ ] `/build {"task": "...", "stopAfterPlan": true}` on a small brig
  change; read the plan
- [ ] the same task end to end; check worktree isolation starts from the
  given sha and the integrator's cherry-picks
- [ ] `/verify` on an existing branch (eg. an open hvi-vmm PR checkout)
- [ ] `/ship` on a throwaway branch in `ananos/harness`
- [ ] `/triage brig-sh/brig`
- [ ] `/paper {"task": "...", "stopAfterPlan": true}` on a paper repo;
  read the plan
- [ ] record cost per run (tokens per stage, from `/workflows`) here

## Decision log

- 2026-10-16: Mythos plans, Fable critiques. Two different models on the
  plan catch more than one model iterating on its own output.
- 2026-10-16: `claude-mythos-5-1` by full id; the aliases cover the other
  four. An unavailable model falls back to the session model with a warning.
- 2026-10-16: The skeleton writes interfaces and tests first, so parallel
  tasks build against a fixed shape and conflicts stay small.
- 2026-10-16: Tasks in a wave own disjoint files, enforced by the planner
  prompt and checked by the critic.
- 2026-10-16: Parallel tasks use worktree isolation and an integrator,
  rather than sharing one tree; shared trees race on the index and tests.
- 2026-10-16: `/build` stops at local commits. `/ship` is a separate
  command, so starting it is the explicit ack to push.
- 2026-10-16: The plan file goes under the git common dir, not the
  tracked tree, so it does not leak into commits unless asked.
- 2026-11-12: `/paper` has its own review loop and does not call
  `/verify`. The lenses differ (claims against data, citations, venue
  rules) and a missing result goes to the author, not to a fixer.
- 2026-11-12: `/paper` has no skeleton with tests. The frame step only
  creates the section files, and the build is the gate.
- 2026-11-12: `/paper` plans in four steps: Fable analyzes the topic,
  Mythos writes the story and the evaluation plan, Opus critiques. Three
  models, so no model checks its own output.
- 2026-11-12: The script checks what a prompt cannot guarantee: at most
  four contributions, a micro and a macro benchmark per contribution, and
  a baseline configuration. A failed check forces the revision.
- 2026-11-12: `/paper` stops at the plan while a benchmark has no results.
  The plan then carries work packages, a continue/narrow/defer checkpoint
  and a first assignment. The text is written around the results that
  exist; `draftWithoutResults` overrides this.
