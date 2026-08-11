import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newBranch: string;
  onNewBranchChange: (value: string) => void;
  fromBranch: string;
  onFromBranchChange: (value: string) => void;
  branchOptions: string[];
  busy?: boolean;
  onSubmit: () => void;
};

/** Shared Create branch modal (History + Branches pages). */
export function CreateBranchDialog({
  open,
  onOpenChange,
  newBranch,
  onNewBranchChange,
  fromBranch,
  onFromBranchChange,
  branchOptions,
  busy = false,
  onSubmit,
}: Props): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create branch</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              New branch name
            </label>
            <Input
              value={newBranch}
              onChange={(e) => onNewBranchChange(e.target.value)}
              placeholder="feature/my-flows"
              onKeyDown={(e) => {
                if (e.key === "Enter") onSubmit();
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              From branch
            </label>
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={fromBranch}
              onChange={(e) => onFromBranchChange(e.target.value)}
              disabled={busy}
            >
              {branchOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !newBranch.trim() || !fromBranch.trim()}
              loading={busy}
              onClick={onSubmit}
            >
              Create & checkout
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
