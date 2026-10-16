"""Installer tests against a throwaway HOME."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALL = os.path.join(ROOT, "bin", "install.py")
EXISTING = {
    "model": "opus",
    "hooks": {"SessionStart": [{"hooks": [{"type": "command",
                                           "command": "reap.sh"}]}]},
}


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.home, ".claude"))
        self.settings = os.path.join(self.home, ".claude", "settings.json")
        with open(self.settings, "w") as f:
            json.dump(EXISTING, f)
        with open(os.path.join(self.home, ".zshenv"), "w") as f:
            f.write('. "$HOME/.cargo/env"\n')
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith("GIT_CONFIG")}
        self.env["HOME"] = self.home

    def tearDown(self):
        shutil.rmtree(self.home)

    def run_install(self, *args):
        p = subprocess.run([sys.executable, "-I", INSTALL] + list(args),
                           env=self.env, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, universal_newlines=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout

    def load(self):
        with open(self.settings) as f:
            return json.load(f)

    def test_default_installs_workflows_only(self):
        self.run_install("--apply")
        wf = os.path.join(self.home, ".claude", "workflows")
        self.assertEqual(sorted(os.listdir(wf)),
                         ["build.js", "ship.js", "triage.js", "verify.js"])
        self.assertEqual(self.load(), EXISTING)
        self.assertNotIn("zshenv-guard", open(
            os.path.join(self.home, ".zshenv")).read())
        hp = subprocess.run(["git", "config", "--global", "core.hooksPath"],
                            env=self.env, stdout=subprocess.PIPE,
                            universal_newlines=True).stdout.strip()
        self.assertEqual(hp, "")

    def test_stale_workflow_link_removed(self):
        wf = os.path.join(self.home, ".claude", "workflows")
        os.makedirs(wf)
        os.symlink(os.path.join(ROOT, "workflows", "gone.js"),
                   os.path.join(wf, "gone.js"))
        os.symlink("/elsewhere/mine.js", os.path.join(wf, "mine.js"))
        self.run_install("--apply")
        self.assertFalse(os.path.lexists(os.path.join(wf, "gone.js")))
        self.assertTrue(os.path.lexists(os.path.join(wf, "mine.js")))

    def test_dry_run_changes_nothing(self):
        out = self.run_install("--all")
        self.assertIn("DRY RUN", out)
        self.assertEqual(self.load(), EXISTING)
        self.assertFalse(os.path.lexists(
            os.path.join(self.home, ".local", "bin", "harness-ack")))

    def test_apply_idempotent_and_uninstall(self):
        self.run_install("--all", "--apply")
        s = self.load()
        self.assertEqual(s["hooks"]["SessionStart"],
                         EXISTING["hooks"]["SessionStart"])
        self.assertEqual(len(s["hooks"]["PreToolUse"]), 1)
        self.assertIn("guard.py",
                      s["hooks"]["PreToolUse"][0]["hooks"][0]["command"])
        self.assertEqual(len(s["hooks"]["UserPromptSubmit"]), 1)
        self.assertEqual(s["attribution"]["commit"], "")
        hp = subprocess.run(["git", "config", "--global", "core.hooksPath"],
                            env=self.env, stdout=subprocess.PIPE,
                            universal_newlines=True).stdout.strip()
        self.assertEqual(hp, os.path.join(ROOT, "hooks", "git"))
        zshenv = open(os.path.join(self.home, ".zshenv")).read()
        self.assertIn("zshenv-guard.zsh", zshenv)
        self.assertIn(".cargo/env", zshenv)
        self.assertTrue(os.path.islink(
            os.path.join(self.home, ".claude", "workflows", "build.js")))

        again = self.run_install("--all", "--apply")
        self.assertIn("no change", again)
        self.assertEqual(len(self.load()["hooks"]["PreToolUse"]), 1)

        self.run_install("--uninstall", "--apply")
        self.assertEqual(self.load(), EXISTING)
        self.assertEqual(open(os.path.join(self.home, ".zshenv")).read(),
                         '. "$HOME/.cargo/env"\n')
        self.assertFalse(os.path.lexists(
            os.path.join(self.home, ".local", "bin", "harness-ack")))
        self.assertEqual(os.listdir(
            os.path.join(self.home, ".claude", "workflows")), [])

    def test_refuses_foreign_hooks_path(self):
        subprocess.run(["git", "config", "--global", "core.hooksPath",
                        "/elsewhere"], env=self.env, check=True)
        out = self.run_install("--with", "git", "--apply")
        self.assertIn("REFUSED", out)
        hp = subprocess.run(["git", "config", "--global", "core.hooksPath"],
                            env=self.env, stdout=subprocess.PIPE,
                            universal_newlines=True).stdout.strip()
        self.assertEqual(hp, "/elsewhere")


if __name__ == "__main__":
    unittest.main()
