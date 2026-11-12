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
| `/review [pr\|branch]` | finders in parallel, a vote per finding, a risk tier; with `fix` a fix loop | a report in `~/.claude/harness/reports/`, posted only on `{post: true}` |
| `/review-sweep owner/repo` | `/review` per open PR by a person, new heads only | a state file and a digest beside the reports |
| `/paper <task>` | research plan, section drafts in parallel, four reviewer lenses, fixes | a plan while results are owed; then local commits and a report of what is left for the author |
| `/ship [branch]` | push, open a draft PR, watch CI, triage failures | a PR URL and CI verdict |
| `/triage owner/repo` | classify open issues from people | a report in `~/.claude/harness/reports/` |

`/build` never pushes. Running `/ship` is the ack to push and open the
draft PR. `/triage` posts nothing; with `{apply: true}` it adds existing
labels and nothing else. `/review` posts nothing unless `{post: true}`,
and then one review with event `COMMENT`: an agent never approves.

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
| review: scope, tier | `sonnet` | reads the PR, sets the risk tier from the change |
| review: second opinion | `opus` | a different model asks whether a person is needed anyway |
| review: finders (2, 4 or 6), security lane | `opus` | the bugs that matter |
| review: merge duplicates | `haiku` | list hygiene |
| review: voters (1, 3 or 5 per finding) | `sonnet` | distinct lenses; a finding needs a majority |
| review: fix | `sonnet`, then `opus` | a finding that survives a round escalates |
| review: report, post | `haiku` | file writes and one gh call |
| review-sweep: collect, record | `haiku` | gh list, a state file, a digest |
| paper: recon (3 readers) | `sonnet` | venue rules, the draft, the evidence |
| paper: topic analysis | `fable` | the problem, the state of the art, the gaps |
| paper: story, evaluation plan, their revision | `claude-mythos-5-1` | the thesis, the contributions and what proves them |
| paper: critique | `opus` | a third model reads all of it as a PC member |
| paper: work plan, section outline | `opus` | work packages, checkpoint, sequence; section tasks |
| paper: frame | `sonnet` | branch, section files, shared macros |
| paper: section, tier `argument` | `opus` | introduction, design, evaluation, discussion |
| paper: section, tier `prose` | `sonnet` | background, implementation, related work |
| paper: section, tier `chore` | `haiku` | bibliography, captions, tables |
| paper: integrate each wave | `sonnet` | cherry-picks and build fixes |
| paper: gate, write plan, report | `haiku` | runs the build, writes files |
| paper: story, evidence lenses | `opus` | breaks in the argument, numbers that differ from the data |
| paper: citations, style lenses | `sonnet` | cite keys, venue rules, one name per concept |
| paper: skeptic per finding | `sonnet` | tries to refute before a fix round |
| paper: fix | `sonnet`, then `opus` | a finding that survives a round escalates |
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

## How /paper works

`/paper` is `/build` for a paper or a deliverable kept as LaTeX or Markdown
in a git repo. Run it from that repo. For instance:

```text
/paper {"task": "draft the evaluation from results/*.csv and align the intro with it", "venue": "EuroSys 2027", "gate": "latexmk -pdf -halt-on-error main.tex", "stopAfterPlan": true}
```

The first half writes a research plan. The second half writes the paper,
and runs only when the plan's evidence is in the repo.

1. **Recon.** Three readers map the venue rules, the text as it stands, and
   the evidence: result files, plots, the bibliography, a build that works.
2. **Analysis.** Fable analyzes the topic: the problem, the state of the
   art with what each work lacks, the gaps, and the simpler alternative
   that could explain away a result in each gap.
3. **Story.** Mythos writes the thesis, the hypothesis the evaluation must
   test, the scope, what the paper must not claim, the fallback paper, the
   story from problem to takeaway, and at most four contributions
   (`maxContributions`). Each contribution names the prior work it goes
   past.
4. **Evaluation.** Mythos plans the proof: research questions with an
   endpoint and a control each, the configurations compared, and the
   benchmarks. Every contribution needs a micro benchmark and a macro
   benchmark, and the plan needs a baseline configuration. The script
   checks both. A benchmark carries a gate, the target that decides whether
   its claim stays, and a status: `have` with the path of the results, or
   `to-run`.
5. **Critique.** Opus reads the three as a program committee member. Major
   issues, and anything the script's checks found, get one revision.
6. **Plan.** Opus turns what is still owed into work packages with an owner
   role, effort, dependencies, steps and an acceptance condition. It adds
   a checkpoint with three outcomes (continue, narrow, defer), the
   sequence along the critical path, and the first assignment.
7. **Outline.** One task per section file, with its points, evidence and
   page budget, plus corrections to claims the existing text makes and the
   plan no longer supports. All of the above is written to
   `$(git rev-parse --git-common-dir)/harness/<slug>/plan.md`.

The run stops here with `evidence-owed` while a benchmark is `to-run`,
with `needs-human` on a blocking question or a contribution the plan
cannot prove, and with `planned` on `{stopAfterPlan: true}`.
`{draftWithoutResults: true}` goes on and leaves TODO markers.

