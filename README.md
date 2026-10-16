# harness

This is the Claude Code harness for my own sessions. It follows OpenAI's
[harness engineering][he] post, with one difference: a person still presses
the button for anything that leaves the machine.

[he]: https://openai.com/index/harness-engineering/

It has four parts:

- **guard** -- `git push`, PR/issue posts and merges ask for an ack. Rules
  such as draft-only PRs and rebase-only merges are hard denies with the fix
  in the message.
- **commit-msg** -- Conventional Commits, sign-off, and no bot co-authors,
  in every repo. Each repo's own hooks keep running.
- **drive-pr** -- a workflow that implements a change and loops gate and
  review until clean. It stops at local commits plus a PR body.
- **lints and metrics** -- stale memory, and friction numbers from the
  session transcripts.

`AGENTS.md` is the map. `docs/principles.md` lists every rule and what
enforces it.

## Install

```sh
make test            # the gate, JSON out
make install         # dry run: prints every change
make install-apply   # does it, with backups
make uninstall-apply
```

## Daily use

Start a prompt with an ack to let the next outward action through:

```text
+push looks good, push the branch
+post 3 post the three review comments
+all
```

Acks hold for 30 minutes, in that session only, one action each. From the
prompt, `! ~/.local/bin/harness-ack push` does the same.

Run the PR loop on a task:

```text
/drive-pr fix the vsock credit underflow in #256
```

Check memory and the numbers:

```sh
make sweep     # stale PR claims in memory, MEMORY.md size
make metrics   # last 30 days, interactive sessions
```
