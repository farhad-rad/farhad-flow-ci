import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/utils/utils";

export type ConfirmTone = "danger" | "warning" | "accent";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  busy?: boolean;
  onConfirm: () => void;
};

const TONE: Record<
  ConfirmTone,
  {
    border: string;
    bg: string;
    title: string;
    button: string;
  }
> = {
  danger: {
    border: "border-destructive/60",
    bg: "bg-destructive/5",
    title: "text-destructive",
    button: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  },
  warning: {
    border: "border-amber-500/60",
    bg: "bg-amber-500/5",
    title: "text-amber-700 dark:text-amber-300",
    button:
      "bg-amber-600 text-white hover:bg-amber-600/90 dark:bg-amber-500 dark:text-black",
  },
  accent: {
    border: "border-primary/40",
    bg: "bg-primary/5",
    title: "text-foreground",
    button: "bg-primary text-primary-foreground hover:bg-primary/90",
  },
};

/** App-styled confirm; replaces native ``window.confirm``. */
export function GitConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  tone = "accent",
  busy = false,
  onConfirm,
}: Props): JSX.Element {
  const t = TONE[tone];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("max-w-md border", t.border, t.bg)}
        data-testid="git-confirm-dialog"
      >
        <DialogHeader>
          <DialogTitle className={t.title}>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            className={t.button}
            variant="outline"
            disabled={busy}
            loading={busy}
            onClick={() => {
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
