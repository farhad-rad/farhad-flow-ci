export type GitLayoutChecks = {
  path_resolved?: boolean;
  is_git?: boolean;
  flows_dir?: boolean;
  flows_lock?: boolean;
  secrets_dir?: boolean;
  secrets_lock?: boolean;
  production_branch?: boolean;
  keys_age?: boolean;
  langflow_dir?: boolean;
};

export type GitKeysStatus = {
  unlocked: boolean;
  has_passphrase?: boolean;
  has_keys_age_blob?: boolean;
  recipients_configured?: boolean;
  identity_configured?: boolean;
  keyring_available?: boolean;
  gitlab_host?: string | null;
  entries?: Record<string, boolean>;
  /** @deprecated use recipients_configured / identity_configured */
  has_production_pub?: boolean;
  has_flow_ci_pub?: boolean;
  has_flow_ci_key?: boolean;
};

export type GitSetupStatus = {
  ready: boolean;
  git_enabled?: boolean;
  git_binary_available?: boolean;
  git_binary_version?: string | null;
  dest_dir?: string | null;
  repo_root?: string | null;
  checks?: GitLayoutChecks;
  missing?: string[];
  production_branch?: string | null;
  repaired?: string[];
  pat?: { configured?: boolean; source?: string };
  keys?: GitKeysStatus;
  /** @deprecated backend returns `keys` */
  keys_status?: GitKeysStatus;
  cloned?: boolean;
  reused_existing?: boolean;
  branch?: string | null;
  ok?: boolean;
  host?: string | null;
};

export type GitHealthResponse = {
  git_enabled: boolean;
  git_binary_available: boolean;
  git_binary_path?: string | null;
  git_binary_version?: string | null;
  repo_configured: boolean;
  repo_is_git: boolean;
  setup_complete?: boolean;
  layout?: GitSetupStatus;
  banner_code?: string | null;
  banner_message?: string | null;
  production_branch?: string | null;
  current_branch?: string | null;
  on_production?: boolean;
  auto_commit?: boolean;
  pat?: { configured?: boolean; source?: string };
  keys?: GitKeysStatus;
  /** @deprecated backend returns `keys` */
  keys_status?: GitKeysStatus;
};

export type GitLabProject = {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url?: string;
  http_url_to_repo?: string;
};

export type GitLabNamespace = {
  id: number;
  name: string;
  full_path: string;
  kind: string;
};

export type GitLabBranch = {
  name: string;
};

export type GitBranchValidation = {
  ok: boolean;
  checks?: GitLayoutChecks;
  missing?: string[];
};

export type GitSetupHostResponse = {
  host: string;
  api_base: string;
  stored?: boolean;
  backend?: string;
};

export type GitSetupPatResponse = {
  configured: boolean;
  source?: string;
};

export type GitUnlockKeysResponse = {
  ok: boolean;
  unlocked?: boolean;
  keys?: GitKeysStatus;
  stored?: Record<string, unknown>;
};

export type GitSetupInstallMode = "existing" | "fresh";

export type GitSetupInstallRequest = {
  mode: GitSetupInstallMode;
  host: string;
  project_id: number;
  branch: string;
  clone_url?: string;
  keys_passphrase?: string;
  force?: boolean;
};

export type GitStatusEntry = {
  path: string;
  index_status: string;
  worktree_status: string;
  flow_id?: string | null;
  flow_name?: string | null;
  change_kind?: "created" | "modified" | "deleted" | "unchanged" | "renamed" | string;
};

export type GitStatusResponse = {
  branch?: string | null;
  production_branch?: string | null;
  on_production: boolean;
  dirty: boolean;
  entries: GitStatusEntry[];
  ahead?: number | null;
  behind?: number | null;
  /** Commits on current branch not in production tip (prefer over upstream `ahead`). */
  ahead_of_production?: number | null;
  /** False when origin/<branch> missing — Push publishes new remote branch. */
  has_upstream?: boolean;
  unresolved_conflicts: boolean;
};

export type GitBranchInfo = {
  name: string;
  is_current?: boolean;
  is_remote?: boolean;
  [key: string]: unknown;
};

export type GitConflictMeta = {
  flow_id: string;
  rel_path?: string;
  created_at?: string;
  ours?: string;
  theirs?: string;
  base?: string | null;
  reason?: string;
};

export type GitConflictDetail = {
  meta: GitConflictMeta;
  ours?: string | null;
  theirs?: string | null;
  base?: string | null;
};

export type GitCredentialsStatus = {
  configured: boolean;
  source?: string;
};

export type ConflictResolveAction =
  | "take_ours"
  | "take_theirs"
  | "manual"
  | "clear";
