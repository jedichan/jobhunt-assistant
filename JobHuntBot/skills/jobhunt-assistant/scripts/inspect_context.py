#!/usr/bin/env python3
"""Inspect JobHuntBot inputs without writing files or accessing mailboxes.

Exit 0 means the inspection completed with the mode's required files readable;
it does not mean CSV history, a scheduler run, or an application was validated.
Exit 1 means required input files are missing/unreadable. Findings remain JSON.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlsplit

try:
    import tomllib
except ImportError:  # Python before 3.11 can still inspect local inputs.
    tomllib = None


SCRIPT_PATH = Path(__file__).resolve()
SETTINGS_PATH = SCRIPT_PATH.parents[1] / "settings.json"
DEFAULT_WORKSPACE = SCRIPT_PATH.parents[4]
DEFAULT_IDS: dict[str, str] = {}
CSV_COLUMNS = {
    "preliminary_job_pool.csv": "lead_id date_found company company_group job_title role_family level location source job_url posted_date application_deadline company_type priority status resume_variant fit_summary eligibility blocker next_action user_decision promoted_at notes".split(),
    "job_pool.csv": "date_found company job_title role_family level location remote_policy source job_url posted_date priority status resume_variant skip_reason blocker next_action notes cohort_match_status current_stage".split(),
    "application_log.csv": "attempt_date company job_title job_url platform status submission_evidence resume_used answers_used confirmation_url confirmation_text notes job_description".split(),
    "follow_up.csv": "date company job_title contact channel event_type deadline next_action status notes time".split(),
    "daily_dashboard.csv": "date found_count submitted_count skipped_count blocked_count needs_user_count pending_count top_sources summary user_actions_needed".split(),
    "blocker_queue.csv": "date company job_title job_url blocker_category what_happened why_blocked can_retry next_retry_strategy user_action_needed status".split(),
    "automation_rules.csv": "date rule_category rule reason source_blocker_or_lesson status".split(),
    "resume_rules.csv": "role_family resume_file_path use_for_titles avoid_for_titles tailor_threshold notes".split(),
}
MODE_REQUIRED = {
    "screen": ["candidate_profile.json", "application_rules.md", "resume_routing.md", "references/preliminary-pool-workflow.md", "dashboard/job_pool.csv", "dashboard/preliminary_job_pool.csv"],
    "apply": ["candidate_profile.json", "application_rules.md", "resume_routing.md", "answer_bank.md", "experience_bank.md", "references/application-playbook.md", "references/safety-and-boundaries.md", "references/preliminary-pool-workflow.md", "dashboard/job_pool.csv", "dashboard/preliminary_job_pool.csv", "dashboard/application_log.csv"],
    "gmail": ["references/gmail-follow-up-workflow.md", "dashboard/application_log.csv", "dashboard/job_pool.csv", "dashboard/follow_up.csv", "dashboard/gmail_sync_state.json"],
    "dashboard": ["dashboard/dashboard.html", "dashboard/server.js", "dashboard/dashboard-data.js", "dashboard/dashboard-model.js", "dashboard/dashboard-ui.js", "dashboard/dashboard.css", "dashboard/preliminary_job_pool.csv", "dashboard/job_pool.csv"],
    "automation": ["references/preliminary-pool-workflow.md", "references/gmail-follow-up-workflow.md", "dashboard/automation_rules.csv", "dashboard/dashboard-data.js"],
}
MODE_OPTIONAL = {
    "screen": ["dashboard/daily_dashboard.csv", "dashboard/blocker_queue.csv", "dashboard/automation_rules.csv"],
    "apply": ["references/verification-code-workflow.md", "dashboard/follow_up.csv", "dashboard/daily_dashboard.csv", "dashboard/blocker_queue.csv", "dashboard/resume_rules.csv"],
    "gmail": ["dashboard/daily_dashboard.csv", "dashboard/blocker_queue.csv"],
    "dashboard": ["dashboard/daily_dashboard.csv", "dashboard/follow_up.csv", "dashboard/start-dashboard.sh", "dashboard/看板使用说明.md"],
    "automation": ["dashboard/daily_dashboard.csv", "dashboard/gmail_sync_state.json"],
}
OVERVIEW_FILES = {"preliminary": "preliminary_job_pool.csv", "jobs": "job_pool.csv", "daily": "daily_dashboard.csv", "followUp": "follow_up.csv"}


def fingerprint(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def inspect_csv(content: bytes, filename: str) -> dict[str, Any]:
    """Expose schema/counts only; never expose rows, email IDs, or cell text."""
    expected = CSV_COLUMNS[filename]
    try:
        rows = list(csv.reader(io.StringIO(content.decode("utf-8-sig"), newline=""), strict=True))
    except (UnicodeError, csv.Error):
        return {"status": "invalid", "problem": "CSV decoding or syntax error", "expected_columns": expected}
    if not rows:
        return {"status": "invalid", "problem": "CSV is empty; header missing", "expected_columns": expected, "row_count": 0}
    header, records = rows[0], [row for row in rows[1:] if row]
    # Unknown header text may actually be a private record from a broken file.
    # Redact it while retaining its position and a fingerprint for comparison.
    unknown = [name for name in header if name not in expected]
    result: dict[str, Any] = {
        "status": "ok",
        "columns": [name if name in expected else "<unrecognized-column>" for name in header],
        "row_count": len(records),
        "missing_columns": [name for name in expected if name not in header],
        "duplicate_header_count": len(header) - len(set(header)),
        "unknown_header_count": len(unknown),
        "malformed_row_count": sum(len(row) != len(header) for row in records),
    }
    if unknown:
        result["unknown_header_sha256"] = fingerprint(json.dumps(unknown, ensure_ascii=False).encode())
    if filename == "preliminary_job_pool.csv" and "lead_id" in header:
        index = header.index("lead_id")
        seen: dict[str, list[int]] = {}
        empty = 0
        for record_number, row in enumerate(records, 1):
            lead = row[index].strip() if index < len(row) else ""
            if lead:
                seen.setdefault(lead, []).append(record_number)
            else:
                empty += 1
        duplicates = [positions for positions in seen.values() if len(positions) > 1]
        result["lead_id_check"] = {
            "blank_count": empty,
            "duplicate_value_count": len(duplicates),
            "duplicate_extra_row_count": sum(len(positions) - 1 for positions in duplicates),
            "duplicate_record_positions": duplicates[:20],
            "positions_truncated": len(duplicates) > 20,
            "position_unit": "1-based CSV data records, excluding the header and blank records",
        }
        if empty or duplicates:
            result["status"] = "warning"
    if result["missing_columns"] or result["duplicate_header_count"] or result["unknown_header_count"] or result["malformed_row_count"]:
        result["status"] = "warning"
    return result


def inspect_file(path: Path, required: bool = True) -> dict[str, Any]:
    result: dict[str, Any] = {"path": str(path), "required": required, "exists": path.is_file()}
    if not result["exists"]:
        result["status"] = "missing"
        return result
    try:
        content = path.read_bytes()
    except OSError as error:
        result.update(status="unreadable", error_type=type(error).__name__)
        return result
    result.update(status="ok", size_bytes=len(content), sha256=fingerprint(content))
    if path.name in CSV_COLUMNS:
        result["csv"] = inspect_csv(content, path.name)
    return result


def load_settings(path: Path) -> tuple[dict[str, Any], list[str]]:
    if not path.is_file():
        return {}, ["settings.json is missing; using the script location and default automation IDs"]
    try:
        settings = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(settings, dict):
            raise ValueError("object required")
        return settings, []
    except (OSError, UnicodeError, ValueError):
        return {}, ["settings.json could not be parsed as an object; using defaults"]


def inspect_schedules(ids: Any, automation_root: Path | None = None) -> dict[str, Any]:
    if tomllib is None:
        return {"status": "unavailable", "reason": "tomllib unavailable; Python 3.11+ is needed for schedule metadata; no TOML values were guessed"}
    if not isinstance(ids, dict):
        return {"status": "invalid", "reason": "automation_ids must be an object"}
    root = automation_root or Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))).expanduser() / "automations"
    schedules = []
    for role in ("screen", "gmail"):
        schedule_id = ids.get(role)
        if not schedule_id:
            continue
        if not isinstance(schedule_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", schedule_id):
            schedules.append({"role": role, "status": "invalid", "reason": "missing or invalid automation ID"})
            continue
        path = root / schedule_id / "automation.toml"
        entry: dict[str, Any] = {"role": role, "id": schedule_id, "path": str(path)}
        try:
            content = path.read_bytes()
            config = tomllib.loads(content.decode("utf-8"))
            metadata = {key: config.get(key) for key in ("id", "name", "kind", "status", "rrule")}
            if any(not isinstance(metadata[key], str) or not metadata[key] for key in metadata):
                raise ValueError("incomplete schedule metadata")
            if metadata["id"] != schedule_id:
                raise ValueError("schedule ID mismatch")
            entry.update(status="ok", metadata=metadata, sha256=fingerprint(content))
        except FileNotFoundError:
            entry.update(status="missing", reason="schedule configuration not found")
        except (OSError, UnicodeError, ValueError) as error:
            entry.update(status="invalid", error_type=type(error).__name__, reason="schedule metadata could not be validated")
        schedules.append(entry)
    return {"status": "ok" if all(row["status"] == "ok" for row in schedules) else "warning", "schedules": schedules, "note": "Enabled configuration does not prove that a scheduled run succeeded; prompt content is never included"}


def validate_overview(payload: Any, local_counts: dict[str, int]) -> dict[str, Any]:
    problems, comparisons = [], []
    if not isinstance(payload, dict):
        return {"status": "invalid", "problems": ["overview must be a JSON object"]}
    datasets, sources = payload.get("datasets"), payload.get("sources")
    if not isinstance(datasets, dict) or not isinstance(sources, dict):
        return {"status": "invalid", "problems": ["datasets and sources must be objects"]}
    for key, filename in OVERVIEW_FILES.items():
        records, source = datasets.get(key), sources.get(key)
        if not isinstance(records, list) or any(not isinstance(row, dict) for row in records):
            problems.append(f"datasets.{key} must be an array of objects")
            continue
        if not isinstance(source, dict) or source.get("file") != filename:
            problems.append(f"sources.{key} must identify {filename}")
            continue
        remote_count = source.get("rowCount")
        # The server intentionally uses null metadata for an unavailable optional CSV.
        optional_unavailable = key in ("daily", "followUp") and remote_count is None and bool(source.get("error"))
        if optional_unavailable:
            problems.append(f"optional source {filename} is unavailable")
        elif type(remote_count) is not int or remote_count != len(records):
            problems.append(f"sources.{key}.rowCount disagrees with its dataset")
        if "modifiedAt" not in source or (source["modifiedAt"] is not None and not isinstance(source["modifiedAt"], str)):
            problems.append(f"sources.{key}.modifiedAt must be a string or null")
        comparison = {"file": filename, "api_row_count": len(records), "local_row_count": local_counts.get(filename)}
        if filename in local_counts:
            comparison["matches_local"] = len(records) == local_counts[filename]
            if not comparison["matches_local"]:
                problems.append(f"API and local row counts differ for {filename}; files may have changed during inspection")
        comparisons.append(comparison)
    if not isinstance(payload.get("schedules"), list) or not isinstance(payload.get("warnings"), list):
        problems.append("schedules and warnings must be arrays")
    if not isinstance(payload.get("generatedAt"), str):
        problems.append("generatedAt must be a string")
    if not isinstance(payload.get("today"), str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", payload["today"]):
        problems.append("today must use YYYY-MM-DD")
    return {"status": "warning" if problems else "ok", "problems": problems, "row_counts": comparisons, "server_warning_count": len(payload.get("warnings", [])) if isinstance(payload.get("warnings"), list) else None}


def check_dashboard(local_counts: dict[str, int], dashboard_url: str = "http://localhost:8420/dashboard.html") -> dict[str, Any]:
    # Only probe loopback. Never follow redirects or pass credentials.
    try:
        parsed = urlsplit(dashboard_url)
        if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1") or parsed.username or parsed.password:
            raise ValueError("local HTTP URL required")
        port = parsed.port or 80
    except (TypeError, ValueError):
        return {"status": "invalid", "reason": "dashboard_url must be a local HTTP URL without credentials"}
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    result: dict[str, Any] = {"url": f"http://127.0.0.1:{port}/api/overview", "method": "GET"}
    try:
        connection.request("GET", "/api/overview", headers={"Accept": "application/json"})
        response = connection.getresponse()
        result["http_status"] = response.status
        if response.status != 200:
            return {**result, "status": "unavailable", "reason": "overview did not return HTTP 200; redirects are not followed"}
        content = response.read(16 * 1024 * 1024 + 1)
        if len(content) > 16 * 1024 * 1024:
            return {**result, "status": "invalid", "reason": "overview exceeds the 16 MiB inspection limit"}
        payload = json.loads(content)
        return {**result, **validate_overview(payload, local_counts)}
    except (OSError, http.client.HTTPException, ValueError) as error:
        return {**result, "status": "unavailable", "error_type": type(error).__name__, "reason": "overview could not be read or parsed; no service was started"}
    finally:
        connection.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=sorted(MODE_REQUIRED), default="dashboard")
    parser.add_argument("--workspace", type=Path, help="Root containing JobHuntBot; overrides settings.json")
    parser.add_argument("--check-dashboard", action="store_true", help="Read-only GET of the configured local overview endpoint (2-second socket timeout)")
    parser.add_argument("--check-schedules", action="store_true", help="Read only explicitly configured automation TOML files and expose public metadata")
    args = parser.parse_args(argv)
    settings, warnings = load_settings(SETTINGS_PATH)
    configured_root = settings.get("workspace_root")
    if configured_root is not None and not isinstance(configured_root, str):
        warnings.append("workspace_root must be a string; using the script location")
        configured_root = None
    root = (args.workspace or (Path(configured_root) if configured_root else DEFAULT_WORKSPACE)).expanduser().resolve()
    project = root / "JobHuntBot"
    files = [inspect_file(project / name) for name in MODE_REQUIRED[args.mode]]
    files += [inspect_file(project / name, required=False) for name in MODE_OPTIONAL[args.mode]]
    missing = [entry["path"] for entry in files if entry["required"] and entry["status"] in ("missing", "unreadable")]
    local_counts = {Path(entry["path"]).name: entry["csv"]["row_count"] for entry in files if "row_count" in entry.get("csv", {})}
    report: dict[str, Any] = {
        "mode": args.mode, "read_only": True, "workspace_root": str(root),
        "settings_path": str(SETTINGS_PATH), "settings_exists": SETTINGS_PATH.is_file(),
        "required_files_available": not missing, "missing_or_unreadable_required": missing,
        "files": files, "warnings": warnings,
        "interpretation": "File availability, CSV findings, website health and scheduler configuration are separate checks. This report does not access Gmail, validate candidate facts, run screening, promote leads, submit applications, or change state.",
    }
    if args.check_dashboard:
        report["dashboard_check"] = check_dashboard(local_counts, settings.get("dashboard_url", "http://localhost:8420/dashboard.html"))
    if args.check_schedules:
        report["schedule_check"] = inspect_schedules(settings.get("automation_ids", DEFAULT_IDS))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
