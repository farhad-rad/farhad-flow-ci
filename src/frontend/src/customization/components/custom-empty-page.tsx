import { EmptyPageCommunity } from "@/pages/MainPage/pages/empty-page";
import { useGetGitSetupStatus } from "@/controllers/API/queries/git";
import { GitSetupWizard } from "@/features/git/GitSetupWizard";

export const CustomEmptyPageCommunity = ({
  setOpenModal,
}: {
  setOpenModal: (open: boolean) => void;
}) => {
  const { data } = useGetGitSetupStatus();

  // Gate normally blocks earlier; keep wizard on empty welcome if needed.
  if (data && !data.ready) {
    return <GitSetupWizard />;
  }

  return <EmptyPageCommunity setOpenModal={setOpenModal} />;
};
export default CustomEmptyPageCommunity;
