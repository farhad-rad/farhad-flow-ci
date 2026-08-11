import type { ReactNode } from "react";
import { useGetGitSetupStatus } from "@/controllers/API/queries/git";
import { GitLoadingPanel } from "./GitLoadingPanel";
import { GitSetupWizard } from "./GitSetupWizard";

/**
 * Force full-screen git install wizard on every authenticated route
 * until ``GET /api/v1/git/setup/status`` reports ready.
 */
export function GitSetupGate({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const { data, isLoading, isError, refetch } = useGetGitSetupStatus();

  if (isLoading && !data) {
    return <GitLoadingPanel label="Checking git connection…" />;
  }

  // Fail closed when API unreachable or setup incomplete
  if (isError || !data?.ready) {
    return (
      <GitSetupWizard
        onReady={() => {
          void refetch();
        }}
      />
    );
  }

  return <>{children}</>;
}

export default GitSetupGate;
