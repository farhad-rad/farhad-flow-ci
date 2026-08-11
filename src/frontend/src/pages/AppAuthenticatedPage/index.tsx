import { Outlet } from "react-router-dom";
import { ExtensionEventsListener } from "@/components/extensions/ExtensionEventsListener";
import GitAutoCommitToasts from "@/components/core/gitPanel/GitAutoCommitToasts";
import { ENABLE_EXTENSION_RELOAD } from "@/customization/feature-flags";
import { useCustomPostAuth } from "@/customization/hooks/use-custom-post-auth";
import { GitSetupGate } from "@/features/git/GitSetupGate";
import { useUtilityStore } from "@/stores/utilityStore";

export function AppAuthenticatedPage() {
  useCustomPostAuth();
  const enableExtensionReloadRuntime = useUtilityStore(
    (state) => state.enableExtensionReload,
  );
  const extensionsEnabled =
    ENABLE_EXTENSION_RELOAD && enableExtensionReloadRuntime;

  return (
    <GitSetupGate>
      {extensionsEnabled && <ExtensionEventsListener />}
      <GitAutoCommitToasts />
      <Outlet />
    </GitSetupGate>
  );
}
