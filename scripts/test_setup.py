"""Behavioral checks in disposable copies; never initialize a real workspace."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[1]
PERSONAL_FILES = (
    "candidate_profile.json", "application_rules.md", "resume_routing.md",
    "answer_bank.md", "experience_bank.md",
)


class SetupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="jobhunt-setup-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "repo"
        self.project = self.root / "JobHuntBot"
        self.skill = self.project / "skills" / "jobhunt-assistant"
        self.skill.mkdir(parents=True)
        (self.root / "scripts").mkdir()
        shutil.copy2(REPO / "scripts" / "setup.py", self.root / "scripts" / "setup.py")
        shutil.copy2(REPO / ".gitignore", self.root / ".gitignore")
        shutil.copytree(REPO / "JobHuntBot" / "templates", self.project / "templates")
        self.codex = Path(self.temp.name) / "codex-home"
        self.env = {**os.environ, "CODEX_HOME": str(self.codex)}

    def run_setup(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(self.root / "scripts" / "setup.py"), *args],
            cwd=self.root, env=self.env, text=True, capture_output=True,
        )

    def initialized_paths(self) -> list[Path]:
        return (
            [self.project / name for name in PERSONAL_FILES]
            + [self.project / "dashboard" / file.name for file in (self.project / "templates" / "dashboard-template").glob("*.csv")]
            + [self.project / "dashboard" / "gmail_sync_state.json", self.skill / "settings.json"]
        )

    def test_first_setup_initializes_files_without_global_install(self) -> None:
        result = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        for path in self.initialized_paths():
            self.assertTrue(path.is_file(), path)
        for file in (self.project / "templates" / "dashboard-template").glob("*.csv"):
            self.assertEqual((self.project / "dashboard" / file.name).read_bytes(), file.read_bytes())
        self.assertEqual(json.loads((self.skill / "settings.json").read_text()), {
            "workspace_root": str(self.root.resolve()),
            "dashboard_url": "http://localhost:8420/dashboard.html",
            "automation_ids": {},
        })
        self.assertEqual(json.loads((self.project / "dashboard" / "gmail_sync_state.json").read_text()), {
            "last_checked_at": None, "last_attempted_at": None, "processed_message_hashes": [],
        })
        self.assertFalse(self.codex.exists())

    def test_repeat_setup_preserves_every_existing_file(self) -> None:
        self.assertEqual(self.run_setup().returncode, 0)
        saved = {}
        for index, path in enumerate(self.initialized_paths()):
            saved[path] = f"private local content {index}\n".encode()
            path.write_bytes(saved[path])
        result = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Initialized 0 missing files", result.stdout)
        for path, content in saved.items():
            self.assertEqual(path.read_bytes(), content)

    def test_explicit_install_is_idempotent(self) -> None:
        for _ in range(2):
            result = self.run_setup("--install-skill")
            self.assertEqual(result.returncode, 0, result.stderr)
        installed = self.codex / "skills" / "jobhunt-assistant"
        self.assertTrue(installed.is_symlink())
        self.assertEqual(installed.resolve(), self.skill.resolve())

    def test_conflicting_skill_link_is_preserved(self) -> None:
        original = Path(self.temp.name) / "existing-workspace-skill"
        original.mkdir()
        (original / "settings.json").write_text('"keep original"')
        installed = self.codex / "skills" / "jobhunt-assistant"
        installed.parent.mkdir(parents=True)
        installed.symlink_to(original, target_is_directory=True)
        result = self.run_setup("--install-skill")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(installed.resolve(), original.resolve())
        self.assertEqual((original / "settings.json").read_text(), '"keep original"')
        self.assertFalse((self.project / "candidate_profile.json").exists())

    @unittest.skipUnless(shutil.which("git"), "Git is required to verify ignore behavior")
    def test_private_files_are_ignored_but_templates_are_trackable(self) -> None:
        self.assertEqual(self.run_setup().returncode, 0)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True, capture_output=True)
        private_paths = self.initialized_paths() + [
            self.project / "my-materials" / "resume.pdf",
            self.project / "reports" / "summary.md",
            self.root / ".env", self.root / ".vercel" / "project.json",
            self.root / ".cache" / "output.json",
        ]
        for path in private_paths:
            result = subprocess.run(
                ["git", "check-ignore", "--quiet", "--", str(path.relative_to(self.root))],
                cwd=self.root, capture_output=True,
            )
            self.assertEqual(result.returncode, 0, str(path))
        for path in (self.project / "templates").rglob("*"):
            if path.is_file():
                result = subprocess.run(
                    ["git", "check-ignore", "--quiet", "--", str(path.relative_to(self.root))],
                    cwd=self.root, capture_output=True,
                )
                self.assertEqual(result.returncode, 1, str(path))


if __name__ == "__main__":
    unittest.main()
