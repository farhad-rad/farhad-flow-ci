import type { FC } from "react";
import type { Users } from "@/types/api";

/** Desktop fork: Langflow get-started (GitHub/Discord) removed. */
export const GetStartedProgress: FC<{
  userData: Users;
  isGithubStarred: boolean;
  isDiscordJoined: boolean;
  handleDismissDialog: () => void;
}> = () => null;
