import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import useDragStart from "@/components/core/cardComponent/hooks/use-on-drag-start";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/contexts/permissionsContext";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import useDeleteFlow from "@/hooks/flows/use-delete-flow";
import DeleteConfirmationModal from "@/modals/deleteConfirmationModal";
import ExportModal from "@/modals/exportModal";
import FlowSettingsModal from "@/modals/flowSettingsModal";
import useAlertStore from "@/stores/alertStore";
import type { FlowType } from "@/types/flow";
import { downloadFlow } from "@/utils/reactflowUtils";
import { swatchColors } from "@/utils/styleUtils";
import { cn, getNumberFromString } from "@/utils/utils";
import useDescriptionModal from "../../hooks/use-description-modal";
import { useGetTemplateStyle } from "../../utils/get-template-style";
import { timeElapsed } from "../../utils/time-elapse";
import DropdownComponent from "../dropdown";

const ListComponent = ({
  flowData,
  selected,
  setSelected,
  shiftPressed,
}: {
  flowData: FlowType;
  selected: boolean;
  setSelected: (selected: boolean) => void;
  shiftPressed: boolean;
}) => {
  const { t } = useTranslation();
  const navigate = useCustomNavigate();
  const [openDelete, setOpenDelete] = useState(false);
  const setSuccessData = useAlertStore((state) => state.setSuccessData);
  const { deleteFlow } = useDeleteFlow();
  const setErrorData = useAlertStore((state) => state.setErrorData);
  const { folderId } = useParams();
  const [openSettings, setOpenSettings] = useState(false);
  const [openExportModal, setOpenExportModal] = useState(false);
  const isComponent = flowData.is_component ?? false;

  const { getIcon } = useGetTemplateStyle(flowData);

  const editFlowLink = `/flow/${flowData.id}${folderId ? `/folder/${folderId}` : ""}`;

  const handleClick = async () => {
    if (shiftPressed) {
      setSelected(!selected);
    } else {
      if (!isComponent) {
        navigate(editFlowLink);
      }
    }
  };

  const handleDelete = () => {
    deleteFlow({ id: [flowData.id] })
      .then(() => {
        setSuccessData({
          title: t("flow.deletedSuccessfully"),
        });
      })
      .catch((err) => {
        setErrorData({
          title: t("flow.errorDeleting"),
          list: [t("flow.errorDeletingRetry")],
        });
      });
  };

  const { can } = usePermissions();
  // Moving a flow into another folder mutates its folder_id → gate on write.
  const canMove = can(flowData.id, "write");

  const { onDragStart } = useDragStart(flowData);

  const descriptionModal = useDescriptionModal(
    [flowData?.id],
    flowData.is_component ? "component" : "flow",
  );

  const swatchIndex =
    (flowData.gradient && !isNaN(parseInt(flowData.gradient))
      ? parseInt(flowData.gradient)
      : getNumberFromString(flowData.gradient ?? flowData.id)) %
    swatchColors.length;

  const handleExport = () => {
    if (flowData.is_component) {
      downloadFlow(flowData, flowData.name, flowData.description);
      setSuccessData({
        title: t("success.flowExported", { name: flowData.name }),
      });
    } else {
      setOpenExportModal(true);
    }
  };

  const [icon, setIcon] = useState<string>("");
  const flowNameId = `flow-name-${flowData.id}`;
  const openActionLabelId = `flow-open-action-${flowData.id}`;

  useEffect(() => {
    getIcon().then(setIcon);
  }, [getIcon]);

  return (
    <>
      <Card
        key={flowData.id}
        draggable={canMove}
        onDragStart={onDragStart}
        className={cn(
          "flow-glass-card relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/60 px-4 py-4 shadow-page-hero transition-[transform,box-shadow,background-color] duration-200",
          isComponent ? "cursor-default" : "cursor-pointer",
          "group hover:-translate-y-0.5 hover:border-border hover:shadow-lg",
          selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        )}
        data-testid="list-card"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 page-hero-gradient opacity-40"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-primary/10 blur-2xl"
        />
        {!isComponent && (
          <>
            <button
              type="button"
              className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={handleClick}
              aria-labelledby={`${openActionLabelId} ${flowNameId}`}
              data-testid="list-card-open-button"
            />
            <span id={openActionLabelId} className="sr-only">
              {t("flows.openFlow")}
            </span>
          </>
        )}
        <div
          className={cn(
            "pointer-events-none relative z-10 flex min-w-0 items-start gap-3",
            isComponent ? "cursor-default" : "cursor-pointer",
          )}
        >
          <div className="group/checkbox pointer-events-auto relative flex items-center">
            <div
              className={cn(
                "z-20 absolute -left-1 -top-1 flex items-center transition-all duration-300",
                selected ? "opacity-100" : "opacity-0 group-hover/checkbox:opacity-100 group-focus-within/checkbox:opacity-100",
              )}
            >
              <Checkbox
                checked={selected}
                onCheckedChange={(checked) => setSelected(checked as boolean)}
                onClick={(e) => e.stopPropagation()}
                className="ml-0"
                data-testid={`checkbox-${flowData.id}`}
                aria-label={t("flows.selectFlow", { name: flowData.name })}
              />
            </div>
            <div
              className={cn(
                `item-center flex justify-center rounded-xl p-2.5 transition-opacity duration-200`,
                swatchColors[swatchIndex],
                selected
                  ? "opacity-100"
                  : "group-hover/checkbox:opacity-80",
              )}
            >
              <ForwardedIconComponent
                name={flowData?.icon || icon}
                aria-hidden="true"
                className="flex h-5 w-5 items-center justify-center"
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-start gap-1 pr-8">
            <div
              className="truncate text-sm font-semibold text-foreground"
              data-testid={`flow-name-div`}
            >
              <span
                className="truncate"
                data-testid={flowNameId}
                id={flowNameId}
              >
                {flowData.name}
              </span>
            </div>
            {flowData.description ? (
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {flowData.description}
              </p>
            ) : null}
            <div className="text-xs text-muted-foreground">
              <span className="truncate">
                {t("mainPage.editedAgo", {
                  time: timeElapsed(flowData.updated_at, t),
                })}
              </span>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="iconMd"
                data-testid="home-dropdown-menu"
                className="pointer-events-auto group bg-background/40 backdrop-blur-sm"
                aria-label={t("flows.moreOptions", { name: flowData.name })}
              >
                <ForwardedIconComponent
                  name="Ellipsis"
                  aria-hidden="true"
                  className="h-5 w-5 text-muted-foreground group-hover:text-foreground"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[185px]"
              sideOffset={5}
              side="bottom"
            >
              <DropdownComponent
                flowData={flowData}
                setOpenDelete={setOpenDelete}
                handleExport={handleExport}
                handleEdit={() => {
                  setOpenSettings(true);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>
      {openDelete && (
        <DeleteConfirmationModal
          open={openDelete}
          setOpen={setOpenDelete}
          onConfirm={handleDelete}
          description={descriptionModal}
          note={
            !flowData.is_component ? t("deleteModal.noteMessageHistory") : ""
          }
        />
      )}
      <ExportModal
        open={openExportModal}
        setOpen={setOpenExportModal}
        flowData={flowData}
      />
      <FlowSettingsModal
        open={openSettings}
        setOpen={setOpenSettings}
        flowData={flowData}
      />
    </>
  );
};

export default ListComponent;
