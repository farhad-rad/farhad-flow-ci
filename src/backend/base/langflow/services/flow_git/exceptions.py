"""Git SoT / GitRepoService errors."""

from __future__ import annotations


class GitSotError(Exception):
    """Base error with stable ``code`` for API mapping."""

    code: str = "GIT_SOT_ERROR"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        if code:
            self.code = code
        self.message = message


class GitNotInstalledError(GitSotError):
    code = "GIT_NOT_INSTALLED"


class GitRepoNotFoundError(GitSotError):
    code = "GIT_REPO_NOT_FOUND"


class ProductionBranchGuardError(GitSotError):
    code = "GIT_PRODUCTION_BRANCH_GUARD"


class DirtyWorktreeError(GitSotError):
    code = "GIT_DIRTY_WORKTREE"


class GitAuthError(GitSotError):
    code = "GIT_AUTH_ERROR"


class GitPushRejectedError(GitSotError):
    code = "GIT_PUSH_REJECTED"


class GitConflictError(GitSotError):
    code = "GIT_CONFLICT"


class LeaseHeldError(GitSotError):
    code = "GIT_LEASE_HELD"


class ImmutablePathError(GitSotError):
    code = "GIT_IMMUTABLE_PATH"


class SecretPatternBlockedError(GitSotError):
    """Fail-closed stub: raw key-shaped literal in commit payload."""

    code = "GIT_SECRET_PATTERN"


class GitKeysAgeMissingError(GitSotError):
    code = "GIT_KEYS_AGE_MISSING"


class GitKeysNotUnlockedError(GitSotError):
    code = "GIT_KEYS_NOT_UNLOCKED"


class GitKeysUnlockFailedError(GitSotError):
    code = "GIT_KEYS_UNLOCK_FAILED"


class GitLayoutInvalidError(GitSotError):
    code = "GIT_LAYOUT_INVALID"
