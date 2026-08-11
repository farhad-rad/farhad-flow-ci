import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router-dom";
import GitHealthBanner from "@/components/core/gitHealthBanner";
import { useDeleteFolders } from "@/controllers/API/queries/folders";
import CustomEmptyPageCommunity from "@/customization/components/custom-empty-page";
import CustomLoader from "@/customization/components/custom-loader";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import useAlertStore from "@/stores/alertStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import { useFolderStore } from "@/stores/foldersStore";
import ModalsComponent from "../components/modalsComponent";
import { shouldShowMainContent } from "./main-page-utils";

/** Single-project shell: no projects sidebar; flows load via default folder. */
export default function CollectionPage(): JSX.Element {
  const [openModal, setOpenModal] = useState(false);
  const [openDeleteFolderModal, setOpenDeleteFolderModal] = useState(false);
  const navigate = useCustomNavigate();
  const flows = useFlowsManagerStore((state) => state.flows);
  const examples = useFlowsManagerStore((state) => state.examples);
  const setSuccessData = useAlertStore((state) => state.setSuccessData);
  const setErrorData = useAlertStore((state) => state.setErrorData);
  const { t } = useTranslation();
  const folderToEdit = useFolderStore((state) => state.folderToEdit);
  const folders = useFolderStore((state) => state.folders);
  const queryClient = useQueryClient();

  useEffect(() => {
    return () => queryClient.removeQueries({ queryKey: ["useGetFolder"] });
  }, []);

  const { mutate } = useDeleteFolders();

  const handleDeleteFolder = () => {
    mutate(
      {
        folder_id: folderToEdit?.id!,
      },
      {
        onSuccess: () => {
          setSuccessData({
            title: t("project.deletedSuccessfully"),
          });
          navigate("/all");
        },
        onError: (err) => {
          console.error(err);
          setErrorData({
            title: t("project.errorDeleting"),
          });
        },
      },
    );
  };

  const showMainContent = shouldShowMainContent(flows, examples, folders);

  return (
    <>
      <main className="flex h-full w-full overflow-hidden">
        {flows && examples && folders ? (
          <div className="relative mx-auto flex h-full w-full flex-col overflow-hidden">
            <GitHealthBanner />
            {showMainContent ? (
              <Outlet />
            ) : (
              <CustomEmptyPageCommunity setOpenModal={setOpenModal} />
            )}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <CustomLoader remSize={20} />
          </div>
        )}
      </main>
      <ModalsComponent
        openModal={openModal}
        setOpenModal={setOpenModal}
        openDeleteFolderModal={openDeleteFolderModal}
        setOpenDeleteFolderModal={setOpenDeleteFolderModal}
        handleDeleteFolder={handleDeleteFolder}
      />
    </>
  );
}
