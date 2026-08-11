import { useState } from "react";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useDeleteGitCredentials,
  useGetGitCredentials,
  usePostGitCredentials,
} from "@/controllers/API/queries/git";
import { extractGitError } from "@/features/git/gitError";
import { GitConfirmDialog } from "@/features/git/GitConfirmDialog";
import useAlertStore from "@/stores/alertStore";

export default function GitAuthPage(): JSX.Element {
  const { data, refetch, isLoading } = useGetGitCredentials();
  const storeMut = usePostGitCredentials();
  const clearMut = useDeleteGitCredentials();
  const setSuccessData = useAlertStore((s) => s.setSuccessData);
  const setErrorData = useAlertStore((s) => s.setErrorData);
  const [token, setToken] = useState("");
  const [clearOpen, setClearOpen] = useState(false);

  const save = async () => {
    if (!token.trim()) {
      setErrorData({ title: "PAT required" });
      return;
    }
    try {
      await storeMut.mutateAsync({ token: token.trim() });
      setToken("");
      setSuccessData({ title: "PAT stored" });
      await refetch();
    } catch (err) {
      setErrorData(extractGitError(err));
    }
  };

  return (
    <div className="flex h-full w-full flex-col gap-6" data-testid="git-auth-page">
      <div>
        <h2
          className="flex items-center text-lg font-semibold tracking-tight"
          data-testid="settings_menu_header"
        >
          Git Auth
          <ForwardedIconComponent
            name="KeyRound"
            className="ml-2 h-5 w-5 text-primary"
          />
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Store or rotate GitLab personal access token (keyring / env fallback).
          Never commit real secrets to the flows repo (Phase S).
        </p>
      </div>

      <div className="max-w-lg space-y-3 rounded-md border p-4">
        <div className="text-sm">
          Status:{" "}
          {isLoading
            ? "…"
            : data?.configured
              ? `configured (${data.source || "unknown"})`
              : "not configured"}
        </div>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="glpat-…"
          allowAutofill
          data-testid="git-auth-pat-input"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={storeMut.isPending}
            onClick={() => void save()}
            data-testid="git-auth-save"
          >
            {data?.configured ? "Rotate PAT" : "Set PAT"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!data?.configured || clearMut.isPending}
            onClick={() => setClearOpen(true)}
            data-testid="git-auth-clear"
          >
            Clear
          </Button>
        </div>
      </div>

      <GitConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        tone="warning"
        title="Clear stored GitLab PAT"
        description="Remove the token from this machine. Remote git operations will fail until a new PAT is saved."
        confirmLabel="Clear PAT"
        busy={clearMut.isPending}
        onConfirm={() => {
          setClearOpen(false);
          void (async () => {
            try {
              await clearMut.mutateAsync();
              setSuccessData({ title: "PAT cleared" });
              await refetch();
            } catch (err) {
              setErrorData(extractGitError(err));
            }
          })();
        }}
      />
    </div>
  );
}
