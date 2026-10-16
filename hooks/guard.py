#!/usr/bin/env python3
"""Outward-action guard for Claude Code.

One script, two hook events:

  PreToolUse (Bash|Write|Edit|MultiEdit|NotebookEdit)
      Classifies a Bash command. Anything that leaves the machine (push,
      post, merge) needs an ack for this session; without one the guard
      returns "ask" (a native permission prompt), or "deny" in
      bypassPermissions mode where "ask" may not reach a person. A few
      rules are hard denies with a remediation message. Writes to the ack
      store are always denied.

  UserPromptSubmit
      A prompt that starts with +push, +post, +merge or +all (optionally
      followed by a count) grants that many acks to the session for
      HARNESS_ACK_TTL seconds. Prompts that look machine-generated are
      ignored.

This is a guardrail against reflexes, not a sandbox: an agent that sets out
to hide a command from it can.
"""
import fcntl
import json
import os
import re
import shlex
import sys
import time

STATE_DIR = os.path.expanduser(
    os.environ.get("HARNESS_STATE_DIR", "~/.claude/harness"))
ACKS = os.path.join(STATE_DIR, "acks.json")
LOG = os.path.join(STATE_DIR, "guard.log")
ACK_TTL = int(os.environ.get("HARNESS_ACK_TTL", "1800"))
CLASSES = ("push", "post", "merge")
GLOBAL = "*"  # acks granted outside a session, usable by any session

PUNCT = ";&|(){}!"
WRAPPERS = {"sudo", "env", "command", "exec", "time", "nohup", "nice",
            "caffeinate", "builtin", "noglob"}
SHELLS = {"bash", "sh", "zsh", "dash"}
GIT_OPTS_WITH_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace",
                     "--exec-path", "--config-env"}

GH_POST = {
    "pr": {"create", "comment", "review", "edit", "close", "reopen", "ready",
           "lock", "unlock", "update-branch"},
    "issue": {"create", "comment", "edit", "close", "reopen", "delete",
              "transfer", "lock", "unlock", "pin", "unpin", "develop"},
    "release": {"create", "edit", "upload", "delete", "delete-asset"},
    "repo": {"create", "edit", "delete", "rename", "archive", "unarchive",
             "fork", "sync"},
    "gist": {"create", "edit", "delete", "rename"},
    "workflow": {"run", "enable", "disable"},
    "run": {"rerun", "cancel", "delete"},
    "label": {"create", "edit", "delete", "clone"},
    "secret": {"set", "delete"},
    "variable": {"set", "delete"},
    "cache": {"delete"},
    "project": {"create", "edit", "delete", "close", "copy", "field-create",
                "field-delete", "item-add", "item-archive", "item-create",
                "item-delete", "item-edit", "link", "unlink",
                "mark-template"},
}

REMEDY = (
    "To approve, reply with `+{cls}` at the start of your next message "
    "(`+{cls} 3` for three), or run `! ~/.local/bin/harness-ack {cls}`. "
    "Agents: do not retry or work around this; stop and report "
    "`needs input: +{cls} for <what>`."
)


class Finding(object):
    def __init__(self, kind, cls, what, why=""):
        self.kind = kind  # "deny" or "outward"
        self.cls = cls
        self.what = what
        self.why = why


# ---------------------------------------------------------------- parsing

def segments(command):
    """Split a shell command into argv lists, one per simple command."""
    out = []
    for line in re.split(r"\\?\n", command):
        try:
            lex = shlex.shlex(line, posix=True, punctuation_chars=PUNCT)
            lex.whitespace_split = True
            lex.commenters = "#"
            toks = list(lex)
        except ValueError:
            toks = line.split()
        cur = []
        for t in toks:
            if t and set(t) <= set(PUNCT):
                if cur:
                    out.append(cur)
                cur = []
            else:
                cur.append(t)
        if cur:
            out.append(cur)
    # Command substitutions are commands too.
    for a, b in re.findall(r"\$\(([^()]*)\)|`([^`]*)`", command):
        inner = a or b
        if inner.strip():
            out.extend(segments(inner))
    return out


def strip_prefix(argv):
    """Drop env assignments and wrapper commands in front of argv[0]."""
    i = 0
    while i < len(argv):
        a = argv[i]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", a):
            i += 1
        elif os.path.basename(a) in WRAPPERS:
            i += 1
            while i < len(argv) and argv[i].startswith("-"):
                i += 1
        else:
            break
    return argv[i:]


def flag(args, *names):
    for a in args:
        for n in names:
            if a == n or (n.startswith("--") and a.startswith(n + "=")):
                return True
            # bundled short flags such as -fu
            if (len(n) == 2 and n[0] == "-" and n[1] != "-"
                    and re.match(r"^-[A-Za-z]{2,}$", a) and n[1] in a[1:]):
                return True
    return False


