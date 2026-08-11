"""Git-track encrypted Variable secrets under ``secrets/vars/<uuid>.json``."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import UUID

from langflow.services.flow_git.atomic import atomic_write
from langflow.services.flow_git.auto_commit import maybe_auto_commit_paths
from langflow.services.flow_git.canonical import sha256_raw
from langflow.services.flow_git.age_crypto import decrypt_json, encrypt_json
from langflow.services.flow_git.age_keys import load_encrypt_recipients, load_flow_ci_identity
from langflow.services.flow_git.exceptions import GitKeysNotUnlockedError

logger = logging.getLogger("langflow.flow_git")

SECRETS_DIRNAME = "secrets"
SECRETS_VARS_DIRNAME = "vars"
SECRETS_LOCK_NAME = "secrets.lock"
SECRETS_FILE_VERSION = 1
LOCK_VERSION = 1


def secrets_subdir(repo_root: Path) -> Path:
    return Path(repo_root) / SECRETS_DIRNAME


def secrets_vars_subdir(repo_root: Path) -> Path:
    return secrets_subdir(repo_root) / SECRETS_VARS_DIRNAME


def secrets_lock_path(repo_root: Path) -> Path:
    return Path(repo_root) / SECRETS_LOCK_NAME


def secret_relpath_for_id(variable_id: UUID | str) -> str:
    return f"{SECRETS_DIRNAME}/{SECRETS_VARS_DIRNAME}/{variable_id}.json"


def secret_path_for_id(repo_root: Path, variable_id: UUID | str) -> Path:
    return Path(repo_root) / secret_relpath_for_id(variable_id)


def ensure_secrets_layout(repo_root: Path) -> None:
    secrets_vars_subdir(repo_root).mkdir(parents=True, exist_ok=True)
    lock = secrets_lock_path(repo_root)
    if not lock.is_file():
        write_secrets_lock(repo_root, SecretsLock())


@dataclass
class SecretsLockEntry:
    path: str
    sha256: str
    name: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"path": self.path, "sha256": self.sha256}
        if self.name:
            out["name"] = self.name
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SecretsLockEntry:
        return cls(
            path=str(data["path"]),
            sha256=str(data["sha256"]),
            name=str(data["name"]) if data.get("name") else None,
        )


@dataclass
class SecretsLock:
    version: int = LOCK_VERSION
    secrets: dict[str, SecretsLockEntry] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "secrets": {sid: e.to_dict() for sid, e in sorted(self.secrets.items())},
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SecretsLock:
        version = int(data.get("version", LOCK_VERSION))
        raw = data.get("secrets") or {}
        secrets = {str(sid): SecretsLockEntry.from_dict(entry) for sid, entry in raw.items()}
        return cls(version=version, secrets=secrets)

    def set_secret(
        self,
        variable_id: UUID | str,
        *,
        rel_path: str,
        sha256: str,
        name: str | None = None,
    ) -> None:
        self.secrets[str(variable_id)] = SecretsLockEntry(
            path=rel_path,
            sha256=sha256,
            name=name,
        )

    def remove_secret(self, variable_id: UUID | str) -> None:
        self.secrets.pop(str(variable_id), None)


def read_secrets_lock(repo_root: Path) -> SecretsLock:
    path = secrets_lock_path(repo_root)
    if not path.exists():
        return SecretsLock()
    data = json.loads(path.read_text(encoding="utf-8"))
    return SecretsLock.from_dict(data)


def write_secrets_lock(repo_root: Path, lock: SecretsLock) -> None:
    lock.version = LOCK_VERSION
    text = json.dumps(lock.to_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    atomic_write(secrets_lock_path(repo_root), text.encode("utf-8"))


def secrets_lock_from_git_blob(raw: str | bytes | None) -> SecretsLock:
    if raw is None or raw == "":
        return SecretsLock()
    text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
    return SecretsLock.from_dict(json.loads(text))


def apply_selected_paths_to_secrets_lock(
    lock: SecretsLock,
    repo_root: Path,
    paths: list[str],
) -> SecretsLock:
    root = Path(repo_root)
    prefix = f"{SECRETS_DIRNAME}/{SECRETS_VARS_DIRNAME}/"
    for rel in paths:
        rel_n = rel.replace("\\", "/").lstrip("./")
        if rel_n == SECRETS_LOCK_NAME:
            continue
        if not rel_n.startswith(prefix) or not rel_n.endswith(".json"):
            continue
        stem = Path(rel_n).stem
        try:
            UUID(stem)
        except ValueError:
            continue
        abs_path = root / rel_n
        if abs_path.is_file():
            raw = abs_path.read_bytes()
            name = None
            try:
                meta = json.loads(raw.decode("utf-8"))
                if isinstance(meta.get("name"), str):
                    name = meta["name"]
            except Exception:  # noqa: BLE001
                name = None
            lock.set_secret(stem, rel_path=rel_n, sha256=sha256_raw(raw), name=name)
        else:
            lock.remove_secret(stem)
    return lock


def read_secret_display_name(repo_root: Path, rel_path: str, repo: Any | None = None) -> str | None:
    path = Path(repo_root) / rel_path
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            name = data.get("name")
            if isinstance(name, str) and name.strip():
                return name.strip()
        except Exception:  # noqa: BLE001
            pass
    if repo is not None:
        try:
            raw = repo.git.show(f"HEAD:{rel_path}")
            data = json.loads(raw)
            name = data.get("name")
            if isinstance(name, str) and name.strip():
                return name.strip()
        except Exception:  # noqa: BLE001
            pass
    return None


def variable_id_from_secret_path(path: str) -> str | None:
    rel = path.replace("\\", "/")
    prefix = f"{SECRETS_DIRNAME}/{SECRETS_VARS_DIRNAME}/"
    if not rel.startswith(prefix) or not rel.endswith(".json"):
        return None
    stem = Path(rel).stem
    try:
        UUID(stem)
    except ValueError:
        return None
    return stem


class SecretsGitStore:
    """Write encrypted Variable envelopes into the flows-repo tree."""

    def __init__(self, repo_root: Path | str, *, auto_commit: bool = False) -> None:
        self.repo_root = Path(repo_root).expanduser().resolve()
        self.auto_commit = auto_commit
        ensure_secrets_layout(self.repo_root)

    def write_variable(
        self,
        *,
        variable_id: UUID | str,
        name: str,
        type_: str | None,
        default_fields: list[str] | None,
        plaintext_value: str,
        updated_at: str | None = None,
    ) -> str:
        recipients = load_encrypt_recipients()
        if not recipients:
            raise GitKeysNotUnlockedError(
                "Age keys not unlocked — complete the git setup wizard keys step",
            )

        sealed = encrypt_json(
            {
                "id": str(variable_id),
                "name": name,
                "type": type_,
                "default_fields": list(default_fields or []),
                "value": plaintext_value,
            },
            recipients,
        )
        envelope: dict[str, Any] = {
            "version": SECRETS_FILE_VERSION,
            "id": str(variable_id),
            "name": name,
            "type": type_,
            "default_fields": list(default_fields or []),
            "updated_at": updated_at,
            **sealed,
        }
        data = json.dumps(envelope, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        data = data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        digest = sha256_raw(data)
        rel = secret_relpath_for_id(variable_id)
        path = self.repo_root / rel
        atomic_write(path, data)
        lock = read_secrets_lock(self.repo_root)
        lock.set_secret(variable_id, rel_path=rel, sha256=digest, name=name)
        write_secrets_lock(self.repo_root, lock)
        logger.info("secrets_git write id=%s name=%s sha256=%s", variable_id, name, digest)
        maybe_auto_commit_paths(
            repo_root=self.repo_root,
            message=f"secret: update {name} ({variable_id})",
            paths=[rel, SECRETS_LOCK_NAME],
            enabled=self.auto_commit,
        )
        return digest

    def delete_variable(self, variable_id: UUID | str, *, name: str | None = None) -> None:
        rel = secret_relpath_for_id(variable_id)
        path = self.repo_root / rel
        if path.is_file():
            path.unlink()
        lock = read_secrets_lock(self.repo_root)
        lock.remove_secret(variable_id)
        write_secrets_lock(self.repo_root, lock)
        label = name or str(variable_id)
        logger.info("secrets_git delete id=%s", variable_id)
        maybe_auto_commit_paths(
            repo_root=self.repo_root,
            message=f"secret: delete {label} ({variable_id})",
            paths=[rel, SECRETS_LOCK_NAME],
            enabled=self.auto_commit,
        )

    def list_secret_files(self) -> list[Path]:
        folder = secrets_vars_subdir(self.repo_root)
        if not folder.is_dir():
            return []
        return sorted(p for p in folder.glob("*.json") if p.is_file())

    def decrypt_file(self, path: Path, identity: str | None = None) -> dict[str, Any]:
        key = identity or load_flow_ci_identity()
        if not key:
            raise GitKeysNotUnlockedError(
                "Age keys not unlocked — cannot decrypt secrets",
            )
        envelope = json.loads(path.read_text(encoding="utf-8"))
        return decrypt_json(envelope, key)


def get_secrets_git_store() -> SecretsGitStore | None:
    from langflow.services.flow_git.setup import is_git_setup_complete, resolve_git_flows_dir
    from langflow.services.flow_git.store import is_git_sot_enabled
    from langflow.services.deps import get_settings_service

    if not is_git_sot_enabled() or not is_git_setup_complete():
        return None
    root = resolve_git_flows_dir()
    if root is None:
        return None
    auto = bool(getattr(get_settings_service().settings, "git_auto_commit", False))
    return SecretsGitStore(root, auto_commit=auto)
