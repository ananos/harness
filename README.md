# harness

This repo holds Claude Code workflows that automate my development loop. A
workflow runs as a slash command and drives several subagents, each on the
model its stage needs: Mythos and Fable to plan, Opus for skeletons and real
bugs, Sonnet for the routine work, Haiku for git, GitHub and CI chores.

It follows OpenAI's [harness engineering][he] post, with one difference: a
person still decides when something leaves the machine.

[he]: https://openai.com/index/harness-engineering/

## Workflows

| Command | What it does |
| :- | :- |
| `/build <task>` | plans, writes a skeleton with tests, implements tasks in parallel, verifies, and stops at local commits |
| `/verify [task]` | runs the gate and four review lenses on a branch, fixes until clean |
| `/review [pr\|branch]` | parallel bug finders and a security lane, a vote per finding, a risk tier; writes a report, posts only on `{post: true}` |
| `/ship [branch]` | pushes, opens a draft PR, watches CI, triages failures |
| `/triage owner/repo` | classifies open issues from people into a report |

For instance:

```text
/build add a --json flag to `brig ls`, with tests
/ship
/triage brig-sh/brig
```

`docs/workflows.md` has the model per stage, how `/build` works, and how to
write a new workflow (`make new-workflow NAME=x`).

## Install

```sh
make test              # the gate, JSON out
make install           # dry run: links the workflows into ~/.claude/workflows
make install-apply     # does it
```

Then run `/reload-skills` in a running session, or start a new one.

## Optional guardrails

These are separate from the workflows and off by default:

- **guard** -- `git push`, PR/issue posts and merges ask for an ack;
  draft-only PRs and rebase-only merges are hard rules.
- **git** -- a global commit-msg check: Conventional Commits, sign-off, no
  bot co-authors. Each repo's own hooks keep running.
- **zsh** -- bash-like word splitting and globbing in the Bash tool's shell.

```sh
python3 bin/install.py --with guard,git,zsh           # dry run
python3 bin/install.py --with guard,git,zsh --apply
make uninstall-apply                                  # removes everything
```

`docs/principles.md` lists every rule and what enforces it.
