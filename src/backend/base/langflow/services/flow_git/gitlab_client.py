"""GitLab REST helpers for Desktop merge-request UI and setup wizard (PAT from keyring)."""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import quote, urlparse, urlunparse

import httpx

from langflow.services.flow_git.age_keys import load_gitlab_host, normalize_gitlab_host
from langflow.services.flow_git.credentials import load_pat
from langflow.services.flow_git.exceptions import GitAuthError, GitSotError

logger = logging.getLogger("langflow.flow_git")

_SSH_RE = re.compile(r"^git@([^:]+):(.+?)(?:\.git)?$")
_TIMEOUT = 45.0


def redact_remote_url(url: str) -> str:
    """Strip embedded userinfo (e.g. oauth2:TOKEN@) from clone URLs."""
    raw = (url or "").strip()
    if not raw:
        return raw
    m = _SSH_RE.match(raw)
    if m:
        return raw
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return raw
    netloc = parsed.hostname
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunparse((parsed.scheme, netloc, parsed.path, "", "", ""))


def parse_remote_url(url: str) -> dict[str, str]:
    """Return ``{provider, host, api_base, project_path, web_url, clone_url}``."""
    raw = (url or "").strip()
    if not raw:
        raise GitSotError("Remote URL empty", code="GIT_REMOTE_EMPTY")

    host = ""
    project_path = ""
    scheme = "https"

    m = _SSH_RE.match(raw)
    if m:
        host = m.group(1)
        project_path = m.group(2).strip("/")
    else:
        parsed = urlparse(raw)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise GitSotError(f"Unsupported remote URL: {raw}", code="GIT_REMOTE_BAD")
        scheme = parsed.scheme
        host = parsed.hostname
        path = (parsed.path or "").strip("/")
        if path.endswith(".git"):
            path = path[:-4]
        project_path = path

    if not host or not project_path:
        raise GitSotError(f"Cannot parse remote: {raw}", code="GIT_REMOTE_BAD")

    provider = "gitlab"
    if host.endswith("github.com"):
        provider = "github"

    api_base = f"{scheme}://{host}/api/v4"
    web_url = f"{scheme}://{host}/{project_path}"
    safe_clone = redact_remote_url(raw)
    return {
        "provider": provider,
        "host": host,
        "api_base": api_base,
        "project_path": project_path,
        "project_id": quote(project_path, safe=""),
        "web_url": web_url,
        "clone_url": safe_clone,
    }


def _meta_from_host(host: str) -> dict[str, str]:
    base = normalize_gitlab_host(host)
    parsed = urlparse(base)
    scheme = parsed.scheme or "https"
    hostname = parsed.hostname or ""
    if not hostname:
        raise GitSotError(f"Invalid GitLab host: {host}", code="GIT_HOST_BAD")
    netloc = hostname
    if parsed.port:
        netloc = f"{hostname}:{parsed.port}"
    api_base = f"{scheme}://{netloc}/api/v4"
    return {
        "provider": "gitlab",
        "host": hostname,
        "api_base": api_base,
        "web_url": f"{scheme}://{netloc}",
    }