def classify_git(args, raw):
    i = 0
    while i < len(args) and args[i].startswith("-"):
        i += 2 if args[i] in GIT_OPTS_WITH_ARG else 1
    if i >= len(args):
        return []
    sub, rest = args[i], args[i + 1:]
    if sub == "push":
        if flag(rest, "-n", "--dry-run"):
            return []
        lease = flag(rest, "--force-with-lease", "--force-if-includes")
        plus = any(a.startswith("+") for a in rest)
        if (flag(rest, "-f", "--force") or plus) and not lease:
            return [Finding("deny", "push", raw,
                            "plain force-push; use --force-with-lease")]
        return [Finding("outward", "push", raw)]
    if sub == "send-email":
        return [Finding("outward", "post", raw)]
    if sub == "commit" and flag(rest, "-n", "--no-verify"):
        return [Finding("deny", "push", raw,
                        "--no-verify skips the commit-msg convention check; "
                        "fix the message instead")]
    return []


def gh_api_method(rest):
    method = None
    body = False
    mutation = False
    for i, a in enumerate(rest):
        nxt = rest[i + 1] if i + 1 < len(rest) else ""
        if a in ("-X", "--method"):
            method = nxt.upper()
        elif a.startswith("--method="):
            method = a.split("=", 1)[1].upper()
        elif a.startswith("-X") and len(a) > 2:
            method = a[2:].upper()
        elif a in ("-f", "-F", "--field", "--raw-field", "--input"):
            body = True
            mutation = mutation or bool(re.search(r"\bmutation\b", nxt))
        elif re.match(r"^(--field|--raw-field|--input)=", a):
            body = True
            mutation = mutation or bool(re.search(r"\bmutation\b", a))
    endpoint = next((a for a in rest if not a.startswith("-")), "")
    if endpoint == "graphql":
        return "POST" if mutation else "GET"
    if method:
        return method
    return "POST" if body else "GET"


def classify_gh(args, raw):
    i = 0
    while i < len(args) and args[i].startswith("-"):
        i += 2 if args[i] in ("-R", "--repo", "--hostname") else 1
    if i >= len(args):
        return []
    group, rest = args[i], args[i + 1:]
    verb = rest[0] if rest else ""
    if group == "api":
        if gh_api_method(rest) != "GET":
            return [Finding("outward", "post", raw)]
        return []
    if group == "pr" and verb == "merge":
        if flag(rest, "--merge", "-m", "--squash", "-s"):
            return [Finding("deny", "merge", raw,
                            "rebase & merge only; use `gh pr merge --rebase`")]
        return [Finding("outward", "merge", raw)]
    if group == "pr" and verb == "create" and not flag(rest, "--draft", "-d"):
        return [Finding("deny", "post", raw,
                        "open PRs as drafts; add --draft")]
    if group == "repo" and verb == "deploy-key" and len(rest) > 1 \
            and rest[1] in ("add", "delete"):
        return [Finding("outward", "post", raw)]
    if group == "ruleset" and verb not in ("list", "view", "check", ""):
        return [Finding("outward", "post", raw)]
    if verb in GH_POST.get(group, ()):
        return [Finding("outward", "post", raw)]
    return []


READONLY = {"cat", "less", "head", "tail", "jq", "ls", "grep", "rg", "wc",
            "stat", "file", "git", "shellcheck", "diff"}


def classify(command):
    findings = []
    if re.search(r">\s*\S*acks\.json", command):
        findings.append(Finding("deny", "ack", "> acks.json",
                                "only a person grants acks"))
    for argv in segments(command):
        argv = strip_prefix(argv)
        if not argv:
            continue
        prog = os.path.basename(argv[0])
        raw = " ".join(argv)
        if prog == "harness-ack" or (
                prog not in READONLY and any("acks.json" in a for a in argv)):
            findings.append(Finding("deny", "ack", raw,
                                    "only a person grants acks"))
        elif prog == "git":
            findings += classify_git(argv[1:], raw)
        elif prog == "gh":
            findings += classify_gh(argv[1:], raw)
        elif prog in SHELLS:
            for j, a in enumerate(argv):
                if a == "-c" and j + 1 < len(argv):
                    findings += classify(argv[j + 1])
        elif prog == "eval":
            findings += classify(" ".join(argv[1:]))
    return findings


# ---------------------------------------------------------------- ack store

def _load(f):
    f.seek(0)
    data = f.read()
    try:
        return json.loads(data) if data.strip() else {}
    except ValueError:
        return {}


