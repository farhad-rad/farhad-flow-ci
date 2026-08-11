import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useDeleteGitCredentials,
  useGetGitCredentials,
  useGetGitDetachInfo,
  useGetGitHealth,
  useGetGitKeysStatus,
  useGetGitProductionBranch,
  useGetGitRemote,
  useGetGitSetupStatus,
  usePostGitCredentials,
  usePostGitSetupDetach,
} from "@/controllers/API/queries/git";
import { extractGitError } from "@/features/git/gitError";
import { GitConfirmDialog } from "@/features/git/GitConfirmDialog";
import type { GitKeysStatus } from "@/features/git/types";
import { GitLoadingPanel } from "@/features/git/GitLoadingPanel";
import useAlertStore from "@/stores/alertStore";

function keysStatusLabel(keys: GitKeysStatus | undefined): string {
  if (!keys) return "unknown";
  if (keys.unlocked) return "unlocked in OS keyring";
  if (
    keys.recipients_configured ||
    keys.identity_configured ||
    keys.entries?.["production.pub"] ||
    keys.entries?.["flow-ci.pub"] ||
    keys.entries?.["flow-ci.key"]
  ) {
    return "partial — passphrase required";
  }
  return "not unlocked";
}

export default function GitSettingsPage(): JSX.Element {
  const { data: health, isLoading: healthLoading } = useGetGitHealth();
  const { data: setup, isLoading: setupLoading } = useGetGitSetupStatus();
  const { data: remote, isLoading: remoteLoading } = useGetGitRemote({
    enabled: Boolean(health?.repo_is_git),
  });
  const { data: prod } = useGetGitProductionBranch({
    enabled: Boolean(health?.repo_is_git),
  });
  const { data: creds, refetch, isLoading: credsLoading } = useGetGitCredentials();
  const {
    data: keysStatus,
    isLoading: keysLoading,
    refetch: refetchKeys,
  } = useGetGitKeysStatus({
    enabled: Boolean(health?.repo_is_git ?? setup?.ready),
  });
  const { data: detachInfo } = useGetGitDetachInfo({
    enabled: Boolean(health?.repo_is_git),
  });
  const storeMut = usePostGitCredentials();
  const clearMut = useDeleteGitCredentials();
  const detachMut = usePostGitSetupDetach();
  const [token, setToken] = useState("");
  const [detachConfirm, setDetachConfirm] = useState("");
  const [syncingSecrets, setSyncingSecrets] = useState(false);
  const [clearPatOpen, setClearPatOpen] = useState(false);
  const setSuccessData = useAlertStore((s) => s.setSuccessData);
  const setErrorData = useAlertStore((s) => s.setErrorData);

  useEffect(() => {
    if (setup?.keys ?? setup?.keys_status) {
      void refetchKeys();
    }
  }, [setup?.keys, setup?.keys_status, refetchKeys]);

  const effectiveKeys: GitKeysStatus | undefined =
    keysStatus ??
    setup?.keys ??
    setup?.keys_status ??
    health?.keys ??
    health?.keys_status ??
    health?.layout?.keys ??
    health?.layout?.keys_status;

  const confirmName = detachInfo?.confirm_name || "";
  const canDetach =
    Boolean(confirmName) &&
    detachConfirm.trim() === confirmName &&
    !detachMut.isPending;

  const pageLoading =
    (healthLoading && !health) ||
    (setupLoading && !setup) ||
    (credsLoading && !creds) ||
    (keysLoading && !effectiveKeys && Boolean(health?.repo_is_git));

  if (pageLoading) {
    return <GitLoadingPanel label="Loading git settings…" />;
  }

  const repoLoading = Boolean(health?.repo_is_git) && remoteLoading && !remote;

  return (
    <div
      className="flex w-full flex-col gap-6"
      data-testid="git-settings-page"
    >
      <section className="w-full space-y-2 rounded-md border p-4">
        <h3 className="text-sm font-semibold">Repository info</h3>
        {repoLoading ? (
          <GitLoadingPanel label="Loading repository…" compact />
        ) : (
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Local path</dt>
            <dd className="break-all font-mono text-xs">
              {setup?.dest_dir || setup?.repo_root || "—"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Remote</dt>
            <dd className="break-all font-mono text-xs">
              {remote?.url || "—"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Provider</dt>
            <dd>{remote?.provider || "GitLab"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Project</dt>
            <dd className="font-mono text-xs">
              {remote?.project_path || "—"}
            </dd>
          </div>
          {remote?.web_url && (
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">Web</dt>
              <dd>
                <a
                  href={remote.web_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {remote.web_url}
                </a>
              </dd>
            </div>
          )}
        </dl>
        )}
      </section>

      <section className="w-full space-y-2 rounded-md border p-4">
        <h3 className="text-sm font-semibold">Production branch</h3>
        <p className="font-mono text-sm">
          {prod?.name || health?.production_branch || "—"}
        </p>
        <p className="text-xs text-muted-foreground">
          Immutable file{" "}
          <span className="font-mono">.langflow/production-branch</span> in the
          repo. Desktop never pushes this branch.
        </p>
      </section>

      <section className="w-full space-y-3 rounded-md border p-4">
        <h3 className="text-sm font-semibold">Personal access token</h3>
        <p className="text-xs text-muted-foreground">
          Status:{" "}
          {creds?.configured
            ? `configured (${creds.source || "unknown"})`
            : "not configured"}
        </p>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="GitLab PAT (glpat-…)"
          allowAutofill
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={storeMut.isPending || !token.trim()}
            loading={storeMut.isPending}
            onClick={() =>
              void (async () => {
                try {
                  await storeMut.mutateAsync({ token: token.trim() });
                  setToken("");
                  setSuccessData({ title: "PAT stored" });
                  await refetch();
                } catch (err) {
                  setErrorData(extractGitError(err));
                }
              })()
            }
          >
            Save PAT
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!creds?.configured || clearMut.isPending}
            onClick={() => setClearPatOpen(true)}
          >
            Clear
          </Button>
        </div>
      </section>

      <section className="w-full space-y-3 rounded-md border p-4">
        <h3 className="text-sm font-semibold">Age encryption keys</h3>
        <p className="text-xs text-muted-foreground">
          Keys live in OS keyring after unlocking{" "}
          <span className="font-mono">.langflow/keys.age</span> during setup.
          Desktop encrypts variables with{" "}
          <span className="font-mono">production.pub</span> +{" "}
          <span className="font-mono">flow-ci.pub</span>; decrypt uses{" "}
          <span className="font-mono">flow-ci.key</span> only.
        </p>
        <dl className="space-y-1 text-xs text-muted-foreground">
          <div className="flex gap-2">
            <dt className="w-36 shrink-0">Status</dt>
            <dd data-testid="git-keys-status">
              {keysStatusLabel(effectiveKeys)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-36 shrink-0">Passphrase stored</dt>
            <dd>{effectiveKeys?.has_passphrase ? "yes" : "no"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-36 shrink-0">production.pub</dt>
            <dd>{effectiveKeys?.entries?.["production.pub"] ? "yes" : "no"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-36 shrink-0">flow-ci.pub</dt>
            <dd>{effectiveKeys?.entries?.["flow-ci.pub"] ? "yes" : "no"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-36 shrink-0">flow-ci.key</dt>
            <dd>{effectiveKeys?.entries?.["flow-ci.key"] ? "yes" : "no"}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          Re-unlock via the git setup wizard after detach, or when passphrase
          fails on pull/checkout.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={!effectiveKeys?.unlocked || syncingSecrets}
          loading={syncingSecrets}
          onClick={() =>
            void (async () => {
              setSyncingSecrets(true);
              try {
                const { api } = await import("@/controllers/API/api");
                const { getURL } = await import(
                  "@/controllers/API/helpers/constants"
                );
                const res = await api.post(`${getURL("GIT")}/secrets/sync`);
                const written = res.data?.written ?? 0;
                setSuccessData({
                  title: `Synced ${written} variable(s) to git`,
                });
              } catch (err) {
                setErrorData(extractGitError(err));
              } finally {
                setSyncingSecrets(false);
              }
            })()
          }
        >
          Sync variables now
        </Button>
      </section>

      <section className="w-full space-y-3 rounded-md border border-destructive/60 bg-destructive/5 p-4">
        <h3 className="text-sm font-semibold text-destructive">
          Detach repository
        </h3>
        <p className="text-xs text-muted-foreground">
          Permanently remove the local git clone, clear stored PAT and age keys
          from keyring, wipe all flows from the database, and return to the git
          setup wizard. This cannot be undone from the app.
        </p>
        {confirmName ? (
          <p className="text-xs text-muted-foreground">
            Type{" "}
            <span className="font-mono font-semibold text-foreground">
              {confirmName}
            </span>{" "}
            to enable detach.
          </p>
        ) : (
          <p className="text-xs text-destructive">
            Cannot resolve repository name — detach unavailable.
          </p>
        )}
        <Input
          value={detachConfirm}
          onChange={(e) => setDetachConfirm(e.target.value)}
          placeholder={confirmName || "repository name"}
          autoComplete="off"
          allowAutofill
        />
        <Button
          size="sm"
          variant="destructive"
          disabled={!canDetach}
          loading={detachMut.isPending}
          onClick={() =>
            void (async () => {
              try {
                await detachMut.mutateAsync({
                  confirm: detachConfirm.trim(),
                });
                setSuccessData({ title: "Repository detached" });
              } catch (err) {
                setErrorData(extractGitError(err));
              }
            })()
          }
        >
          Detach git repository
        </Button>
      </section>

      <GitConfirmDialog
        open={clearPatOpen}
        onOpenChange={setClearPatOpen}
        tone="warning"
        title="Clear stored PAT"
        description="Remove the GitLab personal access token from this machine. Push/pull and merge-request calls will fail until a new PAT is saved."
        confirmLabel="Clear PAT"
        busy={clearMut.isPending}
        onConfirm={() => {
          setClearPatOpen(false);
          void (async () => {
            try {
              await clearMut.mutateAsync(undefined);
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
