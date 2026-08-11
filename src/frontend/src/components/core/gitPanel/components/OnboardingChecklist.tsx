import { Button } from "@/components/ui/button";
import type { GitHealthResponse, GitStatusResponse } from "@/features/git/types";
import { useGitUiStore } from "@/features/git/store";

type Props = {
  health?: GitHealthResponse;
  status?: GitStatusResponse;
};

/** First-run onboarding checklist (8.3). */
export default function OnboardingChecklist({
  health,
  status,
}: Props): JSX.Element | null {
  const dismissed = useGitUiStore((s) => s.onboardingDismissed);
  const dismiss = useGitUiStore((s) => s.dismissOnboarding);

  if (dismissed) return null;

  const layout = health?.layout?.checks;
  const keysUnlocked =
    health?.keys?.unlocked ??
    health?.keys_status?.unlocked ??
    health?.layout?.keys?.unlocked ??
    health?.layout?.keys_status?.unlocked;

  const items = [
    {
      ok: Boolean(health?.git_binary_available),
      label: "System git installed",
    },
    {
      ok: Boolean(health?.setup_complete ?? health?.repo_is_git),
      label: "Flows repo connected",
    },
    {
      ok: Boolean(layout?.production_branch),
      label: ".langflow/production-branch (required)",
    },
    {
      ok: Boolean(layout?.keys_age),
      label: ".langflow/keys.age (required)",
    },
    {
      ok: Boolean(keysUnlocked),
      label: "Age keys unlocked in keyring",
    },
    {
      ok: Boolean(layout?.flows_dir ?? true),
      label: "flows/ folder present",
    },
    {
      ok: Boolean(layout?.flows_lock ?? true),
      label: "flows.lock present",
    },
    {
      ok: Boolean(health?.pat?.configured),
      label: "PAT configured",
    },
    {
      ok: Boolean(status?.production_branch || health?.production_branch),
      label: "Production branch resolved",
    },
  ];

  const allOk = items.every((i) => i.ok);

  return (
    <section
      className="space-y-2 rounded-md border border-dashed p-3 text-xs"
      data-testid="git-onboarding"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">Git Desktop checklist</span>
        <Button size="xs" variant="ghost" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.label} className="flex gap-2">
            <span>{item.ok ? "✓" : "○"}</span>
            <span className={item.ok ? "text-muted-foreground" : ""}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
      {allOk && (
        <p className="text-muted-foreground">Ready — save a flow, then commit from History.</p>
      )}
    </section>
  );
}
