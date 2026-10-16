#!/usr/bin/env python3
"""Measure session friction from Claude Code transcripts.

Reads ~/.claude/projects/*/*.jsonl (top-level sessions only, not
subagents). By default only interactive sessions count (entrypoint "cli");
`claude -p` automation such as the PR watchdogs ("sdk-cli") is excluded
unless --include-sdk. Reports, for sessions that started inside the window:

  go_ahead_per_1k     prompts that only say go/yes/continue, per 1,000
  dont_post_per_1k    prompts restating "don't push/post/merge", per 1,000
  refetch_per_1k      prompts asking to fetch/check again, per 1,000
  ack_tokens_per_1k   prompts that start with +push/+post/+merge/+all
  median_calls_to_edit  tool calls before the first Edit/Write, per session
  sleep_share         share of Bash calls that run `sleep`

The September 2026 baseline in docs/baseline.md was measured with other
regexes; compare runs of this script with each other, not with it.

  baseline.py [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json]
"""
import argparse
import glob
import json
import os
import re
import statistics
import sys
from datetime import datetime, timezone

GO = re.compile(r"(?i)^\s*(go( ahead)?|yes|yep|ok(ay)?|proceed|continue|"
                r"do it|carry on|sure|go on|keep going|ship it)[.!]*\s*$")
DONT_POST = re.compile(r"(?i)\b(don'?t|do not|never|without my ack)\b.{0,40}"
                       r"\b(push|post|publish|merge|comment|open (a )?pr)")
REFETCH = re.compile(r"(?i)\b(fetch|pull|check|look) (it |them )?again\b|"
                     r"\brefresh\b|\bre-?fetch\b")
ACK = re.compile(r"^\s*\+(push|post|merge|all)\b")
EDITS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


def parse_ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None


def prompt_text(msg):
    c = msg.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result"
               for b in c):
            return None
        return " ".join(b.get("text", "") for b in c
                        if isinstance(b, dict) and b.get("type") == "text")
    return None


def scan(path, since, until):
    prompts, calls, bash, sleeps = [], 0, 0, 0
    first_edit = None
    start = None
    entry = None
    with open(path, errors="replace") as f:
        for raw in f:
            try:
                e = json.loads(raw)
            except ValueError:
                continue
            ts = parse_ts(e.get("timestamp"))
            if start is None and ts:
                start = ts
            if entry is None and e.get("type") == "user":
                entry = e.get("entrypoint")
            if e.get("isSidechain") or e.get("isMeta"):
                continue
            msg = e.get("message") or {}
            if e.get("type") == "user" and msg.get("role") == "user":
                t = prompt_text(msg)
                if t and not t.lstrip().startswith("<"):
                    prompts.append(t)
            elif e.get("type") == "assistant":
                for b in msg.get("content") or []:
                    if not isinstance(b, dict) or b.get("type") != "tool_use":
                        continue
                    calls += 1
                    name = b.get("name")
                    if name in EDITS and first_edit is None:
                        first_edit = calls - 1
                    if name == "Bash":
                        bash += 1
                        cmd = (b.get("input") or {}).get("command", "")
                        if re.search(r"(^|[;&|\s])sleep\s+\d", cmd):
                            sleeps += 1
    if start is None or start < since or start >= until:
        return None
    return {"prompts": prompts, "first_edit": first_edit, "bash": bash,
            "sleeps": sleeps, "entry": entry}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2000-01-01")
    ap.add_argument("--until", default="2100-01-01")
    ap.add_argument("--root", default=os.path.expanduser("~/.claude/projects"))
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--include-sdk", action="store_true")
    a = ap.parse_args()
    since = datetime.fromisoformat(a.since).replace(tzinfo=timezone.utc)
    until = datetime.fromisoformat(a.until).replace(tzinfo=timezone.utc)

    sessions = [s for s in (scan(p, since, until) for p in
                            glob.glob(os.path.join(a.root, "*", "*.jsonl")))
                if s and (a.include_sdk or s["entry"] == "cli")]
    prompts = [p for s in sessions for p in s["prompts"]]
    n = len(prompts) or 1

    def per_1k(rx):
        return round(1000.0 * sum(1 for p in prompts if rx.search(p)) / n, 1)

    to_edit = [s["first_edit"] for s in sessions if s["first_edit"] is not None]
    bash = sum(s["bash"] for s in sessions) or 1
    out = {
        "window": [a.since, a.until],
        "entrypoints": "all" if a.include_sdk else "cli",
        "sessions": len(sessions),
        "prompts": len(prompts),
        "go_ahead_per_1k": per_1k(GO),
        "dont_post_per_1k": per_1k(DONT_POST),
        "refetch_per_1k": per_1k(REFETCH),
        "ack_tokens_per_1k": per_1k(ACK),
        "median_calls_to_edit": statistics.median(to_edit) if to_edit else None,
        "sleep_share": round(sum(s["sleeps"] for s in sessions) / float(bash), 3),
    }
    if a.json:
        print(json.dumps(out, indent=1))
    else:
        for k, v in out.items():
            print("%-22s %s" % (k, v))
    return 0


if __name__ == "__main__":
    sys.exit(main())
