import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/controllers/API/api";
import { getURL } from "@/controllers/API/helpers/constants";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";

export type GitHealthResponse = {
  git_enabled: boolean;
  git_binary_available: boolean;
  banner_code?: string | null;
  banner_message?: string | null;
  on_production?: boolean;
  production_branch?: string | null;
  repo_is_git?: boolean;
};

/**
 * Banner for Git missing / setup incomplete — not production-branch HEAD.
 * Opens full /git page (drawer retired).
 */
export default function GitHealthBanner(): JSX.Element | null {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const navigate = useCustomNavigate();

  const { data } = useQuery({
    queryKey: ["git-health"],
    queryFn: async () => {
      const res = await api.get<GitHealthResponse>(`${getURL("GIT")}/health`);
      return res.data;
    },
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
  });

  const code = data?.banner_code;
  if (
    !code ||
    code === "ON_PRODUCTION_BRANCH" ||
    dismissed === code ||
    !data?.banner_message
  ) {
    return null;
  }

  const message = data.banner_message;

  return (
    <div
      data-testid="git-health-banner"
      className="flex items-center justify-between gap-3 border-b border-amber-600/40 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
      role="status"
    >
      <span>
        <strong className="mr-2">{code}</strong>
        {message}
      </span>
      <div className="flex shrink-0 items-center gap-3">
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto p-0 underline"
          data-testid="git-health-banner-open"
          onClick={() => navigate("/git")}
        >
          Open Git
        </Button>
        <button
          type="button"
          className="underline"
          data-testid="git-health-banner-dismiss"
          onClick={() => setDismissed(code)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
