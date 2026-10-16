"""commit-msg check and hook dispatcher tests, against throwaway repos."""
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = os.path.join(ROOT, "hooks", "checks", "commit-msg")
HOOKS = os.path.join(ROOT, "hooks", "git")
SOB = "Signed-off-by: Anastassios Nanos <ananos@nofire.ai>"


def git(repo, *args, **kw):
    return subprocess.run(["git", "-C", repo] + list(args),
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          universal_newlines=True, **kw)


class CommitMsgTest(unittest.TestCase):
    def setUp(self):
        self.repo = tempfile.mkdtemp()
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.name", "Anastassios Nanos")
        git(self.repo, "config", "user.email", "ananos@nofire.ai")

    def tearDown(self):
        shutil.rmtree(self.repo)

    def check(self, msg):
        path = os.path.join(self.repo, "MSG")
        with open(path, "w") as f:
            f.write(msg)
        p = subprocess.run([CHECK, path], cwd=self.repo,
                           stderr=subprocess.PIPE, universal_newlines=True)
        return p.returncode, p.stderr

    def test_good_message(self):
        rc, err = self.check("feat(guard): Add outward guard\n\n"
                             "Classify push/post/merge.\n\n" + SOB + "\n")
        self.assertEqual(rc, 0, err)

    def test_rejects(self):
        bad = {
            "bot co-author": "fix: Add x\n\nCo-authored-by: Claude Opus "
                             "<noreply@anthropic.com>\n" + SOB,
            "bot account": "fix: Add x\n\nCo-authored-by: dependabot[bot] "
                           "<x@users.noreply.github.com>\n" + SOB,
            "session line": "fix: Add x\n\nClaude-Session: https://claude.ai/"
                            "code/x\n" + SOB,
            "generated footer": "fix: Add x\n\nGenerated with [Claude Code]"
                                "(https://claude.com)\n\n" + SOB,
            "no sign-off": "fix: Add x\n",
            "not conventional": "Add x\n\n" + SOB,
            "lowercase": "fix: add x\n\n" + SOB,
            "too long": "feat(something): Add a very long subject line here "
                        "x\n\n" + SOB,
            "em dash": u"fix: Add x \u2014 and y\n\n" + SOB,
            "arrow": "fix: Map a -> b\n\n" + SOB,
            "period": "fix: Add x.\n\n" + SOB,
            "pr number": "fix: Add x (#12)\n\n" + SOB,
            "no blank line": "fix: Add x\nbody\n\n" + SOB,
        }
        for name, msg in bad.items():
            rc, _ = self.check(msg)
            self.assertEqual(rc, 1, name)

    def test_person_co_author_allowed(self):
        rc, err = self.check("fix: Add x\n\nCo-authored-by: Charalampos "
                             "Mainas <cmainas@nubificus.co.uk>\n" + SOB)
        self.assertEqual(rc, 0, err)

    def test_subsystem_style(self):
        git(self.repo, "config", "harness.subjectStyle", "subsystem")
        rc, err = self.check("runtime-rs: Fix fc jailer path\n\n" + SOB)
        self.assertEqual(rc, 0, err)
        rc, _ = self.check("Fix fc jailer path\n\n" + SOB)
        self.assertEqual(rc, 1)

    def test_style_off_still_checks_trailers(self):
        git(self.repo, "config", "harness.subjectStyle", "off")
        self.assertEqual(self.check("anything goes\n\n" + SOB)[0], 0)
        self.assertEqual(self.check("anything goes\n")[0], 1)

    def test_fixup_skips_style(self):
        self.assertEqual(self.check("fixup! fix: Add x\n")[0], 0)

    def test_comments_ignored(self):
        rc, err = self.check("fix: Add x\n\n" + SOB + "\n# Please enter\n")
        self.assertEqual(rc, 0, err)

    def test_dispatcher_chains_to_repo_hook(self):
        git(self.repo, "config", "core.hooksPath", HOOKS)
        marker = os.path.join(self.repo, "local-hook-ran")
        local = os.path.join(self.repo, ".git", "hooks", "commit-msg")
        with open(local, "w") as f:
            f.write("#!/bin/sh\ntouch '%s'\n" % marker)
        os.chmod(local, 0o755)
        ok = git(self.repo, "commit", "-q", "--allow-empty", "-s",
                 "-m", "chore: Add empty commit")
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertTrue(os.path.exists(marker))
        os.remove(marker)
        bad = git(self.repo, "commit", "-q", "--allow-empty", "-s",
                  "-m", "added stuff")
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("harness commit-msg", bad.stderr)
        self.assertFalse(os.path.exists(marker))


if __name__ == "__main__":
    unittest.main()
