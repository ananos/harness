# Workflows

A workflow is a JavaScript file that Claude Code runs as `/<name>`. It
spawns subagents with `agent()`, fans out with `parallel()` and
`pipeline()`, and can call another saved workflow with `workflow()`. Each
agent can run on its own model. That is how we put the expensive models
where judgement matters and the cheap ones on chores.

The files live in `workflows/`. `make install-apply` links them into
`~/.claude/workflows/`; a running session picks them up after
`/reload-skills`.

## The suite

| Command | What it does | Ends with |
| :- | :- | :- |
| `/build <task>` | plan, skeleton, parallel tasks, `/verify`, land | local commits and a PR body |
| `/verify [task]` | gate and four review lenses, fixes until clean | a clean branch, or what is left |
| `/ship [branch]` | push, open a draft PR, watch CI, triage failures | a PR URL and CI verdict |
| `/triage owner/repo` | classify open issues from people | a report in `~/.claude/harness/reports/` |

`/build` never pushes. Running `/ship` is the ack to push and open the
draft PR. `/triage` posts nothing; with `{apply: true}` it adds existing
labels and nothing else.

## Model routing

| Stage | Default model | Why |
| :- | :- | :- |
| build: recon (3 readers) | `sonnet` | reading and summarizing |
| build: plan, plan revision | `claude-mythos-5-1` | the decisions everything else follows |
| build: plan critique | `fable` | a second, different model checks the plan |
| build: skeleton (interfaces, tests first) | `opus` | design-heavy, sets the shape |
| build: task, tier `complex` | `opus` | |
| build: task, tier `menial` | `sonnet` | mechanical work against fixed interfaces |
| build: task, tier `chore` | `haiku` | docs, config, renames |
| build: integrate each wave | `sonnet` | cherry-picks and conflict fixes |
| build: write plan, land | `haiku` | file writes, autosquash, cleanup |
| verify: gate | `haiku` | runs a command and reports |
| verify: correctness, acceptance lenses | `opus` | finds real bugs and untested criteria |
| verify: claims, conventions lenses | `sonnet` | checks text against code and rules |
| verify: skeptic per finding | `sonnet` | tries to refute before a fix round |
| verify: fix | `sonnet`, then `opus` | a failure that survives a round escalates |
| ship: all stages | `haiku` | git, gh and log reading |
| triage: collect, classify, apply | `haiku` | one small agent per issue |
| triage: report | `sonnet` | one readable summary |

Override any of them per run with `models`, for instance:

```text
/build {"task": "add vsock credit accounting", "models": {"plan": "opus", "menial": "haiku"}}
```

A model your account cannot use falls back to the session model, and
Claude Code shows a warning naming both.

## How /build works

1. **Recon.** Three readers map the layout and rules, the code the task
   touches, and how to build and test.
2. **Plan.** The planner writes interfaces, tasks (each with files,
   acceptance criteria and tests), a test plan and one gate command. Tasks
   in the same wave must own disjoint files. The critic checks the plan
   against the repo; major issues get one revision. The plan is written to
   `$(git rev-parse --git-common-dir)/harness/<slug>/plan.md`. Blocking
   questions stop the run here, as does `{stopAfterPlan: true}`.
3. **Skeleton.** One agent creates `harness/<slug>`, writes the
   interfaces, stubs and tests, and commits.
4. **Build.** Tasks run in dependency waves. Each task agent works in its
   own git worktree from the current tip and commits there. After each
   wave, an integrator cherry-picks the commits onto the branch and runs
   the gate.
5. **Verify.** `/verify` runs with the plan's gate, criteria and test plan.
   Tasks that did not land are handed to it.
6. **Land.** Fixups are squashed, commit messages checked, task worktrees
   removed, and a PR body drafted from the repo template.

A run that stops can be resumed: `/workflows` shows the run, and Claude
can relaunch it with its run id, replaying the finished agents from cache.

## Writing a new workflow

```sh
make new-workflow NAME=release-notes
$EDITOR workflows/release-notes.js
make agent-gate
make install-apply      # then /reload-skills in a running session
```

The template (`templates/workflow.js`) has the shape every workflow here
follows:

- `args` accepts a string for the common case, or an object.
- One `M` object holds the model per stage, merged with `args.models`.
- Every agent that returns data has a `schema`, so the result is an object.
- `pipeline()` by default; `parallel()` only when a stage needs every result.
- A different model checks the work that matters.
- Writers are told to stay local. Pushing and posting belong to `/ship`.
- `Date.now()`, `Math.random()` and `new Date()` throw inside a workflow.
  Pass timestamps in through `args`, or let an agent run `date`.

Add a test in `tests/workflows/` with the stubs in `stub.mjs`. Assert the
control flow and the model each stage runs on, so a routing change shows
up in the gate.
