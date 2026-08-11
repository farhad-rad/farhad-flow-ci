import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  busy?: boolean;
  defaultDestHint?: string;
  onClone: (payload: {
    url: string;
    dest_dir?: string;
    token?: string;
    branch?: string;
  }) => Promise<void>;
};

/**
 * Compact connect-repo form for Settings panel.
 * Dest is always ``{config_dir}/flows-repo`` — no manual path / env.
 */
export default function ConnectWizard({
  busy,
  defaultDestHint,
  onClone,
}: Props): JSX.Element {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [branch, setBranch] = useState("");

  return (
    <section
      className="space-y-2 rounded-md border p-3"
      data-testid="git-connect-wizard"
    >
      <div className="text-sm font-semibold">Connect repository</div>
      <p className="text-xs text-muted-foreground">
        Clone into{" "}
        <span className="font-mono">
          {defaultDestHint || "{config_dir}/flows-repo"}
        </span>
        . Prefer the welcome setup wizard on first launch.
      </p>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://gitlab.com/group/flows.git"
        data-testid="git-clone-url"
        allowAutofill
      />
      <Input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="PAT"
        data-testid="git-clone-pat"
        allowAutofill
      />
      <Input
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
        placeholder="Branch (optional)"
        data-testid="git-clone-branch"
        allowAutofill
      />
      <Button
        size="sm"
        disabled={busy || !url.trim()}
        data-testid="git-clone-submit"
        onClick={() =>
          void onClone({
            url: url.trim(),
            token: token.trim() || undefined,
            branch: branch.trim() || undefined,
          })
        }
      >
        Clone
      </Button>
    </section>
  );
}
