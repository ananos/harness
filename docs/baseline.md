# Baseline

We measure progress against these numbers. Rerun with `make metrics`.

## 2026-09-17 .. 2026-10-16, before the harness

Measured on 2026-10-16 with `metrics/baseline.py`. Interactive sessions only
(`entrypoint: cli`), so the 599 watchdog runs (`claude -p`) are excluded.

| Metric | Value |
| :- | -: |
| sessions | 222 |
| prompts | 2,108 |
| go-ahead prompts per 1,000 | 41.7 |
| "don't push/post" restated per 1,000 | 32.3 |
| "fetch/check again" per 1,000 | 20.4 |
| median tool calls before the first edit | 28 |
| share of Bash calls that run `sleep` | 4.9% |

Memory, from `lints/memory_freshness.py` on the same day:

| Metric | Value |
| :- | -: |
| `MEMORY.md` | 71 / 200 lines, 19,267 / 25,600 bytes |
| memory files | 252 |
| PR references resolved | 96 of 123 |
| stale candidates (says open, GitHub says merged/closed) | 24 |

## 2026-09-27 numbers

The plan of 2026-09-27 reported 72.4 go-ahead turns and 17.5 "don't post"
per 1,000 prompts, a median of 40 tool calls before the first edit, and
`sleep` at 38% of Bash *time*. Those came from different regexes and,
presumably, included automation runs. They are not comparable with the
table above. From here on, compare runs of `metrics/baseline.py` only.

## What should move

- "don't push/post" restated should drop towards zero: the guard holds
  that rule now.
- go-ahead prompts should drop as `/build` and `/verify` loop without asking, and
  `+push` acks should appear in their place.
- stale candidates should drop once a sweep runs on a schedule.
