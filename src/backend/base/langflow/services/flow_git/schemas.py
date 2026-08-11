"""Pydantic models for git-SoT drift / reconcile API."""

from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field


class GitReconcileAction(str, Enum):
    TAKE_DISK = "take_disk"
    KEEP_DB_WRITE_DISK = "keep_db_write_disk"
    ABORT = "abort"


class GitDriftDetail(BaseModel):
    code: str = "GIT_FLOW_DRIFT"
    flow_id: UUID
    db_sha256: str | None = None
    disk_sha256: str | None = None
    has_disk_file: bool = False
    message: str = "Flow DB cache differs from git working-tree file. Reconcile required."


class GitDriftResponse(BaseModel):
    drifted: bool
    flow_id: UUID
    db_sha256: str | None = None
    disk_sha256: str | None = None
    has_disk_file: bool = False
    read_only: bool = False
    conflicted: bool = False
    lease_banner_code: str | None = None
    lease_message: str | None = None
    lease: dict | None = None


class GitReconcileRequest(BaseModel):
    action: GitReconcileAction = Field(..., description="take_disk | keep_db_write_disk | abort")
