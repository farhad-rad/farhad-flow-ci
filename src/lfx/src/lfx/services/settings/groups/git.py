"""Git working-tree (flow SoT) settings for Desktop fork."""

from pathlib import Path
from typing import Any

from pydantic import BaseModel, field_validator


class GitSettings(BaseModel):
    """Settings for git-backed flow storage (FlowGitStore).

    Desktop defaults: git on; clone target is ``{config_dir}/flows-repo`` unless
    ``git_flows_dir`` is set. Prefer the welcome-screen setup wizard over env vars.

    Optional env (prefix ``LANGFLOW_``):
    - ``LANGFLOW_GIT_ENABLED`` (default True)
    - ``LANGFLOW_GIT_FLOWS_DIR`` (optional override; wizard uses config_dir/flows-repo)
    - ``LANGFLOW_GIT_AUTO_COMMIT`` (default False)
    - ``LANGFLOW_GIT_LEASE_TTL_SECONDS`` (optional, default 300)
    - ``LANGFLOW_GIT_AUTO_COMMIT_DEBOUNCE_MS`` (optional, default 1500)
    - ``LANGFLOW_GIT_PAT`` / ``LANGFLOW_GIT_TOKEN`` (optional fallback when keyring empty)
    """

    git_enabled: bool = True
    """When True, flow create/update/delete go disk-first under the flows repo
    (``git_flows_dir`` or ``{config_dir}/flows-repo``) after wizard clone."""

    git_flows_dir: str | None = None
    """Optional override for flows git root. Empty → ``{config_dir}/flows-repo``."""

    git_auto_commit: bool = False
    """When True, Save auto-commits after disk write (debounced; never auto-push).
    Default False — History page commit is explicit + path-selected."""
    git_auto_commit_debounce_ms: int = 1500
    """Debounce window for auto-commit (1–2s recommended)."""

    git_lease_ttl_seconds: int = 300
    """Lease TTL before stale; renew heartbeat should be shorter."""

    @field_validator("git_flows_dir", mode="before")
    @classmethod
    def expand_git_flows_dir(cls, value: Any) -> str | None:
        if value is None or value == "":
            return None
        path = Path(str(value)).expanduser()
        return str(path)
