import type { UseQueryResult } from "@tanstack/react-query";
import type {
  GitConflictDetail,
  GitConflictMeta,
  GitCredentialsStatus,
  GitHealthResponse,
  GitKeysStatus,
  GitLabBranch,
  GitLabNamespace,
  GitLabProject,
  GitSetupStatus,
  GitStatusResponse,
} from "@/features/git/types";
import useAuthStore from "@/stores/authStore";
import type { useQueryFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

const GIT = () => getURL("GIT");

export const useGetGitHealth: useQueryFunctionType<
  undefined,
  GitHealthResponse
> = (options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async (): Promise<GitHealthResponse> => {
    const res = await api.get<GitHealthResponse>(`${GIT()}/health`);
    return res.data;
  };

  const result: UseQueryResult<GitHealthResponse, Error> = query(
    ["git-health"],
    fn,
    {
      staleTime: 15_000,
      retry: false,
      refetchOnWindowFocus: true,
      ...options,
      enabled: isAuthenticated && (options?.enabled ?? true),
    },
  );
  return result;
};

export const useGetGitSetupStatus: useQueryFunctionType<
  undefined,
  GitSetupStatus
> = (options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async (): Promise<GitSetupStatus> => {
    const res = await api.get<GitSetupStatus>(`${GIT()}/setup/status`);
    return res.data;
  };

  return query(["git-setup-status"], fn, {
    staleTime: 5_000,
    retry: false,
    refetchOnWindowFocus: true,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export const useGetGitKeysStatus: useQueryFunctionType<
  undefined,
  GitKeysStatus
> = (options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async (): Promise<GitKeysStatus> => {
    try {
      const res = await api.get<GitKeysStatus>(`${GIT()}/setup/keys-status`);
      return res.data;
    } catch {
      const status = await api.get<GitSetupStatus>(`${GIT()}/setup/status`);
      return (
        status.data.keys ??
        status.data.keys_status ?? {
          unlocked: false,
        }
      );
    }
  };

  return query(["git-keys-status"], fn, {
    staleTime: 20_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export type GitSetupProjectsParams = {
  host: string;
  search?: string;
  page?: number;
};

export const useGetGitSetupProjects = (
  params: GitSetupProjectsParams | null | undefined,
  options?: { enabled?: boolean },
) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const host = params?.host ?? "";
  const search = params?.search ?? "";
  const page = params?.page ?? 1;

  const fn = async (): Promise<{ projects: GitLabProject[] }> => {
    const res = await api.get<{ items?: GitLabProject[]; projects?: GitLabProject[] }>(
      `${GIT()}/setup/projects`,
      { params: { host, search: search || undefined, page } },
    );
    return { projects: res.data.projects ?? res.data.items ?? [] };
  };

  return query(["git-setup-projects", host, search, page], fn, {
    staleTime: 10_000,
    retry: false,
    ...options,
    enabled:
      isAuthenticated &&
      Boolean(host) &&
      (options?.enabled ?? true),
  });
};

export const useGetGitSetupNamespaces = (
  host: string | null | undefined,
  options?: { enabled?: boolean },
) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async (): Promise<{ namespaces: GitLabNamespace[] }> => {
    const res = await api.get<{ items?: GitLabNamespace[]; namespaces?: GitLabNamespace[] }>(
      `${GIT()}/setup/namespaces`,
      { params: { host } },
    );
    return { namespaces: res.data.namespaces ?? res.data.items ?? [] };
  };

  return query(["git-setup-namespaces", host], fn, {
    staleTime: 60_000,
    retry: false,
    ...options,
    enabled:
      isAuthenticated &&
      Boolean(host) &&
      (options?.enabled ?? true),
  });
};

export const useGetGitSetupProjectBranches = (
  projectId: number | null | undefined,
  host: string | null | undefined,
  options?: { enabled?: boolean },
) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async (): Promise<{ branches: GitLabBranch[] }> => {
    const res = await api.get<{ items?: GitLabBranch[]; branches?: GitLabBranch[] }>(
      `${GIT()}/setup/projects/${projectId}/branches`,
      { params: { host } },
    );
    return { branches: res.data.branches ?? res.data.items ?? [] };
  };

  return query(["git-setup-project-branches", projectId, host], fn, {
    staleTime: 10_000,
    retry: false,
    ...options,
    enabled:
      isAuthenticated &&
      Boolean(projectId) &&
      Boolean(host) &&
      (options?.enabled ?? true),
  });
};

export const useGetGitStatus: useQueryFunctionType<
  undefined,
  GitStatusResponse
> = (options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async (): Promise<GitStatusResponse> => {
    const res = await api.get<GitStatusResponse>(`${GIT()}/status`);
    return res.data;
  };

  return query(["git-status"], fn, {
    staleTime: 5_000,
    refetchInterval: 12_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export const useGetGitBranches: useQueryFunctionType<
  undefined,
  { branches: GitBranchRow[]; production_branch?: string | null }
> = (options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async () => {
    const res = await api.get(`${GIT()}/branches`);
    return res.data;
  };

  return query(["git-branches"], fn, {
    staleTime: 10_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export type GitBranchRow = {
  name: string;
  current?: boolean;
  is_current?: boolean;
  is_production?: boolean;
  remote?: boolean;
  [key: string]: unknown;
};

export const useGetGitDiff = (
  target: { flowId?: string | null; path?: string | null } | string | null | undefined,
  options?: { enabled?: boolean },
) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const flowId =
    typeof target === "string" || target == null
      ? (target as string | null | undefined)
      : target.flowId;
  const path =
    typeof target === "object" && target != null ? target.path : undefined;

  const fn = async (): Promise<{
    diff: string;
    flow_id?: string | null;
    path?: string | null;
  }> => {
    const params: Record<string, string> = {};
    if (path) params.path = path;
    else if (flowId) params.flow_id = flowId;
    const res = await api.get(`${GIT()}/diff`, { params });
    return res.data;
  };

  const key = path ? `path:${path}` : `flow:${flowId ?? "all"}`;
  return query(["git-diff", key], fn, {
    staleTime: 3_000,
    retry: false,
    ...options,
    enabled:
      isAuthenticated &&
      Boolean(path || flowId !== undefined) &&
      (options?.enabled ?? true),
  });
};

export const useGetGitConflicts: useQueryFunctionType<
  undefined,
  { conflicts: GitConflictMeta[] }
> = (options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async () => {
    const res = await api.get(`${GIT()}/conflicts`);
    return res.data;
  };

  return query(["git-conflicts"], fn, {
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export const useGetGitConflictDetail = (
  flowId: string | null | undefined,
  options?: { enabled?: boolean },
) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async (): Promise<GitConflictDetail> => {
    const res = await api.get(`${GIT()}/conflicts/${flowId}`);
    return res.data;
  };

  return query(["git-conflict-detail", flowId], fn, {
    staleTime: 2_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && Boolean(flowId) && (options?.enabled ?? true),
  });
};

export const useGetGitCredentials: useQueryFunctionType<
  undefined,
  GitCredentialsStatus
> = (options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async (): Promise<GitCredentialsStatus> => {
    const res = await api.get(`${GIT()}/credentials`);
    return res.data;
  };

  return query(["git-credentials"], fn, {
    staleTime: 20_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export const useGetGitDetachInfo: useQueryFunctionType<
  undefined,
  { confirm_name?: string; repo_root?: string | null; ready_to_detach?: boolean }
> = (options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async () => {
    const res = await api.get(`${GIT()}/setup/detach-info`);
    return res.data;
  };

  return query(["git-detach-info"], fn, {
    staleTime: 10_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export const useGetGitProductionBranch: useQueryFunctionType<
  undefined,
  { name?: string | null; path?: string; immutable?: boolean }
> = (options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async () => {
    const res = await api.get(`${GIT()}/production-branch`);
    return res.data;
  };

  return query(["git-production-branch"], fn, {
    staleTime: 60_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export const useGetGitOpsLog: useQueryFunctionType<
  { limit?: number } | undefined,
  { lines: string[] }
> = (params, options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const limit = params?.limit ?? 40;

  const fn = async () => {
    const res = await api.get(`${GIT()}/ops-log`, { params: { limit } });
    return res.data;
  };

  return query(["git-ops-log", limit], fn, {
    staleTime: 4_000,
    refetchInterval: 8_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export const useGetGitRemote: useQueryFunctionType<
  undefined,
  {
    configured: boolean;
    url?: string | null;
    provider?: string;
    host?: string;
    project_path?: string;
    project_name?: string;
    namespace?: string;
    display_path?: string;
    web_url?: string;
    parse_error?: string;
  }
> = (options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const fn = async () => {
    const res = await api.get(`${GIT()}/remote`);
    return res.data;
  };
  return query(["git-remote"], fn, {
    staleTime: 30_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export const useGetGitLog: useQueryFunctionType<
  { max_count?: number; graph?: boolean } | undefined,
  {
    commits: Array<{
      sha: string;
      short_sha: string;
      summary: string;
      author?: string | null;
      authored_date?: string | null;
      parents?: string[];
      refs?: string[];
    }>;
    graph_lines: string[];
    branch?: string | null;
  }
> = (params, options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const max_count = params?.max_count ?? 40;
  const graph = params?.graph ?? true;
  const fn = async () => {
    const res = await api.get(`${GIT()}/log`, { params: { max_count, graph } });
    return res.data;
  };
  return query(["git-log", max_count, graph], fn, {
    staleTime: 8_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export type GitCommitDetail = {
  sha: string;
  short_sha: string;
  summary: string;
  message?: string;
  author?: string | null;
  author_email?: string | null;
  authored_date?: string | null;
  parents?: string[];
  refs?: string[];
  files?: Array<{
    path: string;
    change_type?: string;
    change_kind?: string;
    a_path?: string | null;
    b_path?: string | null;
  }>;
};

export const useGetGitCommit = (
  sha: string | null | undefined,
  options?: { enabled?: boolean },
) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const fn = async (): Promise<GitCommitDetail> => {
    const res = await api.get(`${GIT()}/log/${encodeURIComponent(sha!)}`);
    return res.data;
  };

  return query(["git-commit", sha], fn, {
    staleTime: 30_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && Boolean(sha) && (options?.enabled ?? true),
  });
};

export const useGetGitMergeRequests: useQueryFunctionType<
  { state?: string } | undefined,
  { items: GitMergeRequest[]; remote?: Record<string, string> }
> = (params, options?) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const state = params?.state ?? "opened";
  const fn = async () => {
    const res = await api.get(`${GIT()}/merge-requests`, { params: { state } });
    return res.data;
  };
  return query(["git-mrs", state], fn, {
    staleTime: 10_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
};

export type GitMergeRequest = {
  iid: number;
  id?: number;
  title: string;
  state: string;
  web_url?: string;
  source_branch?: string;
  target_branch?: string;
  description?: string | null;
  merge_status?: string;
  author?: { name?: string; username?: string };
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export const useGetGitMergeRequest = (
  iid: number | null | undefined,
  options?: { enabled?: boolean },
) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const fn = async (): Promise<GitMergeRequest> => {
    const res = await api.get(`${GIT()}/merge-requests/${iid}`);
    return res.data;
  };
  return query(["git-mr", iid], fn, {
    staleTime: 5_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && Boolean(iid) && (options?.enabled ?? true),
  });
};

export const useGetGitMergeRequestChanges = (
  iid: number | null | undefined,
  options?: { enabled?: boolean },
) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const fn = async () => {
    const res = await api.get(`${GIT()}/merge-requests/${iid}/changes`);
    return res.data;
  };
  return query(["git-mr-changes", iid], fn, {
    staleTime: 5_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && Boolean(iid) && (options?.enabled ?? true),
  });
};

export const useGetGitMergeRequestNotes = (
  iid: number | null | undefined,
  options?: { enabled?: boolean },
) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const fn = async () => {
    const res = await api.get(`${GIT()}/merge-requests/${iid}/notes`);
    return res.data as { notes: Array<{ id: number; body: string; author?: { name?: string }; created_at?: string }> };
  };
  return query(["git-mr-notes", iid], fn, {
    staleTime: 5_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && Boolean(iid) && (options?.enabled ?? true),
  });
};

export const useGetGitMrConflicts = (
  iid: number | null | undefined,
  options?: { enabled?: boolean },
) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const fn = async () => {
    const res = await api.get(`${GIT()}/merge-requests/${iid}/conflicts`);
    return res.data as {
      iid: number;
      conflict_paths: string[];
      has_conflicts: boolean;
    };
  };
  return query(["git-mr-conflicts", iid], fn, {
    staleTime: 2_000,
    retry: false,
    ...options,
    enabled: isAuthenticated && Boolean(iid) && (options?.enabled ?? true),
  });
};

export const useGetGitMrConflictFile = (
  iid: number | null | undefined,
  path: string | null | undefined,
  options?: { enabled?: boolean },
) => {
  const { query } = UseRequestProcessor();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const fn = async () => {
    const res = await api.get(`${GIT()}/merge-requests/${iid}/conflicts/file`, {
      params: { path },
    });
    return res.data as {
      iid: number;
      path: string;
      ours: string | null;
      theirs: string | null;
      base: string | null;
      working: string | null;
      exists: boolean;
    };
  };
  return query(["git-mr-conflict-file", iid, path], fn, {
    staleTime: 0,
    retry: false,
    ...options,
    enabled:
      isAuthenticated &&
      Boolean(iid) &&
      Boolean(path) &&
      (options?.enabled ?? true),
  });
};
