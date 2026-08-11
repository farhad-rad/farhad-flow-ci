import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import PageLayout from "@/components/common/pageLayout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import FilesTab from "./components/FilesTab";

export const FilesPage = () => {
  const { t } = useTranslation();
  // biome-ignore lint/suspicious/noExplicitAny: legacy
  const [selectedFiles, setSelectedFiles] = useState<any[]>([]);
  const [quantitySelected, setQuantitySelected] = useState(0);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [quickFilterText, setQuickFilterText] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setIsShiftPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setIsShiftPressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const tabProps = {
    quickFilterText,
    setQuickFilterText,
    selectedFiles,
    setSelectedFiles,
    quantitySelected,
    setQuantitySelected,
    isShiftPressed,
  };

  return (
    <PageLayout
      title={t("files.pageTitle")}
      description={t("files.pageDescription")}
      nav={
        <div className="h-7 w-10 lg:hidden">
          <SidebarTrigger>
            <ForwardedIconComponent name="PanelLeftOpen" aria-hidden="true" />
          </SidebarTrigger>
        </div>
      }
      className="h-full overflow-hidden"
      contentClassName="overflow-hidden"
    >
      <div className="flex h-full w-full flex-col overflow-y-auto" data-testid="cards-wrapper">
        <FilesTab {...tabProps} />
      </div>
    </PageLayout>
  );
};

export default FilesPage;