class GitLabClient:
    def __init__(
        self,
        remote_url: str | None = None,
        *,
        host: str | None = None,
        token: str | None = None,
    ) -> None:
        if remote_url:
            self.meta = parse_remote_url(remote_url)
            if self.meta["provider"] != "gitlab":
                raise GitSotError(
                    f"GitLab API requires a GitLab remote (got {self.meta['provider']})",
                    code="GIT_MR_PROVIDER",
                )
        elif host:
            self.meta = _meta_from_host(host)
        else:
            stored = load_gitlab_host()
            if not stored:
                raise GitSotError("GitLab host not configured", code="GIT_HOST_UNSET")
            self.meta = _meta_from_host(stored)
        self.token = (token or load_pat() or "").strip()
        if not self.token:
            raise GitAuthError("GitLab PAT missing — set it in Git settings")

    @classmethod
    def from_host(cls, host: str, *, token: str | None = None) -> GitLabClient:
        """Wizard client before a project remote exists."""
        return cls(None, host=host, token=token)

    def _headers(self) -> dict[str, str]:
        return {"PRIVATE-TOKEN": self.token, "Content-Type": "application/json"}

    def _url(self, path: str) -> str:
        return f"{self.meta['api_base']}{path}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        raw: bool = False,
    ) -> Any:
        try:
            with httpx.Client(timeout=_TIMEOUT) as client:
                res = client.request(
                    method,
                    self._url(path),
                    headers=self._headers(),
                    params=params,
                    json=json_body,
                )
        except httpx.HTTPError as exc:
            raise GitSotError(f"GitLab request failed: {exc}", code="GIT_OFFLINE") from exc

        if res.status_code in (401, 403):
            raise GitAuthError(f"GitLab auth failed ({res.status_code}): {res.text[:300]}")
        if res.status_code == 404 and method == "GET" and raw:
            return None
        if res.status_code >= 400:
            raise GitSotError(
                f"GitLab API {res.status_code}: {res.text[:500]}",
                code="GITLAB_API_ERROR",
            )
        if raw:
            return res.content
        if res.status_code == 204 or not res.content:
            return {}
        return res.json()

    def _project_path(self, project_id: int | str) -> str:
        if isinstance(project_id, int) or str(project_id).isdigit():
            return str(int(project_id))
        return quote(str(project_id), safe="")

    def current_user(self) -> dict[str, Any]:
        """PAT owner — ``GET /user``."""
        data = self._request("GET", "/user")
        return data if isinstance(data, dict) else {}

    def get_project(self, project_id: int | str | None = None) -> dict[str, Any]:
        """GitLab project meta (name, path_with_namespace, web_url, …)."""
        pid = self._project_path(project_id if project_id is not None else self.meta.get("project_id", ""))
        data = self._request("GET", f"/projects/{pid}")
        return data if isinstance(data, dict) else {}

    def list_projects(
        self,
        *,
        search: str | None = None,
        page: int = 1,
        per_page: int = 50,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "membership": True,
            "simple": True,
            "order_by": "updated_at",
            "sort": "desc",
            "page": page,
            "per_page": per_page,
        }
        if search:
            params["search"] = search.strip()
        data = self._request("GET", "/projects", params=params)
        return data if isinstance(data, list) else []

    def list_namespaces(self, *, page: int = 1, per_page: int = 100) -> list[dict[str, Any]]:
        data = self._request(
            "GET",
            "/namespaces",
            params={"page": page, "per_page": per_page},
        )
        return data if isinstance(data, list) else []

    def create_project(
        self,
        name: str,
        *,
        namespace_id: int | None = None,
        visibility: str = "private",
        initialize_with_readme: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "name": name.strip(),
            "path": name.strip().lower().replace(" ", "-"),
            "visibility": visibility,
            "initialize_with_readme": initialize_with_readme,
        }
        if namespace_id is not None:
            body["namespace_id"] = int(namespace_id)
        data = self._request("POST", "/projects", json_body=body)
        return data if isinstance(data, dict) else {}

    def list_branches(
        self,
        project_id: int | str,
        *,
        page: int = 1,
        per_page: int = 100,
    ) -> list[dict[str, Any]]:
        pid = self._project_path(project_id)
        data = self._request(
            "GET",
            f"/projects/{pid}/repository/branches",
            params={"page": page, "per_page": per_page},
        )
        return data if isinstance(data, list) else []

    def file_exists(self, project_id: int | str, path: str, *, ref: str) -> bool:
        pid = self._project_path(project_id)
        encoded = quote(path.replace("\\", "/").lstrip("/"), safe="")
        try:
            self._request(
                "GET",
                f"/projects/{pid}/repository/files/{encoded}",
                params={"ref": ref},
            )
        except GitSotError as exc:
            if "404" in str(exc):
                return False
            raise
        return True

    def fetch_file_raw(self, project_id: int | str, path: str, *, ref: str) -> bytes | None:
        pid = self._project_path(project_id)
        encoded = quote(path.replace("\\", "/").lstrip("/"), safe="")
        raw = self._request(
            "GET",
            f"/projects/{pid}/repository/files/{encoded}/raw",
            params={"ref": ref},
            raw=True,
        )
        return raw if isinstance(raw, (bytes, bytearray)) else None

    def list_merge_requests(
        self,
        *,
        state: str = "opened",
        per_page: int = 50,
        page: int = 1,
    ) -> list[dict[str, Any]]:
        pid = self.meta["project_id"]
        data = self._request(
            "GET",
            f"/projects/{pid}/merge_requests",
            params={"state": state, "per_page": per_page, "page": page, "order_by": "updated_at"},
        )
        return data if isinstance(data, list) else []

    def get_merge_request(self, iid: int) -> dict[str, Any]:
        pid = self.meta["project_id"]
        data = self._request("GET", f"/projects/{pid}/merge_requests/{iid}")
        return data if isinstance(data, dict) else {}

    def create_merge_request(
        self,
        *,
        source_branch: str,
        target_branch: str,
        title: str,
        description: str | None = None,
        remove_source_branch: bool = False,
        assignee_id: int | None = None,
        draft: bool = False,
    ) -> dict[str, Any]:
        pid = self.meta["project_id"]
        body: dict[str, Any] = {
            "source_branch": source_branch,
            "target_branch": target_branch,
            "title": title,
            "remove_source_branch": remove_source_branch,
        }
        if description is not None:
            body["description"] = description
        if assignee_id is not None:
            body["assignee_id"] = int(assignee_id)
        if draft:
            body["draft"] = True
        data = self._request("POST", f"/projects/{pid}/merge_requests", json_body=body)
        return data if isinstance(data, dict) else {}

    def update_merge_request(self, iid: int, **fields: Any) -> dict[str, Any]:
        pid = self.meta["project_id"]
        data = self._request("PUT", f"/projects/{pid}/merge_requests/{iid}", json_body=fields)
        return data if isinstance(data, dict) else {}

    def merge_merge_request(
        self,
        iid: int,
        *,
        squash: bool = False,
        should_remove_source_branch: bool = False,
        merge_when_pipeline_succeeds: bool = False,
    ) -> dict[str, Any]:
        pid = self.meta["project_id"]
        data = self._request(
            "PUT",
            f"/projects/{pid}/merge_requests/{iid}/merge",
            json_body={
                "squash": squash,
                "should_remove_source_branch": should_remove_source_branch,
                "merge_when_pipeline_succeeds": merge_when_pipeline_succeeds,
            },
        )
        return data if isinstance(data, dict) else {}

    def close_merge_request(self, iid: int) -> dict[str, Any]:
        return self.update_merge_request(iid, state_event="close")

    def reopen_merge_request(self, iid: int) -> dict[str, Any]:
        return self.update_merge_request(iid, state_event="reopen")

    def list_notes(self, iid: int) -> list[dict[str, Any]]:
        pid = self.meta["project_id"]
        data = self._request("GET", f"/projects/{pid}/merge_requests/{iid}/notes", params={"per_page": 100})
        return data if isinstance(data, list) else []

    def create_note(self, iid: int, body: str) -> dict[str, Any]:
        pid = self.meta["project_id"]
        data = self._request(
            "POST",
            f"/projects/{pid}/merge_requests/{iid}/notes",
            json_body={"body": body},
        )
        return data if isinstance(data, dict) else {}

    def changes(self, iid: int) -> dict[str, Any]:
        pid = self.meta["project_id"]
        data = self._request("GET", f"/projects/{pid}/merge_requests/{iid}/changes")
        return data if isinstance(data, dict) else {}
