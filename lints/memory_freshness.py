#!/usr/bin/env python3
"""Report stale claims in Claude Code auto-memory.

Checks:
  index    MEMORY.md against the 200-line / 25KB load limit
  prstate  memory text that calls a PR open/draft/unmerged when GitHub says
           merged or closed, or merged when it is still open. These are
           candidates: a line may be history ("was a draft") rather than
           a current claim, so a person or agent confirms before editing

Read-only: queries GitHub through `gh pr view`. Prints Markdown, or JSON
with --json. Exits 1 with --strict when anything is stale.

  memory_freshness.py [--dir DIR] [--json] [--strict] [--no-gh]
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

INDEX_LINES, INDEX_BYTES = 200, 25 * 1024
URL = re.compile(r"github\.com/([\w.-]+)/([\w.-]+)/pull/(\d+)")
SHORT = re.compile(r"(?<![\w/])([A-Za-z0-9][\w.-]*/[\w.-]+)#(\d+)\b")
SAYS_OPEN = re.compile(
    r"(?i)\b(open|draft|unmerged|not merged|awaiting|pending|waiting on|"
    r"in review|needs review|to merge)\b")
SAYS_MERGED = re.compile(r"(?i)\b(merged|landed)\b")


def refs_in(text):
    out = []
    for lineno, line in enumerate(text.splitlines(), 1):
        found = [(m.group(1), m.group(2), int(m.group(3)))
                 for m in URL.finditer(line)]
        found += [tuple(m.group(1).split("/", 1)) + (int(m.group(2)),)
                  for m in SHORT.finditer(line)]
        for owner, repo, n in found:
            out.append((owner, repo, n, lineno, line.strip()))
    return out


def pr_state(key):
    owner, repo, n = key
    p = subprocess.run(
        ["gh", "pr", "view", str(n), "-R", "%s/%s" % (owner, repo),
         "--json", "state,isDraft"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        universal_newlines=True)
    if p.returncode != 0:
        return key, None
    d = json.loads(p.stdout)
    return key, "DRAFT" if d["state"] == "OPEN" and d["isDraft"] else d["state"]


def verdict(line, state):
    """Return a reason when the line's claim contradicts the PR state."""
    # Judge only the clause around the ref: lines often list several PRs.
    says_open = bool(SAYS_OPEN.search(line))
    says_merged = bool(SAYS_MERGED.search(line))
    if state in ("MERGED", "CLOSED") and says_open and not says_merged:
        return "says open/pending, GitHub says %s" % state
    if state in ("OPEN", "DRAFT") and says_merged and not says_open:
        return "says merged, GitHub says %s" % state
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.expanduser(
        "~/.claude/projects/-Users-ananos/memory"))
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--no-gh", action="store_true")
    a = ap.parse_args()

    report = {"dir": a.dir, "index": {}, "stale": [], "unresolved": [],
              "files": 0, "refs": 0}
    idx = os.path.join(a.dir, "MEMORY.md")
    if os.path.exists(idx):
        data = open(idx, "rb").read()
        lines = data.count(b"\n")
        report["index"] = {
            "lines": lines, "bytes": len(data),
            "line_budget": INDEX_LINES, "byte_budget": INDEX_BYTES,
            "over": lines > INDEX_LINES or len(data) > INDEX_BYTES,
            "near": lines > INDEX_LINES * 0.8 or len(data) > INDEX_BYTES * 0.8,
        }

    hits = []
    for path in sorted(glob.glob(os.path.join(a.dir, "*.md"))):
        if os.path.basename(path) == "MEMORY.md":
            continue
        report["files"] += 1
        for owner, repo, n, lineno, line in refs_in(open(path).read()):
            hits.append((os.path.basename(path), (owner, repo, n), lineno,
                         line))
    report["refs"] = len(hits)

    states = {}
    if not a.no_gh and hits:
        keys = sorted({h[1] for h in hits})
        with ThreadPoolExecutor(8) as pool:
            states = dict(pool.map(pr_state, keys))
    merged_noted = {(h[0], h[1]) for h in hits if SAYS_MERGED.search(h[3])}
    for fname, key, lineno, line in hits:
        st = states.get(key)
        if st is None:
            if not a.no_gh:
                report["unresolved"].append("%s/%s#%d" % key)
            continue
        why = verdict(line, st)
        if why and st in ("MERGED", "CLOSED") and (fname, key) in merged_noted:
            why = None  # a later line in the same memory already says so
        if why:
            report["stale"].append({
                "file": fname, "line": lineno, "pr": "%s/%s#%d" % key,
                "state": st, "why": why, "text": line[:160]})
    report["unresolved"] = sorted(set(report["unresolved"]))

    if a.json:
        print(json.dumps(report, indent=1))
    else:
        i = report["index"]
        print("# Memory freshness\n")
        if i:
            flag = " **OVER LIMIT**" if i["over"] else (
                " (near limit)" if i["near"] else "")
            print("- MEMORY.md: %d/%d lines, %d/%d bytes%s" % (
                i["lines"], i["line_budget"], i["bytes"], i["byte_budget"],
                flag))
        print("- %d memory files, %d PR references, %d stale candidates, %d unresolved\n"
              % (report["files"], report["refs"], len(report["stale"]),
                 len(report["unresolved"])))
        for s in report["stale"]:
            print("- `%s:%d` %s: %s\n  > %s" % (
                s["file"], s["line"], s["pr"], s["why"], s["text"]))
    bad = report["stale"] or (report["index"] or {}).get("over")
    return 1 if (a.strict and bad) else 0


if __name__ == "__main__":
    sys.exit(main())
