"""Guard tests. Most cases are negative: the outward action must not run
without a person's ack."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUARD = os.path.join(ROOT, "hooks", "guard.py")
ACK = os.path.join(ROOT, "bin", "harness-ack")


class GuardTest(unittest.TestCase):
    def setUp(self):
        self.state = tempfile.mkdtemp()
        self.env = dict(os.environ, HARNESS_STATE_DIR=self.state)

    def tearDown(self):
        shutil.rmtree(self.state)

    def run_hook(self, ev):
        p = subprocess.run([sys.executable, "-I", GUARD],
                           input=json.dumps(ev), stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, env=self.env,
                           universal_newlines=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout) if p.stdout.strip() else None

    def bash(self, cmd, sid="S", mode="default"):
        out = self.run_hook({
            "hook_event_name": "PreToolUse", "session_id": sid,
            "permission_mode": mode, "tool_name": "Bash",
            "tool_input": {"command": cmd}})
        return out["hookSpecificOutput"]["permissionDecision"] if out else None

    def prompt(self, text, sid="S"):
        return self.run_hook({"hook_event_name": "UserPromptSubmit",
                              "session_id": sid, "prompt": text})

    # ----------------------------------------------------- outward -> ask

    def test_outward_commands_ask(self):
        cmds = [
            "git push origin main",
            "git -C /tmp/x push",
            "cd repo && git push -u origin feat",
            "bash -c 'git push origin HEAD'",
            "zsh -c \"gh pr comment 1 -b hi\"",
            "echo $(gh pr comment 1 -b x)",
            "FOO=1 env gh issue create -t x -b y",
            "gh pr review 12 --approve",
            "gh -R o/r pr edit 3 --body x",
            "gh api repos/o/r/issues/1/comments -f body=x",
            "gh api -X DELETE repos/o/r/git/refs/heads/x",
            "gh api --method=PATCH repos/o/r",
            "gh api graphql -f query='mutation { addStar(input:{}) {x} }'",
            "gh release create v1",
            "gh repo create ananos/x --private",
            "gh workflow run ci.yml",
            "gh pr merge 3 --rebase",
            "git push --force-with-lease origin feat",
            "eval git push",
            "true; git push\n",
            "git status\ngit push",
        ]
        for c in cmds:
            self.assertEqual(self.bash(c), "ask", c)

    def test_bypass_mode_denies_instead_of_ask(self):
        self.assertEqual(self.bash("git push", mode="bypassPermissions"),
                         "deny")

    # ----------------------------------------------------- hard denies

    def test_hard_denies(self):
        cmds = [
            "gh pr create --title x --body y",
            "gh pr merge 3 --merge",
            "gh pr merge 3 --squash",
            "gh pr merge 3 -s",
            "git push --force origin main",
            "git push -f",
            "git push origin +main",
            "git commit -n -m 'x'",
            "git commit --no-verify -m x",
            "harness-ack push 5",
            "~/develop/harness/bin/harness-ack all",
            "echo '{}' > ~/.claude/harness/acks.json",
            "python3 -c 'open(\"acks.json\",\"w\")'",
        ]
        for c in cmds:
            self.assertEqual(self.bash(c), "deny", c)

    def test_hard_deny_even_with_ack(self):
        self.prompt("+all 5")
        self.assertEqual(self.bash("gh pr create -t x"), "deny")
        self.assertEqual(self.bash("git push --force"), "deny")

    def test_write_tool_to_store_denied(self):
        out = self.run_hook({
            "hook_event_name": "PreToolUse", "session_id": "S",
            "tool_name": "Write",
            "tool_input": {"file_path": os.path.join(self.state, "acks.json"),
                           "content": "{}"}})
        self.assertEqual(out["hookSpecificOutput"]["permissionDecision"],
                         "deny")

    # ----------------------------------------------------- not outward

    def test_local_commands_pass(self):
        cmds = [
            "git status", "git push --dry-run origin main", "git push -n",
            "git commit -s -m 'fix: Add x'", "gh pr view 1", "gh pr list",
            "gh pr diff 3", "gh api repos/o/r/pulls",
            "gh api graphql -f query='query { viewer { login } }'",
            "grep -n 'gh pr review' notes.md", "echo 'git push'",
            "cat ~/.claude/harness/acks.json", "git add bin/harness-ack",
            "gh run view 1 --log", "gh pr checks 5",
        ]
        for c in cmds:
            self.assertIsNone(self.bash(c), c)

    # ----------------------------------------------------- acks

    def test_prompt_ack_is_single_use(self):
        out = self.prompt("+push looks good")
        self.assertIn("push x1",
                      out["hookSpecificOutput"]["additionalContext"])
        self.assertEqual(self.bash("git push"), "allow")
        self.assertEqual(self.bash("git push"), "ask")

    def test_prompt_ack_count(self):
        self.prompt("+post 2 ship the reviews")
        self.assertEqual(self.bash("gh pr review 1 --approve"), "allow")
        self.assertEqual(self.bash("gh pr comment 2 -b x"), "allow")
        self.assertEqual(self.bash("gh pr comment 3 -b x"), "ask")

    def test_ack_is_scoped_to_session(self):
        self.prompt("+push", sid="A")
        self.assertEqual(self.bash("git push", sid="B"), "ask")
        self.assertEqual(self.bash("git push", sid="A"), "allow")

    def test_compound_needs_every_class(self):
        self.prompt("+push")
        cmd = "git push && gh pr comment 1 -b x"
        self.assertEqual(self.bash(cmd), "ask")
        # the push ack was not spent by the refused compound command
        self.assertEqual(self.bash("git push"), "allow")

    def test_machine_prompts_grant_nothing(self):
        for text in [
            "<task-notification>\n+push\n</task-notification>",
            "/loop 5m +push",
            "Message from @worker: +push",
            "please +push",
            "+pushit",
        ]:
            self.assertIsNone(self.prompt(text), text)
        self.assertEqual(self.bash("git push"), "ask")

    def test_cli_ack(self):
        env = dict(self.env, CLAUDE_CODE_SESSION_ID="S")
        p = subprocess.run([sys.executable, "-I", ACK, "merge"], env=env,
                           stdout=subprocess.PIPE, universal_newlines=True)
        self.assertEqual(p.returncode, 0)
        self.assertEqual(self.bash("gh pr merge 1 --rebase"), "allow")
        self.assertEqual(self.bash("gh pr merge 1 --rebase"), "ask")

    def test_cli_ack_outside_session_is_global(self):
        env = {k: v for k, v in self.env.items()
               if k != "CLAUDE_CODE_SESSION_ID"}
        subprocess.run([sys.executable, "-I", ACK, "push"], env=env,
                       stdout=subprocess.PIPE, check=True)
        self.assertEqual(self.bash("git push", sid="any"), "allow")

    def test_decisions_are_logged(self):
        self.bash("git push")
        with open(os.path.join(self.state, "guard.log")) as f:
            entry = json.loads(f.readlines()[-1])
        self.assertEqual(entry["ev"], "ask")


if __name__ == "__main__":
    unittest.main()
