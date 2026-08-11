import { debounce } from "lodash";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePermissions } from "@/contexts/permissionsContext";
import { useDeleteDeleteFlows } from "@/controllers/API/queries/flows/use-delete-delete-flows";
import { useGetDownloadFlows } from "@/controllers/API/queries/flows/use-get-download-flows";
import DeleteConfirmationModal from "@/modals/deleteConfirmationModal";
import useAlertStore from "@/stores/alertStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import { useUtilityStore } from "@/stores/utilityStore";
import { cn } from "@/utils/utils";

import type { FlowTabType } from "../../types";

interface HeaderComponentProps {
  flowType: FlowTabType;
  setFlowType: (flowType: FlowTabType) => void;
  setNewProjectModal: (newProjectModal: boolean) => void;
  /**
   * Primary "New Flow" handler. Preferred when defined — bypasses the
   * templates modal and routes the user straight to a freshly-created
   * empty flow with the welcome overlay primed. Falls back to opening the
   * templates modal when not provided so legacy call sites still work.
   */
  onNewFlow?: () => void;
  folderName?: string;
  setSearch: (search: string) => void;
  isEmptyFolder: boolean;
  selectedFlows: string[];
  /** When true, New Flow lives in PageLayout hero — hide duplicate here. */
  hidePrimaryAction?: boolean;
}

const HeaderComponent = ({
  folderName = "",
  flowType,
  setFlowType,
  setNewProjectModal,
  onNewFlow,
  setSearch,
  isEmptyFolder,
  selectedFlows,
  hidePrimaryAction = false,
}: HeaderComponentProps) => {
  const { t } = useTranslation();
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const setSuccessData = useAlertStore((state) => state.setSuccessData);
  const debouncedSetSearch = useCallback(
    debounce((value: string) => {
      setSearch(value);
    }, 1000),
    [setSearch],
  );

  const { mutate: downloadFlows, isPending: isDownloading } =
    useGetDownloadFlows();
  const { mutate: deleteFlows, isPending: isDeleting } = useDeleteDeleteFlows();

  useEffect(() => {
    debouncedSetSearch(debouncedSearch);

    return () => {
      debouncedSetSearch.cancel();
    };
  }, [debouncedSearch, debouncedSetSearch]);

  // Desktop: flows only (no project tabs / MCP / components).
  useEffect(() => {
    if (flowType !== "flows") {
      setFlowType("flows");
    }
  }, [flowType, setFlowType]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDebouncedSearch(e.target.value);
  };

  const hideNewFlowButton = useUtilityStore((s) => s.hideNewFlowButton);

  const handleDownload = () => {
    downloadFlows({ ids: selectedFlows });
    setSuccessData({ title: t("mainPage.flowsDownloadedSuccess") });
  };

  const flows = useFlowsManagerStore((state) => state.flows);
  const setFlows = useFlowsManagerStore((state) => state.setFlows);

  const handleDelete = () => {
    deleteFlows(
      { flow_ids: selectedFlows },
      {
        onSuccess: () => {
          setSuccessData({ title: t("mainPage.flowsDeletedSuccess") });
          if (flows) {
            setFlows(flows.filter((flow) => !selectedFlows.includes(flow.id)));
          }
        },
      },
    );
  };

  const hasSelection = selectedFlows.length > 0;
  const { can } = usePermissions();
  const canBulkDownload = selectedFlows.every((id) => can(id, "read"));
  const canBulkDelete = selectedFlows.every((id) => can(id, "delete"));

  return (
    <>
      {!isEmptyFolder && (
        <>
          {flowType !== "mcp" && flowType !== "deployments" && (
            <div className="flex w-full items-center gap-2">
              <Input
                icon="Search"
                data-testid="search-store-input"
                type="text"
                placeholder={t("mainPage.searchPlaceholder", {
                  flowType: t(`mainPage.flowType.${flowType}`),
                })}
                className="w-full min-w-0 flex-1 !text-mmd"
                inputClassName="!text-mmd"
                value={debouncedSearch}
                onChange={handleSearch}
              />
              <div
                className={cn(
                  "flex shrink-0 items-center gap-2 overflow-hidden opacity-0 transition-all duration-300",
                  selectedFlows.length > 0 ? "w-auto opacity-100" : "w-0",
                )}
              >
                <Button
                  variant="outline"
                  size="iconMd"
                  className="h-8 w-8"
                  data-testid="download-bulk-btn"
                  onClick={handleDownload}
                  loading={isDownloading}
                  disabled={!canBulkDownload}
                  tabIndex={hasSelection && canBulkDownload ? 0 : -1}
                  aria-label={t("flows.downloadSelected")}
                >
                  <ForwardedIconComponent name="Download" />
                </Button>
                <DeleteConfirmationModal
                  asChild
                  onConfirm={handleDelete}
                  description={"flow" + (selectedFlows.length > 1 ? "s" : "")}
                  note={
                    "and " +
                    (selectedFlows.length > 1 ? "their" : "its") +
                    " message history"
                  }
                >
                  <Button
                    variant="destructive"
                    size="iconMd"
                    className="px-2.5 !text-mmd"
                    data-testid="delete-bulk-btn"
                    loading={isDeleting}
                    disabled={!canBulkDelete}
                    tabIndex={hasSelection && canBulkDelete ? 0 : -1}
                  >
                    <ForwardedIconComponent name="Trash2" />
                    {t("mainPage.delete")}
                  </Button>
                </DeleteConfirmationModal>
              </div>
              {!hidePrimaryAction && !hideNewFlowButton && (
                <ShadTooltip content={t("mainPage.newFlow")} side="bottom">
                  <Button
                    variant="default"
                    size="iconMd"
                    className="z-50 shrink-0 px-2.5 !text-mmd"
                    onClick={() =>
                      onNewFlow ? onNewFlow() : setNewProjectModal(true)
                    }
                    id="new-project-btn"
                    data-testid="new-project-btn"
                  >
                    <ForwardedIconComponent
                      name="Plus"
                      aria-hidden="true"
                      className="h-4 w-4"
                    />
                    <span className="hidden whitespace-nowrap font-semibold md:inline">
                      {t("mainPage.newFlow")}
                    </span>
                  </Button>
                </ShadTooltip>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
};

export default HeaderComponent;
