import type {
  ConflictResolveAction,
  GitCredentialsStatus,
  GitLabProject,
  GitSetupHostResponse,
  GitSetupInstallRequest,
  GitSetupPatResponse,
  GitUnlockKeysResponse,
  GitBranchValidation,
} from "@/features/git/types";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import type { useMutationFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

const GIT = () => getURL("GIT");

function invalidateGit(queryClient: ReturnType<typeof UseRequestProcessor>["queryClient"]) {
  void queryClient.invalidateQueries({ queryKey: ["git-health"] });
  void queryClient.invalidateQueries({ queryKey: ["git-setup-status"] });
  void queryClient.invalidateQueries({ queryKey: ["git-status"] });
  void queryClient.invalidateQueries({ queryKey: ["git-branches"] });
  void queryClient.invalidateQueries({ queryKey: ["git-conflicts"] });
  void queryClient.invalidateQueries({ queryKey: ["git-diff"] });
  void queryClient.invalidateQueries({ queryKey: ["git-ops-log"] });
  void queryClient.invalidateQueries({ queryKey: ["git-credentials"] });
  void queryClient.invalidateQueries({ queryKey: ["git-keys-status"] });
  void queryClient.invalidateQueries({ queryKey: ["git-setup-projects"] });
  void queryClient.invalidateQueries({ queryKey: ["git-setup-namespaces"] });
  void queryClient.invalidateQueries({ queryKey: ["git-setup-project-branches"] });
  void queryClient.invalidateQueries({ queryKey: ["git-detach-info"] });
  void queryClient.invalidateQueries({ queryKey: ["git-production-branch"] });
  void queryClient.invalidateQueries({ queryKey: ["git-log"] });
  void queryClient.invalidateQueries({ queryKey: ["git-remote"] });
  void queryClient.invalidateQueries({ queryKey: ["git-mrs"] });
  void queryClient.invalidateQueries({ queryKey: ["git-mr"] });
  void queryClient.invalidateQueries({ queryKey: ["git-mr-changes"] });
  void queryClient.invalidateQueries({ queryKey: ["git-mr-notes"] });
}

export const usePostGitSetupHost: useMutationFunctionType<
  undefined,
  { host: string }
> = (options) => {
  const { mutate } = UseRequestProcessor();
  return mutate(
    ["git-setup-host"],
    async (body): Promise<GitSetupHostResponse> => {
      const res = await api.post<GitSetupHostResponse>(`${GIT()}/setup/host`, body);
      const data = res.data;
      const host = data.host ?? body.host.trim();
      return {
        ...data,
        host,
        api_base: data.api_base ?? `${host.replace(/\/$/, "")}/api/v4`,
      };
    },
    options,
  );
};

export const usePostGitSetupPat: useMutationFunctionType<
  undefined,
  { token: string }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-setup-pat"],
    async (body): Promise<GitSetupPatResponse> => {
      const res = await api.post(`${GIT()}/setup/pat`, body);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        void queryClient.invalidateQueries({ queryKey: ["git-credentials"] });
        void queryClient.invalidateQueries({ queryKey: ["git-setup-status"] });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitSetupCreateProject: useMutationFunctionType<
  undefined,
  {
    host: string;
    name: string;
    namespace_id: number;
    visibility: string;
  }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-setup-create-project"],
    async (body): Promise<GitLabProject> => {
      const res = await api.post<{ ok?: boolean; project?: GitLabProject }>(
        `${GIT()}/setup/projects`,
        body,
      );
      const project = res.data.project ?? (res.data as GitLabProject);
      if (!project?.id) {
        throw new Error("GitLab project create returned no project");
      }
      return project;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        void queryClient.invalidateQueries({ queryKey: ["git-setup-projects"] });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitSetupValidateBranch: useMutationFunctionType<
  undefined,
  { host: string; project_id: number; branch: string }
> = (options) => {
  const { mutate } = UseRequestProcessor();
  return mutate(
    ["git-setup-validate-branch"],
    async (body): Promise<GitBranchValidation> => {
      const res = await api.post(`${GIT()}/setup/validate-branch`, body);
      return res.data;
    },
    options,
  );
};

export const usePostGitSetupUnlockKeys: useMutationFunctionType<
  undefined,
  { keys_age: File; passphrase: string }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-setup-unlock-keys"],
    async ({ keys_age, passphrase }): Promise<GitUnlockKeysResponse> => {
      const form = new FormData();
      form.append("keys_age", keys_age);
      form.append("passphrase", passphrase);
      const res = await api.post(`${GIT()}/setup/unlock-keys`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        void queryClient.invalidateQueries({ queryKey: ["git-keys-status"] });
        void queryClient.invalidateQueries({ queryKey: ["git-setup-status"] });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitSetupInstall: useMutationFunctionType<
  undefined,
  GitSetupInstallRequest
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-setup-install"],
    async (body) => {
      const res = await api.post(`${GIT()}/setup/install`, body);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitClone: useMutationFunctionType<
  undefined,
  { url: string; dest_dir?: string; token?: string; branch?: string }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-clone"],
    async (body) => {
      const res = await api.post(`${GIT()}/clone`, body);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitCommit: useMutationFunctionType<
  undefined,
  { message: string; paths?: string[] }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-commit"],
    async (body) => {
      const res = await api.post(`${GIT()}/commit`, body);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitDiscard: useMutationFunctionType<
  undefined,
  { paths: string[] }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  const setFlows = useFlowsManagerStore((s) => s.setFlows);
  return mutate(
    ["git-discard"],
    async (body) => {
      const res = await api.post(`${GIT()}/discard`, body);
      return res.data;
    },
    {
      ...options,
      onSuccess: async (data, vars, ctx) => {
        invalidateGit(queryClient);
        try {
          // Force refresh global flows store (History page may not mount refresh query).
          const { data: dbDataFlows } = await api.get(
            `${getURL("FLOWS")}/?get_all=true&header_flows=true`,
          );
          const flows = Array.isArray(dbDataFlows)
            ? dbDataFlows
            : (dbDataFlows as { items: unknown[] })?.items;
          if (Array.isArray(flows)) {
            setFlows(flows as never);
          }
        } catch {
          void queryClient.invalidateQueries({
            queryKey: ["useGetRefreshFlowsQuery"],
          });
        }
        void queryClient.refetchQueries({ queryKey: ["useGetFolder"] });
        void queryClient.invalidateQueries({ queryKey: ["useGetFlow"] });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitPush: useMutationFunctionType<
  undefined,
  { remote?: string; branch?: string; set_upstream?: boolean } | undefined
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-push"],
    async (body) => {
      const res = await api.post(`${GIT()}/push`, body ?? {});
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitPull: useMutationFunctionType<
  undefined,
  { remote?: string; strategy?: "merge" | "ff-only" | "rebase" } | undefined
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-pull"],
    async (body) => {
      const res = await api.post(`${GIT()}/pull`, body ?? {});
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitFetch: useMutationFunctionType<
  undefined,
  { remote?: string } | undefined
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-fetch"],
    async (body) => {
      const res = await api.post(`${GIT()}/fetch`, body ?? {});
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitCreateBranch: useMutationFunctionType<
  undefined,
  { name: string; checkout?: boolean; start_point?: string | null }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-branch-create"],
    async (body) => {
      const res = await api.post(`${GIT()}/branches`, body);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitCheckout: useMutationFunctionType<
  undefined,
  { name: string; force?: boolean }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-checkout"],
    async (body) => {
      const res = await api.post(`${GIT()}/branches/checkout`, body);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitSyncBranches: useMutationFunctionType<
  undefined,
  { remote?: string } | undefined
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-branches-sync"],
    async (body) => {
      const res = await api.post(`${GIT()}/branches/sync`, body ?? {});
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const useDeleteGitBranch: useMutationFunctionType<
  undefined,
  { name: string; force?: boolean }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-branch-delete"],
    async ({ name, force }) => {
      const res = await api.delete(`${GIT()}/branches/${encodeURIComponent(name)}`, {
        params: { force: Boolean(force) },
      });
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitCredentials: useMutationFunctionType<
  undefined,
  { token: string }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-credentials-store"],
    async (body): Promise<GitCredentialsStatus> => {
      const res = await api.post(`${GIT()}/credentials`, body);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        void queryClient.invalidateQueries({ queryKey: ["git-credentials"] });
        void queryClient.invalidateQueries({ queryKey: ["git-health"] });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const useDeleteGitCredentials: useMutationFunctionType<
  undefined,
  undefined
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-credentials-clear"],
    async () => {
      const res = await api.delete(`${GIT()}/credentials`);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        void queryClient.invalidateQueries({ queryKey: ["git-credentials"] });
        void queryClient.invalidateQueries({ queryKey: ["git-health"] });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitSetupDetach: useMutationFunctionType<
  undefined,
  { confirm: string }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  const setFlows = useFlowsManagerStore((s) => s.setFlows);
  return mutate(
    ["git-setup-detach"],
    async (body) => {
      const res = await api.post(`${GIT()}/setup/detach`, body);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        setFlows([]);
        invalidateGit(queryClient);
        void queryClient.invalidateQueries({ queryKey: ["useGetFolders"] });
        void queryClient.invalidateQueries({ queryKey: ["useGetFolder"] });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitConflictResolve: useMutationFunctionType<
  undefined,
  { flowId: string; action: ConflictResolveAction; content?: string }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-conflict-resolve"],
    async ({ flowId, action, content }) => {
      const res = await api.post(`${GIT()}/conflicts/${flowId}/resolve`, {
        action,
        content,
      });
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        void queryClient.invalidateQueries({
          queryKey: ["git-conflict-detail"],
        });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitCreateMergeRequest: useMutationFunctionType<
  undefined,
  {
    source_branch: string;
    target_branch: string;
    title: string;
    description?: string;
    remove_source_branch?: boolean;
    draft?: boolean;
  }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-mr-create"],
    async (body) => {
      const res = await api.post(`${GIT()}/merge-requests`, body);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePutGitMergeMergeRequest: useMutationFunctionType<
  undefined,
  {
    iid: number;
    squash?: boolean;
    should_remove_source_branch?: boolean;
    merge_when_pipeline_succeeds?: boolean;
  }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-mr-merge"],
    async ({ iid, ...body }) => {
      const res = await api.put(`${GIT()}/merge-requests/${iid}/merge`, body);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitCloseMergeRequest: useMutationFunctionType<
  undefined,
  { iid: number }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-mr-close"],
    async ({ iid }) => {
      const res = await api.post(`${GIT()}/merge-requests/${iid}/close`);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitReopenMergeRequest: useMutationFunctionType<
  undefined,
  { iid: number }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-mr-reopen"],
    async ({ iid }) => {
      const res = await api.post(`${GIT()}/merge-requests/${iid}/reopen`);
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitMergeRequestNote: useMutationFunctionType<
  undefined,
  { iid: number; body: string }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-mr-note"],
    async ({ iid, body }) => {
      const res = await api.post(`${GIT()}/merge-requests/${iid}/notes`, {
        body,
      });
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        void queryClient.invalidateQueries({
          queryKey: ["git-mr-notes", vars.iid],
        });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitMrConflictsPrepare: useMutationFunctionType<
  undefined,
  { iid: number }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-mr-conflicts-prepare"],
    async ({ iid }) => {
      const res = await api.post(
        `${GIT()}/merge-requests/${iid}/conflicts/prepare`,
      );
      return res.data as {
        iid: number;
        ok: boolean;
        has_conflicts: boolean;
        conflict_paths: string[];
        source_branch: string;
        target_branch: string;
        message?: string;
      };
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        void queryClient.invalidateQueries({
          queryKey: ["git-mr-conflicts", vars.iid],
        });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitMrConflictResolve: useMutationFunctionType<
  undefined,
  { iid: number; path: string; content: string }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-mr-conflict-resolve"],
    async ({ iid, path, content }) => {
      const res = await api.post(
        `${GIT()}/merge-requests/${iid}/conflicts/resolve`,
        { path, content },
      );
      return res.data as { iid: number; ok: boolean; path: string; remaining: string[] };
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        void queryClient.invalidateQueries({
          queryKey: ["git-mr-conflicts", vars.iid],
        });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitMrConflictsFinish: useMutationFunctionType<
  undefined,
  { iid: number; message: string; push?: boolean }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-mr-conflicts-finish"],
    async ({ iid, message, push = true }) => {
      const res = await api.post(
        `${GIT()}/merge-requests/${iid}/conflicts/finish`,
        { message, push },
      );
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        invalidateGit(queryClient);
        void queryClient.invalidateQueries({ queryKey: ["git-mr", vars.iid] });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};

export const usePostGitMrConflictsAbort: useMutationFunctionType<
  undefined,
  { iid: number }
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["git-mr-conflicts-abort"],
    async ({ iid }) => {
      const res = await api.post(
        `${GIT()}/merge-requests/${iid}/conflicts/abort`,
      );
      return res.data;
    },
    {
      ...options,
      onSuccess: (data, vars, ctx) => {
        void queryClient.invalidateQueries({
          queryKey: ["git-mr-conflicts", vars.iid],
        });
        options?.onSuccess?.(data, vars, ctx);
      },
    },
  );
};
