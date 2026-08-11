import { useTranslation } from "react-i18next";
import LangflowLogo from "@/assets/LangflowLogo.svg?react";
import CardsWrapComponent from "@/components/core/cardsWrapComponent";
import { useStartNewFlow } from "@/components/core/flowBuilderWelcome/hooks/use-start-new-flow";
import { Button } from "@/components/ui/button";
import { DotBackgroundDemo } from "@/components/ui/dot-background";
import { useFolderStore } from "@/stores/foldersStore";
import useFileDrop from "../hooks/use-on-file-drop";

export const EmptyPageCommunity = ({
  setOpenModal: _setOpenModal,
}: {
  setOpenModal: (open: boolean) => void;
}) => {
  const { t } = useTranslation();
  const handleFileDrop = useFileDrop(undefined);
  const folders = useFolderStore((state) => state.folders);
  const startNewFlow = useStartNewFlow();

  return (
    <DotBackgroundDemo>
      <CardsWrapComponent
        dragMessage={t("home.dragFlowsOrComponents")}
        onFileDrop={handleFileDrop}
      >
        <div className="m-0 h-full w-full bg-background p-0">
          <div className="z-50 flex h-full w-full flex-col items-center justify-center gap-5">
            <div className="z-50 flex flex-col items-center gap-2">
              <div className="relative z-50 flex h-28 w-28 items-center justify-center rounded-2xl border border-border bg-background shadow-[0_0_40px_-8px_hsl(var(--primary)/0.45)]">
                <LangflowLogo
                  className="h-14 w-14 text-foreground"
                  aria-hidden="true"
                  data-testid="empty_page_logo"
                />
              </div>
              <span
                data-testid="mainpage_title"
                className="z-50 text-center font-chivo text-2xl font-medium text-foreground"
              >
                {t("page.welcomeTitle")}
              </span>

              <span
                data-testid="empty_page_description"
                className="z-50 text-center text-base text-secondary-foreground"
              >
                {folders?.length > 1
                  ? t("page.emptyFolder")
                  : "Flows sync from your connected git repo."}
              </span>
            </div>

            <div className="flex w-full max-w-[510px] flex-col gap-7 sm:gap-[29px]">
              <Button
                unstyled
                className="group mx-3 min-h-[84px] sm:mx-0"
                onClick={() => startNewFlow()}
                id="new-project-btn"
                data-testid="new_project_btn_empty_page"
              >
                <div className="relative flex flex-col rounded-lg border-[1px] bg-background p-4 text-left transition-all duration-300 hover:border-foreground/40">
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-lg font-semibold leading-none">
                      +
                    </div>
                    <span className="font-semibold">
                      {t("page.createFirstFlow")}
                    </span>
                  </div>
                  <div className="mt-2 pl-9">
                    <span className="line-clamp-2 text-base text-secondary-foreground">
                      Start a new flow. Saves commit to your flows git repo.
                    </span>
                  </div>
                </div>
              </Button>
            </div>
          </div>
        </div>
        <p
          data-testid="empty_page_drag_and_drop_text"
          className="absolute bottom-5 left-0 right-0 mt-4 cursor-default text-center text-xxs text-muted-foreground"
        >
          {t("page.dragAndDropText")}
        </p>
      </CardsWrapComponent>
    </DotBackgroundDemo>
  );
};

export default EmptyPageCommunity;
