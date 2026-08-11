"""Immutable production branch file under ``.langflow/production-branch``."""

from __future__ import annotations

from pathlib import Path

from langflow.services.flow_git.exceptions import ImmutablePathError, ProductionBranchGuardError

PRODUCTION_BRANCH_REL = ".langflow/production-branch"
IMMUTABLE_REL_PATHS = frozenset({PRODUCTION_BRANCH_REL, ".langflow/production-branch"})


def production_branch_path(repo_root: Path) -> Path:
    return Path(repo_root) / ".langflow" / "production-branch"


def read_production_branch(repo_root: Path) -> str | None:
    path = production_branch_path(repo_root)
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8").strip()
    return text or None


def ensure_production_branch_file(repo_root: Path, default: str = "production") -> str:
    """Create file with *default* if missing; never overwrite existing."""
    path = production_branch_path(repo_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.is_file():
        path.write_text(default + "\n", encoding="utf-8", newline="\n")
        return default
    return read_production_branch(repo_root) or default


def assert_not_immutable_path(rel_path: str) -> None:
    """Refuse modify/delete of production-branch (and aliases)."""
    norm = rel_path.replace("\\", "/").lstrip("./")
    if norm in IMMUTABLE_REL_PATHS or norm.endswith("/production-branch") and ".langflow" in norm:
        raise ImmutablePathError(
            f"Refusing to modify immutable path: {rel_path}",
            code="GIT_IMMUTABLE_PATH",
        )


def assert_not_pushing_production(repo_root: Path, head_branch: str | None) -> None:
    prod = read_production_branch(repo_root)
    if not prod or not head_branch:
        return
    if head_branch == prod:
        raise ProductionBranchGuardError(
            f"Push refused: HEAD is production branch '{prod}'. "
            "Checkout a working branch, then push. Never push production from Desktop.",
        )


def assert_checkout_allowed_dirty(*, dirty: bool, force: bool) -> None:
    if dirty and not force:
        from langflow.services.flow_git.exceptions import DirtyWorktreeError

        raise DirtyWorktreeError(
            "Uncommitted changes present. Commit/stash first, or pass force=true after UI prompt.",
        )