def _save(f, store):
    now = time.time()
    for sid in list(store):
        for cls in list(store[sid]):
            g = store[sid][cls]
            if g.get("n", 0) <= 0 or g.get("exp", 0) < now:
                del store[sid][cls]
        if not store[sid]:
            del store[sid]
    f.seek(0)
    f.truncate()
    json.dump(store, f, indent=1, sort_keys=True)


def with_store(fn):
    os.makedirs(STATE_DIR, exist_ok=True)
    fd = os.open(ACKS, os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(fd, "r+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        store = _load(f)
        result = fn(store)
        _save(f, store)
        return result


def grant(session, cls, n, ttl=ACK_TTL):
    targets = CLASSES if cls == "all" else (cls,)

    def op(store):
        s = store.setdefault(session, {})
        for c in targets:
            g = s.get(c, {"n": 0})
            s[c] = {"n": g.get("n", 0) + n, "exp": time.time() + ttl}
        return targets
    return with_store(op)


def consume(session, classes):
    """Consume one ack per class, or none if any class lacks one."""
    now = time.time()

    def op(store):
        picks = []
        for c in classes:
            for sid in (session, GLOBAL):
                g = store.get(sid, {}).get(c)
                if g and g.get("n", 0) > 0 and g.get("exp", 0) >= now:
                    picks.append((sid, c))
                    break
            else:
                return False
        for sid, c in picks:
            store[sid][c]["n"] -= 1
        return True
    return with_store(op)


def log(entry):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        entry["ts"] = int(time.time())
        with open(LOG, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError:
        pass


# ---------------------------------------------------------------- handlers

def emit_pre(decision, reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": reason,
    }}))


def pre_tool_use(ev):
    tool = ev.get("tool_name", "")
    ti = ev.get("tool_input", {}) or {}
    session = ev.get("session_id", "")
    if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        p = ti.get("file_path", "") or ti.get("notebook_path", "")
        path = os.path.realpath(os.path.expanduser(p))
        if path.startswith(os.path.realpath(STATE_DIR) + os.sep):
            log({"ev": "deny", "tool": tool, "path": path, "sid": session})
            emit_pre("deny", "harness: the ack store is written only by a "
                     "person (`+push` in a prompt or `! harness-ack`).")
        return
    if tool != "Bash":
        return
    command = ti.get("command", "")
    findings = classify(command)
    if not findings:
        return
    denies = [f for f in findings if f.kind == "deny"]
    if denies:
        why = "; ".join("`%s`: %s" % (f.what, f.why) for f in denies)
        log({"ev": "deny", "cmd": command, "why": why, "sid": session})
        emit_pre("deny", "harness: blocked. " + why)
        return
    classes = sorted({f.cls for f in findings})
    if consume(session, classes):
        log({"ev": "allow", "cmd": command, "cls": classes, "sid": session})
        emit_pre("allow", "harness: ack consumed for " + ",".join(classes))
        return
    what = "; ".join(sorted({f.what for f in findings}))
    cls = classes[0] if len(classes) == 1 else "all"
    reason = ("harness: `%s` leaves this machine (%s). "
              % (what, ", ".join(classes)) + REMEDY.format(cls=cls))
    bypass = ev.get("permission_mode") == "bypassPermissions"
    decision = "deny" if bypass else "ask"
    log({"ev": decision, "cmd": command, "cls": classes, "sid": session})
    emit_pre(decision, reason)


ACK_RE = re.compile(r"^\+(push|post|merge|all)(?:[ :](\d{1,2}))?(?=\s|$)")


def machine_generated(prompt):
    head = prompt.lstrip()
    first = head.split("\n", 1)[0]
    return (head.startswith("<") or head.startswith("/")
            or "<task-notification" in prompt
            or re.search(r"(?i)message from @|reply address|"
                         r"system notification", first) is not None)


def user_prompt_submit(ev):
    prompt = ev.get("prompt", "") or ""
    session = ev.get("session_id", "")
    if not session or machine_generated(prompt):
        return
    rest = prompt.lstrip()
    granted = []
    while True:
        m = ACK_RE.match(rest)
        if not m:
            break
        n = int(m.group(2) or 1)
        for c in grant(session, m.group(1), n):
            granted.append("%s x%d" % (c, n))
        rest = rest[m.end():].lstrip()
    if granted:
        log({"ev": "grant", "via": "prompt", "acks": granted, "sid": session})
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": "harness: the user granted %s for %d min "
            "in this session." % (", ".join(granted), ACK_TTL // 60),
        }}))


def main():
    try:
        ev = json.load(sys.stdin)
    except ValueError:
        return 0
    name = ev.get("hook_event_name")
    if name == "PreToolUse":
        pre_tool_use(ev)
    elif name == "UserPromptSubmit":
        user_prompt_submit(ev)
    return 0


if __name__ == "__main__":
    sys.exit(main())
