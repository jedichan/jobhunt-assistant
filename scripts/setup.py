#!/usr/bin/env python3
"""Initialize missing local inputs. Existing files and skill installs stay intact."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
PERSONAL_FILES = (
    "candidate_profile.json",
    "application_rules.md",
    "resume_routing.md",
    "answer_bank.md",
    "experience_bank.md",
)


def write_missing(path: Path, content: bytes) -> bool:
    """Exclusive creation also prevents following an existing file symlink."""
    if not path.parent.resolve().is_relative_to(ROOT):
        raise ValueError(f"Refusing to write outside this repository: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as output:
            output.write(content)
    except FileExistsError:
        return False
    return True


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def initialize() -> list[Path]:
    project = ROOT / "JobHuntBot"
    templates = project / "templates"
    files = {}
    for name in PERSONAL_FILES:
        file = Path(name)
        template = templates / f"{file.stem}.template{file.suffix}"
        files[project / name] = template.read_bytes()
    csv_templates = sorted((templates / "dashboard-template").glob("*.csv"))
    if not csv_templates:
        raise ValueError("No dashboard CSV templates found")
    for template in csv_templates:
        files[project / "dashboard" / template.name] = template.read_bytes()
    files[project / "dashboard" / "gmail_sync_state.json"] = json_bytes({
        "last_checked_at": None,
        "last_attempted_at": None,
        "processed_message_hashes": [],
    })
    files[project / "skills" / "jobhunt-assistant" / "settings.json"] = json_bytes({
        "workspace_root": str(ROOT),
        "dashboard_url": "http://localhost:8420/dashboard.html",
        "automation_ids": {},
    })
    return [path for path, content in files.items() if write_missing(path, content)]


def skill_destination() -> Path:
    codex_root = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))).expanduser()
    return codex_root / "skills" / "jobhunt-assistant"


def check_skill_destination(destination: Path, source: Path) -> bool:
    if not os.path.lexists(destination):
        return False
    if destination.is_symlink() and destination.resolve() == source.resolve():
        return True
    raise ValueError(
        f"Existing skill left unchanged: {destination}. "
        "Use the existing installation or invoke this repository's SKILL.md directly."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--install-skill", action="store_true",
        help="Explicitly link this skill into CODEX_HOME; never replace an existing installation",
    )
    args = parser.parse_args()
    source = ROOT / "JobHuntBot" / "skills" / "jobhunt-assistant"
    try:
        destination = skill_destination() if args.install_skill else None
        already_installed = check_skill_destination(destination, source) if destination else False
        created = initialize()
        if destination is not None and not already_installed:
            destination.parent.mkdir(parents=True, exist_ok=True)
            # No unlink/replace: a concurrently created installation also stays intact.
            destination.symlink_to(source, target_is_directory=True)
        print(f"Initialized {len(created)} missing files; existing files were preserved.")
        if destination is not None:
            print("Skill link already points here." if already_installed else "Skill link installed.")
        print("No schedules, browser sessions, mailbox access, or applications were started.")
        return 0
    except (OSError, ValueError) as error:
        print(f"Setup stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