8. **Frame.** One agent creates `harness/<slug>`, makes the root file
   include every section file, and adds macros for the shared terms.
9. **Draft.** Sections run in dependency waves, each in its own worktree.
   The abstract, introduction and conclusion depend on the sections they
   summarize, so they are written last. An integrator cherry-picks each
   wave and runs the build.
10. **Review.** Four lenses read the result: story, evidence, citations
    and style. A skeptic tries to refute each blocking finding. A fixer
    commits the confirmed ones and the loop repeats, up to `maxRounds` (3).
11. **Report.** `REPORT.md` beside the plan lists what is left: sections
    that did not land, missing evidence, unresolved findings, and findings
    only the author can decide.

Writers and fixers are told never to invent a number, a result or a
reference. Where the repo has no evidence they leave a TODO marker and
return it in `missing`. They also get the list of non-claims, and the story
lens reports any sentence that implies one. A fixer changes the claim to
match the data. A
finding that needs a new experiment or a reference lookup is marked for the
author and never reaches a fixer. The run ends `ready-for-author` only when
nothing is owed.

Section agents load the `ananos-academic` skill for prose when it is
installed. `{"voice": "<skill>"}` names another one and `{"voice": null}`
turns it off. `/paper` never pushes; `/ship` works on its branch as on any
other.

## How /review works

It follows the Claude Code team's own process ([How the Claude Code team
does code review][ccr]), scaled to one person's repos.

1. **Scope.** One reader pulls the PR's title, body, test plan and revert
   plan, the diff against the merge base, the root `CLAUDE.md`, and every
   `REVIEW.md` covering a touched path. Two classifiers run next: one sets
   the risk tier from the change alone (low, medium, high), the other asks
   whether a person must read it regardless. A touched CI workflow file or
   a path the repo marks sensitive forces `high`. Tier sets the human
   approvals the report asks for: 0, 1 or 2. An agent's finding never
   counts as an approval.
2. **Find.** `depth` picks the fleet: `quick` 2 finders and 1 voter,
   `standard` 4 and 3, `deep` 6 and 5. Each finder takes one angle
   (solves the stated problem, fits the system, breaks something else,
   tested for its failure modes, first incident, config and workflow
   lines) and must cite a file, a line and quoted evidence. A separate
   security lane runs alongside. Findings tagged style, diagnostics or
   cleanup are dropped in code. A cheap agent merges duplicates and drops
   anything in `posted` from an earlier round.
3. **Vote.** Each candidate goes to voters with distinct lenses (refute,
   reproduce, intent, blast radius, history). It survives only with a
   majority. Voters re-tag severity, so a defect that predates the PR
   comes out as `pre-existing` rather than the author's fault.
4. **Fix** (only with `{fix: true}`). A fixer commits the important
   findings as fixups on the branch and runs the gate; a finding that
   needs a design decision, a public interface or a sensitive path is left
   for a person with the reason. The new diff then goes back to Find and
   Vote with the earlier findings excluded, so nothing is reported twice.
   A finding that survives a round escalates the fixer from Sonnet to
   Opus. The loop ends when nothing important is left, when the fixer
   changes nothing, or at round 3, where the report asks the author to
   reconsider the approach instead of fixing one more line. Nothing is
   pushed.
5. **Report.** Open findings sorted Important, Nit, Pre-existing go into
   `~/.claude/harness/reports/review-<repo>-<pr>-round<n>.md`. The first
   line is a count, or says plainly there is nothing to fix, then what the
   agent fixed and what it left for a person. Rejected candidates are
   listed so a person can spot a wrong rejection. With `{post: true}`, an
   open PR, a person as author and something to say, one review with event
   `COMMENT` and one inline comment per finding is posted; nothing else.
   A bot's PR is never posted to.

Manual re-review after the author pushes: `/review {"target": 42,
"since": "<last reviewed sha>", "round": 2, "posted": [...]}`, where
`posted` is the `postedKeys` from the previous result. `/review-sweep`
does this bookkeeping for you.

## How /review-sweep works

The scheduled form. `/review-sweep owner/repo` lists the open PRs, keeps
those whose author is a person (`gh api users/<login>` type `User`; bots
and apps are skipped and named in the digest), reads
`~/.claude/harness/reports/review-state-<repo>.json`, and runs `/review`
on every PR whose head moved since the last sweep, passing `since`,
`round` and `posted` from the state. It then rewrites the state file and
a digest, `review-sweep-<repo>-<date>.md`, whose first line is a count.
`{post: true}` and `{fix: true}` pass through to each review; drafts are
always read-only; `{drafts: false}` skips them.

To run it on a schedule, `bin/review-watch owner/repo ['"post": true']`
runs `claude -p "/review-sweep ..."` headless with a per-repo lock and a
log in the reports directory. `templates/review-watch.plist` is a launchd
agent that calls it every 30 minutes; its comment has the three commands
to install and stop it. The second argument in the plist is the standing
ack: empty writes reports only, `"post": true` posts findings as you.
Approving and merging stay with a person, as before.

[ccr]: https://claude.dev/blog/solving-code-review-at-anthropic/

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
