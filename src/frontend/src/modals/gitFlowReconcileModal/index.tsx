import { useState } from "react";
import { Button } from "@/components/ui/button";
import BaseModal from "@/modals/baseModal";

export type GitReconcileAction = "take_disk" | "keep_db_write_disk" | "abort";

export type GitDriftInfo = {
  flowId: string;
  dbSha256?: string | null;
  diskSha256?: string | null;
  hasDiskFile?: boolean;
};

type Props = {
  open: boolean;
  drift: GitDriftInfo | null;
  busy?: boolean;
  onAction: (action: GitReconcileAction) => void;
};

/**
 * Minimal reconcile UI when DB cache ≠ git working-tree file.
 */
export default function GitFlowReconcileModal({
  open,
  drift,
  busy = false,
  onAction,
}: Props): JSX.Element {
  const [localBusy, setLocalBusy] = useState(false);
  const isBusy = busy || localBusy;

  const run = (action: GitReconcileAction) => {
    setLocalBusy(true);
    onAction(action);
  };

  return (
    <BaseModal open={open} setOpen={() => onAction("abort")} size="small">
      <BaseModal.Header description="Git SoT drift">
        Flow file differs from database cache
      </BaseModal.Header>
      <BaseModal.Content>
        <p className="mb-3 text-sm text-muted-foreground">
          Working-tree JSON and SQLite cache disagree. Choose which source to
          keep before opening the flow.
        </p>
        {drift && (
          <div className="mb-4 space-y-1 rounded-md bg-muted p-3 font-mono text-xs">
            <div>flow: {drift.flowId}</div>
            <div>db: {drift.dbSha256 ?? "—"}</div>
            <div>disk: {drift.diskSha256 ?? "—"}</div>
            <div>has file: {String(!!drift.hasDiskFile)}</div>
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            disabled={isBusy}
            data-testid="git-reconcile-abort"
            onClick={() => run("abort")}
          >
            Abort
          </Button>
          <Button
            variant="outline"
            disabled={isBusy || !drift?.hasDiskFile}
            data-testid="git-reconcile-take-disk"
            onClick={() => run("take_disk")}
          >
            Take disk
          </Button>
          <Button
            disabled={isBusy}
            data-testid="git-reconcile-keep-db"
            onClick={() => run("keep_db_write_disk")}
          >
            Keep DB → write disk
          </Button>
        </div>
      </BaseModal.Content>
    </BaseModal>
  );
}
