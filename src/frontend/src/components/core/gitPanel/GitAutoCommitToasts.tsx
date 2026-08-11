import { useEffect, useRef } from "react";
import { useGetGitOpsLog } from "@/controllers/API/queries/git";
import useAlertStore from "@/stores/alertStore";
import useAuthStore from "@/stores/authStore";

/**
 * Poll ops-log for auto-commit success/fail toasts (8.2) while authenticated.
 */
export default function GitAutoCommitToasts(): null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setSuccessData = useAlertStore((s) => s.setSuccessData);
  const setErrorData = useAlertStore((s) => s.setErrorData);
  const lastTs = useRef<string | null>(null);

  const { data } = useGetGitOpsLog(
    { limit: 20 },
    { enabled: isAuthenticated },
  );

  useEffect(() => {
    const lines = data?.lines ?? [];
    if (!lines.length) return;
    const last = lines[lines.length - 1];
    try {
      const row = JSON.parse(last) as {
        ts?: string;
        op?: string;
        ok?: boolean;
        detail?: { message?: string; skipped?: unknown };
        error?: string;
      };
      if (!row.ts || row.ts === lastTs.current) return;
      const prev = lastTs.current;
      lastTs.current = row.ts;
      if (!prev) return;
      if (row.op !== "auto_commit") return;
      if (row.detail && (row.detail as { skipped?: unknown }).skipped) return;
      if (row.ok) {
        setSuccessData({
          title: "Auto-commit saved",
          list: row.detail?.message ? [row.detail.message] : undefined,
        });
      } else {
        setErrorData({
          title: "Auto-commit failed",
          list: [row.error || "See .langflow/git-ops.log"],
        });
      }
    } catch {
      /* ignore */
    }
  }, [data?.lines, setErrorData, setSuccessData]);

  return null;
}
