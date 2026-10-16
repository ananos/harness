#!/usr/bin/env python3
"""Install or remove the harness on this machine.

Dry run by default: prints every change it would make, with a diff for
~/.claude/settings.json. Pass --apply to make them. --uninstall reverses.

  install.py [--apply] [--uninstall] [--force-hooks-path]

Changes:
  1. ~/.claude/settings.json: guard hooks (PreToolUse, UserPromptSubmit)
     and attribution off; a timestamped backup is written first
  2. git config --global core.hooksPath -> hooks/git (chains to repo hooks)
  3. ~/.zshenv: source hooks/zshenv-guard.zsh between markers
  4. ~/.local/bin/harness-ack and ~/.claude/workflows/drive-pr.js symlinks
"""
import argparse
import difflib
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
HOME = os.path.expanduser("~")
SETTINGS = os.path.join(HOME, ".claude", "settings.json")
ZSHENV = os.path.join(HOME, ".zshenv")
GUARD_CMD = "python3 -I '%s'" % os.path.join(ROOT, "hooks", "guard.py")
MATCHER = "Bash|Write|Edit|MultiEdit|NotebookEdit"
ATTRIBUTION = {"commit": "", "pr": "", "sessionUrl": False}
BEGIN, END = "# >>> harness >>>", "# <<< harness <<<"
LINKS = [
    (os.path.join(ROOT, "bin", "harness-ack"),
     os.path.join(HOME, ".local", "bin", "harness-ack")),
    (os.path.join(ROOT, "workflows", "drive-pr.js"),
     os.path.join(HOME, ".claude", "workflows", "drive-pr.js")),
]


def ours(entry):
    return any("hooks/guard.py" in h.get("command", "")
               for h in entry.get("hooks", []))


def merged_settings(s, uninstall):
    s = json.loads(json.dumps(s))
    hooks = s.setdefault("hooks", {})
    for event in ("PreToolUse", "UserPromptSubmit"):
        kept = [e for e in hooks.get(event, []) if not ours(e)]
        if not uninstall:
            entry = {"hooks": [{"type": "command", "command": GUARD_CMD,
                                "timeout": 10}]}
            if event == "PreToolUse":
                entry = dict({"matcher": MATCHER}, **entry)
            kept.append(entry)
        if kept:
            hooks[event] = kept
        else:
            hooks.pop(event, None)
    if uninstall:
        if s.get("attribution") == ATTRIBUTION:
            del s["attribution"]
    elif "attribution" not in s:
        s["attribution"] = ATTRIBUTION
    return s


def git_hooks_path():
    p = subprocess.run(["git", "config", "--global", "--get",
                        "core.hooksPath"], stdout=subprocess.PIPE,
                       universal_newlines=True)
    return p.stdout.strip()


def zshenv_block():
    return "%s\nsource '%s'\n%s\n" % (
        BEGIN, os.path.join(ROOT, "hooks", "zshenv-guard.zsh"), END)


def strip_block(text):
    if BEGIN not in text:
        return text
    head, rest = text.split(BEGIN, 1)
    tail = rest.split(END, 1)[1] if END in rest else ""
    return head.rstrip("\n") + ("\n" if head.strip() else "") + \
        tail.lstrip("\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--uninstall", action="store_true")
    ap.add_argument("--force-hooks-path", action="store_true")
    a = ap.parse_args()
    verb = "remove" if a.uninstall else "install"
    mode = "APPLY" if a.apply else "DRY RUN"
    print("harness %s from %s [%s]\n" % (verb, ROOT, mode))
    stamp = time.strftime("%Y%m%d-%H%M%S")

    # 1. settings.json
    before = open(SETTINGS).read() if os.path.exists(SETTINGS) else "{}\n"
    after_obj = merged_settings(json.loads(before), a.uninstall)
    after = json.dumps(after_obj, indent=2) + "\n"
    norm_before = json.dumps(json.loads(before), indent=2) + "\n"
    diff = list(difflib.unified_diff(
        norm_before.splitlines(True), after.splitlines(True),
        "settings.json (now)", "settings.json (after)"))
    print("1. %s" % SETTINGS)
    print("".join(diff) if diff else "   no change\n")
    if a.apply and diff:
        shutil.copy2(SETTINGS, "%s.bak-harness-%s" % (SETTINGS, stamp))
        tmp = SETTINGS + ".tmp"
        with open(tmp, "w") as f:
            f.write(after)
        os.rename(tmp, SETTINGS)
        print("   written; backup %s.bak-harness-%s\n" % (SETTINGS, stamp))

    # 2. core.hooksPath
    want = os.path.join(ROOT, "hooks", "git")
    cur = git_hooks_path()
    print("2. git config --global core.hooksPath")
    if a.uninstall:
        if cur == want:
            print("   unset (was %s)" % cur)
            if a.apply:
                subprocess.run(["git", "config", "--global", "--unset",
                                "core.hooksPath"], check=True)
        else:
            print("   not ours (%r), left alone" % cur)
    elif cur == want:
        print("   already %s" % want)
    elif cur and not a.force_hooks_path:
        print("   REFUSED: already set to %s (use --force-hooks-path)" % cur)
    else:
        print("   %r -> %s" % (cur, want))
        if a.apply:
            subprocess.run(["git", "config", "--global", "core.hooksPath",
                            want], check=True)
    print("   note: a repo that sets its own core.hooksPath (husky, "
          "pre-commit) bypasses this\n")

    # 3. ~/.zshenv
    text = open(ZSHENV).read() if os.path.exists(ZSHENV) else ""
    new = strip_block(text)
    if not a.uninstall:
        new = new.rstrip("\n") + ("\n\n" if new.strip() else "") + \
            zshenv_block()
    print("3. %s" % ZSHENV)
    zd = list(difflib.unified_diff(text.splitlines(True),
                                   new.splitlines(True), ".zshenv (now)",
                                   ".zshenv (after)"))
    print("".join(zd) if zd else "   no change\n")
    if a.apply and zd:
        if text:
            shutil.copy2(ZSHENV, "%s.bak-harness-%s" % (ZSHENV, stamp))
        with open(ZSHENV, "w") as f:
            f.write(new)

    # 4. symlinks
    print("4. symlinks")
    for src, dst in LINKS:
        cur = os.path.realpath(dst) if os.path.lexists(dst) else None
        if a.uninstall:
            if cur == src:
                print("   rm %s" % dst)
                if a.apply:
                    os.remove(dst)
            continue
        if cur == src:
            print("   ok %s" % dst)
        elif os.path.lexists(dst):
            print("   REFUSED: %s exists and is not ours" % dst)
        else:
            print("   ln -s %s %s" % (src, dst))
            if a.apply:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                os.symlink(src, dst)

    if not a.apply:
        print("\nNothing changed. Rerun with --apply.")
    else:
        print("\nDone. New sessions pick up the hooks; run /hooks in a "
              "running session to reload.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
