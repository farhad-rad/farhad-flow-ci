/** Human-facing catalog for Desktop git error codes (Phase 4 — 8.4). */
export const GIT_ERROR_CATALOG: Record<
  string,
  { title: string; hint: string }
> = {
  GIT_NOT_INSTALLED: {
    title: "Git not installed",
    hint: "Install Git for Windows (or system git) and ensure it is on PATH.",
  },
  GIT_DISABLED: {
    title: "Git SoT disabled",
    hint: "Git mode is off for this install.",
  },
  GIT_FLOWS_DIR_UNSET: {
    title: "Flows path unavailable",
    hint: "FarhadFlowCI config_dir missing — cannot place flows-repo.",
  },
  GIT_SETUP_REQUIRED: {
    title: "Git setup required",
    hint: "Connect GitLab host, save PAT, pick or create a repo, unlock keys, then install.",
  },
  GIT_KEYS_AGE_MISSING: {
    title: "keys.age missing",
    hint: "Every branch must include .langflow/keys.age. Merge or cherry-pick .langflow/ from production.",
  },
  GIT_KEYS_UNLOCK_FAILED: {
    title: "keys.age unlock failed",
    hint: "Wrong passphrase or corrupt keys.age zip. Re-upload (fresh) or retry passphrase (existing).",
  },
  GIT_LAYOUT_INVALID: {
    title: "Invalid repo layout",
    hint: "Branch must contain .langflow/production-branch and .langflow/keys.age before install.",
  },
  GIT_KEYS_NOT_UNLOCKED: {
    title: "Age keys not unlocked",
    hint: "Unlock keys.age with your passphrase in Git setup or Settings before encrypting secrets.",
  },
  GIT_DEST_NOT_EMPTY: {
    title: "Install folder not empty",
    hint: "Retry with force replace, or clear the local flows-repo folder.",
  },
  GIT_REPO_NOT_FOUND: {
    title: "Repository not found",
    hint: "Finish the welcome git setup wizard to clone your flows repo.",
  },
  GIT_REPO_NOT_INITIALIZED: {
    title: "Git repo not connected",
    hint: "Finish the welcome git setup wizard (clone + check layout).",
  },
  GIT_AUTH_ERROR: {
    title: "Authentication failed",
    hint: "Set or rotate your GitLab PAT under Settings → Git Auth.",
  },
  GIT_PRODUCTION_BRANCH_GUARD: {
    title: "Production branch guard",
    hint: "Push and destructive ops are blocked on the production branch. Switch branch.",
  },
  GIT_IMMUTABLE_PATH: {
    title: "Immutable path",
    hint: ".langflow/production-branch cannot be modified or deleted from Desktop.",
  },
  GIT_SECRET_PATTERN: {
    title: "Possible secret in commit",
    hint: "Raw key pattern found in flow JSON (sk-/ghp_/AKIA/…). Remove it before commit. Full strip/inject is Phase S.",
  },
  GIT_DIRTY_WORKTREE: {
    title: "Uncommitted changes",
    hint: "Commit or stash before checkout, or force checkout after confirm.",
  },
  PRODUCTION_BRANCH_GUARD: {
    title: "Production branch guard",
    hint: "Push and destructive ops are blocked on the production branch. Switch branch.",
  },
  IMMUTABLE_PATH: {
    title: "Immutable path",
    hint: ".langflow/production-branch cannot be modified or deleted from Desktop.",
  },
  DIRTY_WORKTREE: {
    title: "Uncommitted changes",
    hint: "Commit or stash before checkout, or force checkout after confirm.",
  },
  GIT_AUTH: {
    title: "Authentication failed",
    hint: "Set or rotate your GitLab PAT under Settings → Git Auth.",
  },
  GIT_LEASE_HELD: {
    title: "Flow locked by another user",
    hint: "Wait for the lease to expire or ask the holder to release it.",
  },
  GIT_FLOW_CONFLICT: {
    title: "Unresolved merge conflict",
    hint: "Open Git conflicts, pick ours/theirs or edit JSON, then mark resolved.",
  },
  GIT_FLOW_DRIFT: {
    title: "DB cache differs from disk",
    hint: "Reconcile take-disk or keep-DB before opening the flow.",
  },
  GIT_PUSH_REJECTED: {
    title: "Push rejected",
    hint: "Fetch/pull, resolve conflicts, then push again.",
  },
  GIT_CONFLICT: {
    title: "Git conflict",
    hint: "Resolve under Settings → Git Conflicts, then commit.",
  },
  GIT_OFFLINE: {
    title: "Remote unreachable",
    hint: "Check network / GitLab status. Local commit still works.",
  },
};

export function catalogForCode(code?: string | null): {
  title: string;
  hint: string;
} {
  if (code && GIT_ERROR_CATALOG[code]) {
    return GIT_ERROR_CATALOG[code];
  }
  return {
    title: code || "Git error",
    hint: "See ops log or browser network tab for details.",
  };
}
