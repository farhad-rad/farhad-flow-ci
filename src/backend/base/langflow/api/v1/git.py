"""REST API for Desktop git engine — ``/api/v1/git/*``."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from langflow.api.utils import CurrentActiveUser
from langflow.services.auth.utils import get_current_active_user
from langflow.services.flow_git.conflicts import clear_conflict, list_conflicts
from langflow.services.flow_git.age_keys import (
    keys_status,
    keys_unlocked,
    load_gitlab_host,
    load_keys_age_blob,
    load_keys_age_passphrase,
    store_gitlab_host,
    store_unlocked_keys,
)
from langflow.services.flow_git.credentials import clear_pat, pat_status, store_pat
from langflow.services.flow_git.detach import detach_git_install, expected_detach_confirm_name
from langflow.services.flow_git.detect import INSTALL_HINT, detect_git_binary
from langflow.services.flow_git.exceptions import (
    DirtyWorktreeError,
    GitAuthError,
    GitConflictError,
    GitKeysAgeMissingError,
    GitKeysNotUnlockedError,
    GitKeysUnlockFailedError,
    GitLayoutInvalidError,
    GitNotInstalledError,
    GitPushRejectedError,
    GitRepoNotFoundError,
    GitSotError,
    ImmutablePathError,
    LeaseHeldError,
    ProductionBranchGuardError,
)
from langflow.services.flow_git.leases import (
    acquire_lease,
    lease_read_only_signal,
    release_lease,
    renew_lease,
)
from langflow.services.flow_git.production_branch import read_production_branch
from langflow.services.flow_git.rebuild import hydrate_from_git
from langflow.services.flow_git.repo import GitRepoService, get_git_repo_service
from langflow.services.flow_git.setup import (
    KEYS_AGE_REL,
    assert_mandatory_layout,
    ensure_repo_layout,
    is_git_setup_complete,
    keys_age_path,
    prepare_clone_dest,
    resolve_git_flows_dir,
    validate_remote_branch,
    validate_repo_layout,
)
from langflow.services.flow_git.store import (
    get_flow_git_store,
    is_git_sot_enabled,
    refresh_flow_git_store,
)
router = APIRouter(prefix="/git", tags=["Git"], dependencies=[Depends(get_current_active_user)])


# --- schemas ---------------------------------------------------------------


class GitHealthResponse(BaseModel):
    git_enabled: bool
    git_binary_available: bool
    git_binary_path: str | None = None
    git_binary_version: str | None = None
    repo_configured: bool
    repo_is_git: bool
    setup_complete: bool = False
    layout: dict[str, Any] = Field(default_factory=dict)
    banner_code: str | None = None
    banner_message: str | None = None
    production_branch: str | None = None
    current_branch: str | None = None
    on_production: bool = False
    auto_commit: bool = False
    pat: dict[str, Any] = Field(default_factory=dict)
    keys: dict[str, Any] = Field(default_factory=dict)


class CloneRequest(BaseModel):
    url: str
    dest_dir: str | None = Field(
        default=None,
        description="Optional override; defaults to {config_dir}/flows-repo",
    )
    token: str | None = None
    branch: str | None = None


class SetupTestConnectionRequest(BaseModel):
    url: str
    token: str | None = None


class SetupInstallRequest(BaseModel):
    mode: Literal["existing", "fresh"] = "existing"
    project_id: int | None = None
    branch: str | None = None
    clone_url: str | None = None
    keys_passphrase: str | None = None
    force: bool = False
    # legacy fields (URL-only wizard)
    url: str | None = None
    token: str | None = None


class CommitRequest(BaseModel):
    message: str
    paths: list[str] | None = None
    author_name: str | None = None
    author_email: str | None = None


class DiscardRequest(BaseModel):
    paths: list[str] = Field(..., min_length=1)


class BranchCreateRequest(BaseModel):
    name: str
    checkout: bool = False
    start_point: str | None = None


class CheckoutRequest(BaseModel):
    name: str
    force: bool = False


class PullRequest(BaseModel):
    remote: str = "origin"
    strategy: Literal["merge", "ff-only", "rebase"] = "merge"
    token: str | None = None


class PushRequest(BaseModel):
    remote: str = "origin"
    branch: str | None = None
    token: str | None = None
    set_upstream: bool = True


class FetchRequest(BaseModel):
    remote: str = "origin"
    token: str | None = None


class SetupHostRequest(BaseModel):
    host: str


class SetupPatRequest(BaseModel):
    token: str


class SetupCreateProjectRequest(BaseModel):
    name: str
    namespace_id: int | None = None
    visibility: Literal["private", "internal", "public"] = "private"


class SetupValidateBranchRequest(BaseModel):
    project_id: int
    branch: str
    host: str | None = None


class CredentialsRequest(BaseModel):
    token: str


class DetachRequest(BaseModel):
    confirm: str = Field(
        ...,
        description="Must equal the short repository name (basename of project path).",
    )


class LeaseAcquireRequest(BaseModel):
    ttl_seconds: int | None = None
    steal: bool = False


class ConflictResolveRequest(BaseModel):
    action: Literal["take_ours", "take_theirs", "manual", "clear"] = "clear"
    content: str | None = Field(
        default=None,
        description="Required when action=manual — write this JSON to the flow file then clear conflict.",
    )


# --- helpers ---------------------------------------------------------------


def _http_from_git(exc: Exception) -> HTTPException:
    if isinstance(exc, GitNotInstalledError):
        return HTTPException(
            status_code=503,
            detail={"code": exc.code, "message": str(exc), "banner_code": "GIT_NOT_INSTALLED"},
        )
    if isinstance(exc, ProductionBranchGuardError | ImmutablePathError | DirtyWorktreeError):
        return HTTPException(status_code=409, detail={"code": exc.code, "message": str(exc)})
    if isinstance(exc, GitConflictError | GitPushRejectedError):
        return HTTPException(status_code=409, detail={"code": exc.code, "message": str(exc)})
    if isinstance(exc, LeaseHeldError):
        return HTTPException(status_code=409, detail={"code": exc.code, "message": str(exc)})
    if isinstance(exc, GitAuthError):
        return HTTPException(status_code=401, detail={"code": exc.code, "message": str(exc)})
    if isinstance(exc, GitRepoNotFoundError):
        return HTTPException(status_code=404, detail={"code": exc.code, "message": str(exc)})
    if isinstance(exc, GitSotError):
        return HTTPException(status_code=400, detail={"code": exc.code, "message": str(exc)})
    return HTTPException(status_code=500, detail={"code": "GIT_INTERNAL", "message": str(exc)})


def _require_service() -> GitRepoService:
    if not is_git_sot_enabled():
        raise HTTPException(status_code=400, detail={"code": "GIT_DISABLED", "message": "Git SoT disabled"})
    if not is_git_setup_complete():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "GIT_SETUP_REQUIRED",
                "message": "Complete the git connection wizard before using git operations.",
            },
        )
    svc = get_git_repo_service()
    if svc is None:
        store = get_flow_git_store()
        root = store.repo_root if store else None
        raise HTTPException(
            status_code=400,
            detail={
                "code": "GIT_REPO_NOT_FOUND",
                "message": f"Not a git repository (or git SoT inactive): {root}. Complete setup wizard first.",
            },
        )
    return svc


def _repo_root() -> Path:
    store = get_flow_git_store()
    if store is None:
        raise HTTPException(status_code=400, detail={"code": "GIT_DISABLED", "message": "git SoT inactive"})
    return store.repo_root


def _gitlab_setup_client(host: str | None = None):
    from langflow.services.flow_git.gitlab_client import GitLabClient

    resolved = (host or load_gitlab_host() or "").strip()
    if not resolved:
        raise HTTPException(
            status_code=400,
            detail={"code": "GIT_HOST_UNSET", "message": "Configure GitLab host first"},
        )
    try:
        return GitLabClient.from_host(resolved)
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


def _unlock_keys_from_repo(repo_root: Path, passphrase: str | None) -> dict[str, Any]:
    from langflow.services.flow_git.exceptions import GitKeysUnlockFailedError
    from langflow.services.flow_git.keys_age import validate_and_unlock

    blob_path = keys_age_path(repo_root)
    if not blob_path.is_file():
        raise GitKeysAgeMissingError(f"Missing mandatory file: {KEYS_AGE_REL}")
    pwd = (passphrase or load_keys_age_passphrase() or "").strip()
    if not pwd:
        raise GitKeysNotUnlockedError("Passphrase required to unlock keys.age")
    try:
        material = validate_and_unlock(blob_path.read_bytes(), pwd)
        stored = store_unlocked_keys(material)
    except ValueError as exc:
        raise GitKeysUnlockFailedError(str(exc)) from exc
    return {"ok": True, "stored": stored}


def _init_fresh_repo_and_push(
    dest: Path,
    clone_url: str,
    *,
    token: str | None,
    branch: str,
) -> GitRepoService:
    from langflow.services.flow_git.repo import _auth_url, _import_git

    git = _import_git()
    dest.mkdir(parents=True, exist_ok=True)
    repo = git.Repo.init(str(dest))
    auth = _auth_url(clone_url, token)
    if "origin" not in [r.name for r in repo.remotes]:
        repo.create_remote("origin", auth)
    else:
        repo.remotes.origin.set_url(auth)
    repo.git.add("-A")
    repo.index.commit("Initial Langflow git SoT scaffold")
    repo.git.push("-u", "origin", branch)
    return GitRepoService(dest)


# --- routes ----------------------------------------------------------------


@router.get("/health", response_model=GitHealthResponse)
async def git_health():
    """Git binary + repo readiness. FE can poll for install banner / force wizard."""
    binary = detect_git_binary()
    enabled = is_git_sot_enabled()
    root = resolve_git_flows_dir()
    layout = validate_repo_layout(root)
    store = get_flow_git_store() if enabled else None
    repo_is_git = bool(layout["checks"].get("is_git"))
    setup_complete = bool(layout.get("ready"))
    banner_code = binary.banner_code if not binary.available else None
    banner_message = binary.message if not binary.available else None
    if enabled and not root:
        banner_code = banner_code or "GIT_FLOWS_DIR_UNSET"
        banner_message = banner_message or "Could not resolve flows repo path (config_dir missing)."
    elif enabled and not setup_complete and binary.available:
        banner_code = banner_code or "GIT_SETUP_REQUIRED"
        missing = ", ".join(layout.get("missing") or []) or "incomplete"
        banner_message = banner_message or f"Connect a flows git repo to continue (missing: {missing})."

    prod = layout.get("production_branch")
    current = None
    on_prod = False
    if repo_is_git and binary.available and root:
        try:
            svc = GitRepoService.open(root)
            current = svc.current_branch()
            on_prod = bool(prod and current == prod)
        except Exception:  # noqa: BLE001
            pass

    auto = False
    if store is not None:
        auto = bool(store.auto_commit)

    return GitHealthResponse(
        git_enabled=enabled,
        git_binary_available=binary.available,
        git_binary_path=binary.path,
        git_binary_version=binary.version,
        repo_configured=bool(root),
        repo_is_git=repo_is_git,
        setup_complete=setup_complete,
        layout=layout,
        banner_code=banner_code,
        banner_message=banner_message or (INSTALL_HINT if not binary.available else None),
        production_branch=prod,
        current_branch=current,
        on_production=on_prod,
        auto_commit=auto,
        pat=pat_status(),
        keys=keys_status(),
    )


@router.get("/setup/status")
async def git_setup_status():
    """Wizard gate: ready when cloned repo has required layout files."""
    binary = detect_git_binary()
    root = resolve_git_flows_dir()
    layout = validate_repo_layout(root)
    return {
        "ready": bool(layout.get("ready")),
        "git_enabled": is_git_sot_enabled(),
        "git_binary_available": binary.available,
        "git_binary_version": binary.version,
        "dest_dir": str(root) if root else None,
        "pat": pat_status(),
        "keys": keys_status(),
        **layout,
    }


@router.post("/setup/test-connection")
async def git_setup_test_connection(body: SetupTestConnectionRequest):
    try:
        if body.token:
            store_pat(body.token)
        result = GitRepoService.test_connection(body.url, token=body.token)
        return result
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/setup/host")
async def git_setup_host(body: SetupHostRequest):
    try:
        return store_gitlab_host(body.host)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "GIT_HOST_BAD", "message": str(exc)}) from exc


@router.post("/setup/pat")
async def git_setup_pat(body: SetupPatRequest):
    try:
        return store_pat(body.token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/setup/projects")
async def git_setup_list_projects(search: str | None = None, page: int = 1):
    try:
        client = _gitlab_setup_client()
        items = client.list_projects(search=search, page=page)
        return {"items": items, "host": load_gitlab_host()}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/setup/namespaces")
async def git_setup_list_namespaces(page: int = 1):
    try:
        client = _gitlab_setup_client()
        return {"items": client.list_namespaces(page=page), "host": load_gitlab_host()}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/setup/projects")
async def git_setup_create_project(body: SetupCreateProjectRequest):
    try:
        client = _gitlab_setup_client()
        project = client.create_project(
            body.name,
            namespace_id=body.namespace_id,
            visibility=body.visibility,
            initialize_with_readme=False,
        )
        return {"ok": True, "project": project}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/setup/projects/{project_id}/branches")
async def git_setup_list_branches(project_id: int, page: int = 1):
    try:
        client = _gitlab_setup_client()
        branches = client.list_branches(project_id, page=page)
        return {"items": branches, "project_id": project_id}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/setup/validate-branch")
async def git_setup_validate_branch(body: SetupValidateBranchRequest):
    try:
        host = body.host or load_gitlab_host()
        if not host:
            raise HTTPException(
                status_code=400,
                detail={"code": "GIT_HOST_UNSET", "message": "GitLab host required"},
            )
        result = validate_remote_branch(host, body.project_id, body.branch)
        if not result.get("ok"):
            raise GitLayoutInvalidError(
                f"Branch missing mandatory files: {', '.join(result.get('missing') or [])}",
            )
        return result
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/setup/keys-status")
async def git_setup_keys_status():
    return keys_status()


@router.post("/setup/unlock-keys")
async def git_setup_unlock_keys(
    keys_age: UploadFile = File(...),
    passphrase: str = Form(...),
):
    """Validate uploaded keys.age + passphrase; store age keys in OS keyring."""
    from langflow.services.flow_git.exceptions import GitKeysUnlockFailedError
    from langflow.services.flow_git.keys_age import MAX_KEYS_AGE_BYTES, validate_and_unlock

    try:
        blob = await keys_age.read()
        if len(blob) > MAX_KEYS_AGE_BYTES:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "GIT_KEYS_AGE_TOO_LARGE",
                    "message": f"keys.age exceeds {MAX_KEYS_AGE_BYTES} bytes",
                },
            )
        material = validate_and_unlock(blob, passphrase)
        stored = store_unlocked_keys(material)
        return {"ok": True, "stored": stored, "keys": keys_status()}
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "GIT_KEYS_UNLOCK_FAILED", "message": str(exc)},
        ) from exc
    except GitKeysUnlockFailedError as exc:
        raise _http_from_git(exc) from exc


@router.post("/setup/install")
async def git_setup_install(body: SetupInstallRequest):
    """Clone or init flows repo, unlock keys.age, scaffold layout, hydrate DB."""
    try:
        root = resolve_git_flows_dir()
        if root is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "GIT_DISABLED",
                    "message": "Git SoT disabled or config_dir unavailable.",
                },
            )
        binary = detect_git_binary()
        if not binary.available:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "GIT_NOT_INSTALLED",
                    "message": binary.message or INSTALL_HINT,
                    "banner_code": "GIT_NOT_INSTALLED",
                },
            )

        if body.token:
            store_pat(body.token)

        clone_url = (body.clone_url or body.url or "").strip()
        branch = (body.branch or ("main" if body.mode == "fresh" else None) or "").strip() or None

        already = (root / ".git").exists()
        if already and not body.force and body.mode == "existing":
            assert_mandatory_layout(root)
            _unlock_keys_from_repo(root, body.keys_passphrase)
            layout = ensure_repo_layout(root, mode="existing")
            refresh_flow_git_store()
            hydrate = await hydrate_from_git(mode="full") if layout.get("ready") else None
            return {
                "ok": True,
                "cloned": False,
                "reused_existing": True,
                "repo_root": str(root),
                "hydrate": hydrate,
                **layout,
            }

        if body.mode == "fresh":
            if not keys_unlocked():
                raise GitKeysNotUnlockedError(
                    "Unlock keys.age first via POST /setup/unlock-keys",
                )
            keys_blob = load_keys_age_blob()
            if keys_blob is None:
                raise GitKeysNotUnlockedError("keys.age blob missing from keyring — re-upload keys.age")

            if not clone_url and body.project_id is not None:
                client = _gitlab_setup_client()
                project = client.get_project(body.project_id)
                clone_url = str(project.get("http_url_to_repo") or project.get("ssh_url_to_repo") or "").strip()
            if not clone_url:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "GIT_URL_REQUIRED", "message": "clone_url or project_id required"},
                )

            prod_branch = branch or "main"
            prepare_clone_dest(root, force=body.force)
            layout = ensure_repo_layout(
                root,
                mode="fresh",
                keys_age_blob=keys_blob,
                production_branch=prod_branch,
            )
            svc = _init_fresh_repo_and_push(
                root,
                clone_url,
                token=body.token,
                branch=prod_branch,
            )
            refresh_flow_git_store()
            hydrate = await hydrate_from_git(mode="full")
            return {
                "ok": True,
                "cloned": True,
                "reused_existing": False,
                "mode": "fresh",
                "repo_root": str(svc.repo_root),
                "branch": svc.current_branch(),
                "hydrate": hydrate,
                **layout,
            }

        # existing mode — clone remote branch
        host = load_gitlab_host()
        if body.project_id is not None and branch and host:
            remote_check = validate_remote_branch(host, body.project_id, branch)
            if not remote_check.get("ok"):
                raise GitLayoutInvalidError(
                    f"Remote branch missing mandatory files: {', '.join(remote_check.get('missing') or [])}",
                )

        if not clone_url:
            if body.project_id is not None:
                client = _gitlab_setup_client()
                project = client.get_project(body.project_id)
                clone_url = str(project.get("http_url_to_repo") or project.get("ssh_url_to_repo") or "").strip()
            if not clone_url:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "GIT_URL_REQUIRED", "message": "clone_url or project_id required"},
                )

        prepare_clone_dest(root, force=body.force)
        if (root / ".git").exists() and body.force:
            prepare_clone_dest(root, force=True)

        svc = GitRepoService.clone(clone_url, root, token=body.token, branch=branch)
        assert_mandatory_layout(svc.repo_root)
        unlock = _unlock_keys_from_repo(svc.repo_root, body.keys_passphrase)
        layout = ensure_repo_layout(svc.repo_root, mode="existing")
        refresh_flow_git_store()
        hydrate = await hydrate_from_git(mode="full")
        return {
            "ok": True,
            "cloned": True,
            "reused_existing": False,
            "mode": "existing",
            "repo_root": str(svc.repo_root),
            "branch": svc.current_branch(),
            "unlock": unlock,
            "hydrate": hydrate,
            **layout,
        }
    except HTTPException:
        raise
    except FileExistsError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "GIT_DEST_NOT_EMPTY", "message": str(exc)},
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/clone")
async def git_clone(body: CloneRequest):
    try:
        dest = body.dest_dir
        if not dest:
            root = resolve_git_flows_dir()
            if root is None:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "GIT_FLOWS_DIR_UNSET",
                        "message": "Could not resolve clone destination (config_dir missing).",
                    },
                )
            dest = str(root)
        prepare_clone_dest(Path(dest), force=False)
        svc = GitRepoService.clone(body.url, dest, token=body.token, branch=body.branch)
        if body.token:
            store_pat(body.token)
        refresh_flow_git_store()
        return {"ok": True, "repo_root": str(svc.repo_root), "branch": svc.current_branch()}
    except HTTPException:
        raise
    except FileExistsError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "GIT_DEST_NOT_EMPTY", "message": str(exc)},
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/status")
async def git_status():
    try:
        svc = _require_service()
        return svc.status().to_dict()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/diff")
async def git_diff(
    flow_id: UUID | None = None,
    path: str | None = None,
    staged: bool = False,
):
    try:
        svc = _require_service()
        if path:
            text = svc.diff_path(path, staged=staged)
            from langflow.services.flow_git.repo import _entry_display_name

            display = _entry_display_name(svc.repo_root, path, svc._get_repo())
            return {
                "diff": text,
                "path": path,
                "flow_id": str(flow_id) if flow_id else None,
                "flow_name": display,
            }
        text = svc.diff(flow_id, staged=staged)
        flow_name = None
        rel = None
        if flow_id is not None:
            from langflow.services.flow_git.paths import flow_relpath_for_id
            from langflow.services.flow_git.repo import _read_flow_name

            rel = flow_relpath_for_id(flow_id)
            flow_name = _read_flow_name(svc.repo_root, rel, svc._get_repo())
        return {
            "diff": text,
            "flow_id": str(flow_id) if flow_id else None,
            "flow_name": flow_name,
            "path": rel,
        }
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/commit")
async def git_commit(body: CommitRequest):
    try:
        svc = _require_service()
        return svc.commit(
            body.paths,
            body.message,
            author_name=body.author_name,
            author_email=body.author_email,
            skip_whitespace_only=False,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/discard")
async def git_discard(body: DiscardRequest):
    """Discard local changes for the given relative paths and sync DB cache to disk."""
    try:
        svc = _require_service()
        result = svc.discard(body.paths)
        try:
            from langflow.services.flow_git.rebuild import sync_sqlite_after_discard

            db_sync = await sync_sqlite_after_discard(result.get("discarded") or body.paths)
            result["db_sync"] = db_sync
            if db_sync.get("errors"):
                from lfx.log.logger import logger as _logger

                await _logger.awarning(
                    "git discard db_sync errors: %s",
                    db_sync["errors"],
                )
        except Exception as sync_exc:  # noqa: BLE001
            # Disk discard already succeeded; surface DB sync failure without rolling back git.
            result["db_sync"] = {"upserted": [], "deleted": [], "errors": [str(sync_exc)]}
        try:
            refresh_flow_git_store()
        except Exception:  # noqa: BLE001
            pass
        return result
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/branches")
async def git_list_branches():
    try:
        svc = _require_service()
        return {"branches": svc.list_branches(), "production_branch": svc.production_branch()}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/branches")
async def git_create_branch(body: BranchCreateRequest):
    try:
        svc = _require_service()
        return svc.create_branch(
            body.name,
            checkout=body.checkout,
            start_point=body.start_point,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/branches/checkout")
async def git_checkout(body: CheckoutRequest):
    try:
        svc = _require_service()
        result = svc.checkout(body.name, force=body.force)
        hydrate = await hydrate_from_git()
        return {**result, "hydrate": hydrate}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.delete("/branches/{name}")
async def git_delete_branch(name: str, force: bool = False):
    try:
        svc = _require_service()
        return svc.delete_branch(name, force=force)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/branches/sync")
async def git_sync_branches(body: FetchRequest | None = None):
    """Delete all local branches except current, then fetch --prune from remote."""
    try:
        svc = _require_service()
        body = body or FetchRequest()
        return svc.sync_branches_from_remote(body.remote, token=body.token)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/fetch")
async def git_fetch(body: FetchRequest | None = None):
    body = body or FetchRequest()
    try:
        svc = _require_service()
        return svc.fetch(body.remote, token=body.token)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/pull")
async def git_pull(body: PullRequest | None = None):
    body = body or PullRequest()
    try:
        svc = _require_service()
        result = svc.pull(remote=body.remote, strategy=body.strategy, token=body.token)
        hydrate = await hydrate_from_git()
        return {**result, "hydrate": hydrate}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/push")
async def git_push(body: PushRequest | None = None):
    body = body or PushRequest()
    try:
        svc = _require_service()
        return svc.push(
            remote=body.remote,
            branch=body.branch,
            token=body.token,
            set_upstream=body.set_upstream,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/production-branch")
async def git_production_branch():
    root = _repo_root()
    name = read_production_branch(root)
    return {
        "path": ".langflow/production-branch",
        "name": name,
        "immutable": True,
        "note": "Desktop refuses modify/delete of this file and refuses push when HEAD equals this branch.",
    }


@router.get("/credentials")
async def git_credentials_status():
    return pat_status()


@router.post("/credentials")
async def git_credentials_store(body: CredentialsRequest):
    try:
        return store_pat(body.token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/credentials")
async def git_credentials_clear():
    return clear_pat()


@router.post("/secrets/sync")
async def git_secrets_sync(current_user: CurrentActiveUser):
    """Encrypt all DB Variables into ``secrets/vars/*.json`` (requires unlocked age keys)."""
    from langflow.services.flow_git.secrets_sync import sync_all_variables_to_git

    try:
        return await sync_all_variables_to_git(user_id=current_user.id)
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/secrets/apply")
async def git_secrets_apply(current_user: CurrentActiveUser):
    """Decrypt secrets tree with flow-ci.key → upsert Variables."""
    from langflow.services.flow_git.secrets_sync import apply_secrets_from_git

    try:
        return await apply_secrets_from_git(user_id=current_user.id)
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/setup/detach-info")
async def git_setup_detach_info():
    root = resolve_git_flows_dir()
    try:
        name = expected_detach_confirm_name(root)
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc
    return {
        "confirm_name": name,
        "repo_root": str(root) if root else None,
        "ready_to_detach": bool(name),
    }


@router.post("/setup/detach")
async def git_setup_detach(body: DetachRequest):
    """Detach git: wipe clone + DB flows + PAT + age keys → setup wizard."""
    try:
        return await detach_git_install(confirm=body.confirm)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "GIT_DETACH_CONFIRM", "message": str(exc)},
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


# --- leases ----------------------------------------------------------------


@router.get("/leases/{flow_id}")
async def git_lease_get(flow_id: UUID, current_user: CurrentActiveUser):
    root = _repo_root()
    signal = lease_read_only_signal(root, flow_id, viewer_id=str(current_user.id))
    return signal


@router.post("/leases/{flow_id}/acquire")
async def git_lease_acquire(
    flow_id: UUID,
    current_user: CurrentActiveUser,
    body: LeaseAcquireRequest | None = None,
):
    body = body or LeaseAcquireRequest()
    root = _repo_root()
    try:
        lease = acquire_lease(
            root,
            flow_id,
            holder_id=str(current_user.id),
            holder_name=getattr(current_user, "username", None),
            ttl_seconds=body.ttl_seconds,
            steal=body.steal,
        )
        return lease.to_dict()
    except LeaseHeldError as exc:
        raise _http_from_git(exc) from exc


@router.post("/leases/{flow_id}/renew")
async def git_lease_renew(
    flow_id: UUID,
    current_user: CurrentActiveUser,
    body: LeaseAcquireRequest | None = None,
):
    body = body or LeaseAcquireRequest()
    root = _repo_root()
    try:
        lease = renew_lease(
            root,
            flow_id,
            holder_id=str(current_user.id),
            ttl_seconds=body.ttl_seconds,
        )
        return lease.to_dict()
    except LeaseHeldError as exc:
        raise _http_from_git(exc) from exc


@router.post("/leases/{flow_id}/release")
async def git_lease_release(flow_id: UUID, current_user: CurrentActiveUser, force: bool = False):
    root = _repo_root()
    try:
        release_lease(root, flow_id, holder_id=str(current_user.id), force=force)
        return {"released": True, "flow_id": str(flow_id)}
    except LeaseHeldError as exc:
        raise _http_from_git(exc) from exc


# --- conflicts -------------------------------------------------------------


@router.get("/conflicts")
async def git_conflicts_list():
    root = _repo_root()
    return {"conflicts": list_conflicts(root)}


@router.get("/conflicts/{flow_id}")
async def git_conflict_detail(flow_id: UUID):
    """3-way viewer payload: meta + ours/theirs/base text (JSON tabs)."""
    from langflow.services.flow_git.conflicts import conflict_flow_dir

    root = _repo_root()
    cdir = conflict_flow_dir(root, flow_id)
    meta_path = cdir / "meta.json"
    if not meta_path.is_file():
        raise HTTPException(status_code=404, detail={"code": "GIT_NO_CONFLICT", "message": "No conflict stored"})

    def _read(name: str) -> str | None:
        p = cdir / name
        if not p.is_file():
            return None
        return p.read_text(encoding="utf-8")

    import json

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        meta = {"flow_id": str(flow_id)}

    return {
        "meta": meta,
        "ours": _read("ours.json"),
        "theirs": _read("theirs.json"),
        "base": _read("base.json"),
    }


@router.post("/conflicts/{flow_id}/resolve")
async def git_conflict_resolve(flow_id: UUID, body: ConflictResolveRequest):
    """Resolve: take_ours / take_theirs / manual(content) / clear. User must commit."""
    from langflow.services.flow_git.atomic import atomic_write
    from langflow.services.flow_git.conflicts import conflict_flow_dir
    from langflow.services.flow_git.paths import flow_path_for_id

    root = _repo_root()
    cdir = conflict_flow_dir(root, flow_id)
    if not cdir.is_dir():
        raise HTTPException(status_code=404, detail={"code": "GIT_NO_CONFLICT", "message": "No conflict stored"})

    target = flow_path_for_id(root, flow_id)
    if body.action == "take_ours":
        src = cdir / "ours.json"
        if not src.exists():
            raise HTTPException(status_code=404, detail="ours.json missing")
        atomic_write(target, src.read_bytes())
    elif body.action == "take_theirs":
        src = cdir / "theirs.json"
        if not src.exists():
            raise HTTPException(status_code=404, detail="theirs.json missing")
        atomic_write(target, src.read_bytes())
    elif body.action == "manual":
        if body.content is None:
            raise HTTPException(
                status_code=400,
                detail={"code": "GIT_MANUAL_CONTENT_REQUIRED", "message": "content required for action=manual"},
            )
        text = body.content if body.content.endswith("\n") else body.content + "\n"
        atomic_write(target, text.encode("utf-8"))
    # clear always after take_* / manual / clear
    clear_conflict(root, flow_id)
    return {"resolved": True, "flow_id": str(flow_id), "action": body.action, "note": "Commit manually or auto-commit on Save."}


@router.get("/ops-log")
async def git_ops_log_tail(limit: int = 50):
    from langflow.services.flow_git.ops_log import ops_log_path

    root = _repo_root()
    path = ops_log_path(root)
    if not path.is_file():
        return {"lines": []}
    lines = path.read_text(encoding="utf-8").splitlines()
    return {"lines": lines[-max(1, min(limit, 500)) :]}


@router.get("/remote")
async def git_remote():
    """Origin remote + parsed GitLab project meta; enrich with display name when PAT present."""
    try:
        from langflow.services.flow_git.gitlab_client import (
            GitLabClient,
            parse_remote_url,
            redact_remote_url,
        )

        svc = _require_service()
        url = svc.remote_url("origin")
        if not url:
            return {"configured": False, "url": None}
        safe = redact_remote_url(url)
        try:
            meta = parse_remote_url(url)
        except Exception as exc:  # noqa: BLE001
            return {"configured": True, "url": safe, "parse_error": str(exc)}
        out: dict = {"configured": True, "url": safe, **meta}
        # Prefer GitLab display name + namespace group → e.g. the-zee/LfxFlows
        if meta.get("provider") == "gitlab":
            try:
                proj = GitLabClient(url).get_project()
                name = (proj.get("name") or "").strip()
                path_ns = (proj.get("path_with_namespace") or meta.get("project_path") or "").strip()
                namespace = path_ns.rsplit("/", 1)[0] if "/" in path_ns else ""
                if name and namespace:
                    out["project_name"] = name
                    out["namespace"] = namespace
                    out["display_path"] = f"{namespace}/{name}"
                elif name:
                    out["project_name"] = name
                    out["display_path"] = name
                if proj.get("web_url"):
                    out["web_url"] = str(proj["web_url"])
            except Exception:  # noqa: BLE001 — PAT missing / offline: keep parsed meta
                pass
        return out
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/log")
async def git_log(max_count: int = 40, graph: bool = True):
    try:
        svc = _require_service()
        return svc.log(max_count=max_count, graph=graph)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/log/{sha}")
async def git_log_commit(sha: str):
    try:
        svc = _require_service()
        return svc.show_commit(sha)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


# --- GitLab merge requests -------------------------------------------------


def _gitlab_client():
    from langflow.services.flow_git.gitlab_client import GitLabClient

    svc = _require_service()
    url = svc.remote_url("origin")
    if not url:
        raise HTTPException(
            status_code=400,
            detail={"code": "GIT_REMOTE_EMPTY", "message": "No origin remote"},
        )
    return GitLabClient(url)


class MrCreateRequest(BaseModel):
    source_branch: str
    target_branch: str
    title: str
    description: str | None = None
    remove_source_branch: bool = False
    draft: bool = False


class MrUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    target_branch: str | None = None


class MrMergeRequest(BaseModel):
    squash: bool = False
    should_remove_source_branch: bool = False
    merge_when_pipeline_succeeds: bool = False


class MrNoteRequest(BaseModel):
    body: str


class MrConflictResolveRequest(BaseModel):
    path: str
    content: str


class MrConflictFinishRequest(BaseModel):
    message: str
    push: bool = True


@router.get("/merge-requests")
async def list_merge_requests(state: str = "opened", page: int = 1, per_page: int = 50):
    try:
        client = _gitlab_client()
        items = client.list_merge_requests(state=state, page=page, per_page=per_page)
        return {"items": items, "remote": client.meta}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/merge-requests")
async def create_merge_request(body: MrCreateRequest):
    try:
        client = _gitlab_client()
        assignee_id = None
        try:
            user = client.current_user()
            raw_id = user.get("id")
            if raw_id is not None:
                assignee_id = int(raw_id)
        except Exception:  # noqa: BLE001 — still create MR if /user fails
            assignee_id = None
        mr = client.create_merge_request(
            source_branch=body.source_branch,
            target_branch=body.target_branch,
            title=body.title,
            description=body.description,
            remove_source_branch=body.remove_source_branch,
            assignee_id=assignee_id,
            draft=body.draft,
        )
        return mr
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/merge-requests/{iid}")
async def get_merge_request(iid: int):
    try:
        client = _gitlab_client()
        return client.get_merge_request(iid)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.put("/merge-requests/{iid}")
async def update_merge_request(iid: int, body: MrUpdateRequest):
    try:
        client = _gitlab_client()
        fields = {k: v for k, v in body.model_dump().items() if v is not None}
        if not fields:
            raise HTTPException(status_code=400, detail={"code": "EMPTY", "message": "No fields to update"})
        return client.update_merge_request(iid, **fields)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.put("/merge-requests/{iid}/merge")
async def merge_merge_request(iid: int, body: MrMergeRequest | None = None):
    try:
        client = _gitlab_client()
        opts = body or MrMergeRequest()
        return client.merge_merge_request(
            iid,
            squash=opts.squash,
            should_remove_source_branch=opts.should_remove_source_branch,
            merge_when_pipeline_succeeds=opts.merge_when_pipeline_succeeds,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/merge-requests/{iid}/close")
async def close_merge_request(iid: int):
    try:
        return _gitlab_client().close_merge_request(iid)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/merge-requests/{iid}/reopen")
async def reopen_merge_request(iid: int):
    try:
        return _gitlab_client().reopen_merge_request(iid)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/merge-requests/{iid}/changes")
async def merge_request_changes(iid: int):
    try:
        return _gitlab_client().changes(iid)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/merge-requests/{iid}/notes")
async def merge_request_notes(iid: int):
    try:
        return {"notes": _gitlab_client().list_notes(iid)}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/merge-requests/{iid}/notes")
async def create_merge_request_note(iid: int, body: MrNoteRequest):
    try:
        if not body.body.strip():
            raise HTTPException(status_code=400, detail={"code": "EMPTY", "message": "Note body required"})
        return _gitlab_client().create_note(iid, body.body.strip())
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


# --- MR conflict resolution (merge target into source) ---------------------


@router.post("/merge-requests/{iid}/conflicts/prepare")
async def prepare_merge_request_conflicts(iid: int):
    """Checkout source, merge origin/target. Return conflict paths if any."""
    try:
        client = _gitlab_client()
        mr = client.get_merge_request(iid)
        source = str(mr.get("source_branch") or "").strip()
        target = str(mr.get("target_branch") or "").strip()
        if not source or not target:
            raise HTTPException(
                status_code=400,
                detail={"code": "MR_BRANCHES", "message": "MR missing source/target"},
            )
        svc = _require_service()
        result = svc.prepare_mr_merge(source_branch=source, target_branch=target)
        return {**result, "iid": iid}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/merge-requests/{iid}/conflicts")
async def list_merge_request_conflicts(iid: int):
    try:
        svc = _require_service()
        paths = svc.list_unmerged_paths()
        return {"iid": iid, "conflict_paths": paths, "has_conflicts": bool(paths)}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.get("/merge-requests/{iid}/conflicts/file")
async def merge_request_conflict_file(iid: int, path: str):
    try:
        svc = _require_service()
        return {"iid": iid, **svc.conflict_file_sides(path)}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/merge-requests/{iid}/conflicts/resolve")
async def resolve_merge_request_conflict(iid: int, body: MrConflictResolveRequest):
    try:
        svc = _require_service()
        return {"iid": iid, **svc.write_resolved_path(body.path, body.content)}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/merge-requests/{iid}/conflicts/finish")
async def finish_merge_request_conflicts(iid: int, body: MrConflictFinishRequest):
    """Commit merge resolution and optionally push source branch."""
    try:
        client = _gitlab_client()
        mr = client.get_merge_request(iid)
        source = str(mr.get("source_branch") or "").strip()
        svc = _require_service()
        committed = svc.commit_merge_resolution(body.message)
        pushed = None
        if body.push:
            pushed = svc.push(branch=source or None)
        return {"iid": iid, "commit": committed, "push": pushed}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc


@router.post("/merge-requests/{iid}/conflicts/abort")
async def abort_merge_request_conflicts(iid: int):
    try:
        svc = _require_service()
        return {"iid": iid, **svc.abort_mr_merge()}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _http_from_git(exc) from exc
