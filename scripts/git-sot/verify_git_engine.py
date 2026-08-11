"""Manual smoke: GitRepoService + auto-commit + lease + prod guard (no full langflow)."""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
import tempfile
import types
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "src" / "backend" / "base" / "langflow" / "services" / "flow_git"


def _ensure_pkg(name: str) -> None:
    if name not in sys.modules:
        mod = types.ModuleType(name)
        mod.__path__ = []  # type: ignore[attr-defined]
        sys.modules[name] = mod


def _load(mod_name: str, file_name: str):
    path = PKG / file_name
    spec = importlib.util.spec_from_file_location(mod_name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


for name in (
    "langflow",
    "langflow.services",
    "langflow.services.flow_git",
):
    _ensure_pkg(name)

_load("langflow.services.flow_git.exceptions", "exceptions.py")
_load("langflow.services.flow_git.detect", "detect.py")
_load("langflow.services.flow_git.ops_log", "ops_log.py")
_load("langflow.services.flow_git.paths", "paths.py")
_load("langflow.services.flow_git.atomic", "atomic.py")
_load("langflow.services.flow_git.credentials", "credentials.py")
_load("langflow.services.flow_git.production_branch", "production_branch.py")
_load("langflow.services.flow_git.conflicts", "conflicts.py")
_load("langflow.services.flow_git.leases", "leases.py")
_load("langflow.services.flow_git.secret_scan", "secret_scan.py")
_load("langflow.services.flow_git.repo", "repo.py")
_load("langflow.services.flow_git.auto_commit", "auto_commit.py")

detect = sys.modules["langflow.services.flow_git.detect"]
ProductionBranchGuardError = sys.modules["langflow.services.flow_git.exceptions"].ProductionBranchGuardError
GitRepoService = sys.modules["langflow.services.flow_git.repo"].GitRepoService
ensure_production_branch_file = sys.modules[
    "langflow.services.flow_git.production_branch"
].ensure_production_branch_file
acquire_lease = sys.modules["langflow.services.flow_git.leases"].acquire_lease
release_lease = sys.modules["langflow.services.flow_git.leases"].release_lease
lease_read_only_signal = sys.modules["langflow.services.flow_git.leases"].lease_read_only_signal
maybe_auto_commit = sys.modules["langflow.services.flow_git.auto_commit"].maybe_auto_commit
flush_pending_for_tests = sys.modules["langflow.services.flow_git.auto_commit"].flush_pending_for_tests


def main() -> int:
    try:
        import git  # noqa: F401
    except ImportError:
        print("FAIL: GitPython not installed — pip/uv install GitPython keyring")
        return 1

    st = detect.detect_git_binary()
    assert st.available, st.message
    print("OK git binary", st.version)

    tmp = Path(tempfile.mkdtemp(prefix="git-sot-"))
    try:
        subprocess.run(["git", "init", "-b", "develop"], cwd=tmp, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.email", "t@t"], cwd=tmp, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.name", "t"], cwd=tmp, check=True, capture_output=True)
        (tmp / "flows").mkdir()
        (tmp / "flows" / "dummy.json").write_text("{}\n", encoding="utf-8")
        ensure_production_branch_file(tmp, "production")
        subprocess.run(["git", "add", "-A"], cwd=tmp, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=tmp, check=True, capture_output=True)

        svc = GitRepoService.open(tmp)
        assert svc.current_branch() == "develop"
        status = svc.status()
        assert status.production_branch == "production"
        assert not status.on_production

        svc.create_branch("production", checkout=False)
        # Fresh init may still report dirty on some platforms; force for smoke
        svc.checkout("production", force=True)
        raised = False
        try:
            svc.push(remote="origin")
        except ProductionBranchGuardError as e:
            raised = True
            print("OK push blocked on production:", e)
        except Exception as e:
            raise AssertionError(f"expected ProductionBranchGuardError, got {type(e)}: {e}") from e
        assert raised

        svc.checkout("develop", force=True)
        fid = uuid4()
        path = tmp / "flows" / f"{fid}.json"
        path.write_text('{"id":"%s","name":"demo"}\n' % fid, encoding="utf-8")
        maybe_auto_commit(
            repo_root=tmp,
            flow_id=fid,
            flow_name="demo",
            paths=[f"flows/{fid}.json"],
            enabled=True,
        )
        flush_pending_for_tests(tmp)
        log = subprocess.run(
            ["git", "log", "-1", "--pretty=%s"],
            cwd=tmp,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        assert log.startswith("flow: update demo"), log
        print("OK auto-commit:", log)

        acquire_lease(tmp, fid, holder_id="user-a", holder_name="A")
        sig = lease_read_only_signal(tmp, fid, viewer_id="user-b")
        assert sig["read_only"] is True
        release_lease(tmp, fid, holder_id="user-a")
        sig2 = lease_read_only_signal(tmp, fid, viewer_id="user-b")
        assert sig2["read_only"] is False
        print("OK leases")

        assert (tmp / ".langflow" / "git-ops.log").is_file()
        print("OK ops log")
        print("OK verify_git_engine")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
