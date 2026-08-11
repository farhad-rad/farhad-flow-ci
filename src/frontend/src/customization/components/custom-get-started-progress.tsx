import type { Users } from "@/types/api";

/** Git-SoT Desktop: hide Langflow "Get started" onboarding card. */
export function CustomGetStartedProgress(_props: {
  userData: Users;
  isGithubStarred: boolean;
  isDiscordJoined: boolean;
  handleDismissDialog: () => void;
}) {
  return null;
}

export default CustomGetStartedProgress;
