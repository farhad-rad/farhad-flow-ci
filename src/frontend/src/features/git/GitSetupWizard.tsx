import { useMemo, useState } from "react";
import LangflowLogo from "@/assets/LangflowLogo.svg?react";
import { Button } from "@/components/ui/button";
import { DotBackgroundDemo } from "@/components/ui/dot-background";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useGetGitSetupNamespaces,
  useGetGitSetupProjectBranches,
  useGetGitSetupProjects,
  useGetGitSetupStatus,
} from "@/controllers/API/queries/git";
import {
  usePostGitSetupCreateProject,
  usePostGitSetupHost,
  usePostGitSetupInstall,
  usePostGitSetupPat,
  usePostGitSetupUnlockKeys,
  usePostGitSetupValidateBranch,
} from "@/controllers/API/queries/git";
import { catalogForCode } from "@/features/git/errorCatalog";
import type {
  GitLabProject,
  GitSetupInstallMode,
  GitSetupStatus,
} from "@/features/git/types";

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const FRESH_BRANCH = "main";

function errMessage(err: unknown): string {
  const anyErr = err as {
    response?: { data?: { detail?: unknown } };
    message?: string;
  };
  const detail = anyErr?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const d = detail as { code?: string; message?: string };
    if (d.code) {
      const cat = catalogForCode(d.code);
      return d.message ? `${cat.title}: ${d.message}` : `${cat.title}. ${cat.hint}`;
    }
    if (d.message) return d.message;
  }
  return anyErr?.message || "Request failed";
}

function CheckRow({
  label,
  ok,
  mandatory = false,
}: {
  label: string;
  ok?: boolean;
  mandatory?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-secondary-foreground">
        {label}
        {mandatory ? " (required)" : ""}
      </span>
      <span className={ok ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
        {ok ? "OK" : "Missing"}
      </span>
    </div>
  );
}

export function GitSetupWizard({
  onReady,
}: {
  onReady?: () => void;
}): JSX.Element {
  const { data: status, refetch } = useGetGitSetupStatus();
  const hostMut = usePostGitSetupHost();
  const patMut = usePostGitSetupPat();
  const createProjectMut = usePostGitSetupCreateProject();
  const validateBranchMut = usePostGitSetupValidateBranch();
  const unlockMut = usePostGitSetupUnlockKeys();
  const installMut = usePostGitSetupInstall();

  const [step, setStep] = useState<Step>(1);
  const [host, setHost] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [token, setToken] = useState("");
  const [repoMode, setRepoMode] = useState<GitSetupInstallMode>("existing");
  const [projectSearch, setProjectSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<GitLabProject | null>(
    null,
  );
  const [newProjectName, setNewProjectName] = useState("");
  const [namespaceId, setNamespaceId] = useState<string>("");
  const [visibility, setVisibility] = useState("private");
  const [branch, setBranch] = useState("");
  const [branchValidated, setBranchValidated] = useState(false);
  const [keysAgeFile, setKeysAgeFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [keysUnlocked, setKeysUnlocked] = useState(false);
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<GitSetupStatus | null>(
    null,
  );

  const hostReady = Boolean(host.trim() && apiBase);
  const projectId = selectedProject?.id;

  const { data: projectsData, isFetching: projectsLoading } =
    useGetGitSetupProjects(
      hostReady ? { host: host.trim(), search: projectSearch.trim() } : null,
      { enabled: step >= 3 && repoMode === "existing" },
    );

  const { data: namespacesData } = useGetGitSetupNamespaces(
    hostReady ? host.trim() : null,
    { enabled: step >= 3 && repoMode === "fresh" },
  );

  const { data: branchesData, isFetching: branchesLoading } =
    useGetGitSetupProjectBranches(
      repoMode === "existing" ? projectId : null,
      hostReady ? host.trim() : null,
      { enabled: step >= 4 && repoMode === "existing" },
    );

  const busy =
    hostMut.isPending ||
    patMut.isPending ||
    createProjectMut.isPending ||
    validateBranchMut.isPending ||
    unlockMut.isPending ||
    installMut.isPending;

  const destHint = status?.dest_dir || "…/flows-repo";

  const checks = useMemo(
    () => installResult?.checks || status?.checks,
    [installResult, status],
  );

  const activeProject = selectedProject;

  const submitHost = async () => {
    setError(null);
    try {
      const res = await hostMut.mutateAsync({ host: host.trim() });
      setHost(res.host);
      setApiBase(res.api_base);
      setStep(2);
    } catch (e) {
      setError(errMessage(e));
    }
  };

  const submitPat = async () => {
    setError(null);
    try {
      await patMut.mutateAsync({ token: token.trim() });
      setStep(3);
    } catch (e) {
      setError(errMessage(e));
    }
  };

  const createProject = async () => {
    setError(null);
    if (!namespaceId || !newProjectName.trim()) {
      setError("Namespace and project name are required.");
      return;
    }
    try {
      const project = await createProjectMut.mutateAsync({
        host: host.trim(),
        name: newProjectName.trim(),
        namespace_id: Number(namespaceId),
        visibility,
      });
      setSelectedProject(project);
      setBranch(FRESH_BRANCH);
      setBranchValidated(true);
      setStep(5);
    } catch (e) {
      setError(errMessage(e));
    }
  };

  const pickExistingProject = (project: GitLabProject) => {
    setSelectedProject(project);
    setBranch("");
    setBranchValidated(false);
    setStep(4);
  };

  const validateBranch = async () => {
    setError(null);
    const branchName =
      repoMode === "fresh" ? FRESH_BRANCH : branch.trim();
    if (!projectId || !branchName) {
      setError("Pick a branch.");
      return;
    }
    try {
      const res = await validateBranchMut.mutateAsync({
        host: host.trim(),
        project_id: projectId,
        branch: branchName,
      });
      if (!res.ok) {
        setError(
          `Branch layout invalid: ${(res.missing || []).join(", ") || "missing mandatory files"}`,
        );
        return;
      }
      setBranch(branchName);
      setBranchValidated(true);
      setStep(5);
    } catch (e) {
      setError(errMessage(e));
    }
  };

  const unlockKeys = async () => {
    setError(null);
    if (repoMode === "fresh") {
      if (!keysAgeFile || !passphrase.trim()) {
        setError("Upload keys.age and enter passphrase.");
        return;
      }
      try {
        const res = await unlockMut.mutateAsync({
          keys_age: keysAgeFile,
          passphrase: passphrase.trim(),
        });
        if (!res.ok || !(res.unlocked ?? res.keys?.unlocked)) {
          setError("Could not unlock keys.age.");
          return;
        }
        setKeysUnlocked(true);
        setStep(6);
      } catch (e) {
        setError(errMessage(e));
      }
      return;
    }

    if (!passphrase.trim()) {
      setError("Enter passphrase for keys.age in the repo.");
      return;
    }
    setKeysUnlocked(true);
    setStep(6);
  };

  const runInstall = async () => {
    setError(null);
    if (!activeProject) {
      setError("No project selected.");
      return;
    }
    const branchName = repoMode === "fresh" ? FRESH_BRANCH : branch.trim();
    try {
      const res = (await installMut.mutateAsync({
        mode: repoMode,
        host: host.trim(),
        project_id: activeProject.id,
        branch: branchName,
        clone_url: activeProject.http_url_to_repo,
        keys_passphrase:
          repoMode === "existing" ? passphrase.trim() || undefined : undefined,
        force,
      })) as GitSetupStatus;
      setInstallResult(res);
      await refetch();
      if (res.ready) {
        setStep(7);
        onReady?.();
      } else {
        setError(
          `Install finished but layout incomplete: ${(res.missing || []).join(", ") || "unknown"}`,
        );
        setStep(7);
      }
    } catch (e) {
      const msg = errMessage(e);
      setError(msg);
      if (msg.includes("not empty") || msg.includes("GIT_DEST_NOT_EMPTY")) {
        setForce(true);
      }
    }
  };

  const stepTitle: Record<Step, string> = {
    1: "GitLab host",
    2: "Personal access token",
    3: "Repository",
    4: "Branch",
    5: "Age keys",
    6: "Install",
    7: "Done",
  };

  return (
    <DotBackgroundDemo>
      <div
        className="m-0 flex h-full w-full flex-col items-center justify-center bg-background p-4"
        data-testid="git-setup-wizard"
      >
        <div className="z-50 flex w-full max-w-[560px] flex-col items-center gap-4">
          <div className="relative z-50 flex h-24 w-24 items-center justify-center rounded-2xl border border-border bg-background shadow-[0_0_40px_-8px_hsl(var(--primary)/0.45)]">
            <LangflowLogo
              className="h-12 w-12 text-foreground"
              aria-hidden="true"
            />
          </div>

          <h1 className="text-center font-chivo text-2xl font-medium text-foreground">
            Connect GitLab flows repository
          </h1>
          <p className="text-center text-sm text-secondary-foreground">
            GitLab-only setup: host, PAT, repo, branch, age keys, then clone
            into app data dir automatically.
          </p>

          <div className="w-full space-y-3 rounded-lg border bg-background p-4">
            <div className="text-xs text-muted-foreground">
              Step {step} of 7 · {stepTitle[step]} · dest:{" "}
              <span className="font-mono">{destHint}</span>
            </div>

            {step === 1 && (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="git-setup-host">
                  GitLab host URL
                </label>
                <Input
                  id="git-setup-host"
                  value={host}
                  onChange={(e) => {
                    setHost(e.target.value);
                    setApiBase("");
                  }}
                  placeholder="https://gitlab.example.com"
                  data-testid="git-setup-host"
                  allowAutofill
                  disabled={busy}
                />
                {apiBase && (
                  <p className="text-xs text-muted-foreground">
                    API: <span className="font-mono">{apiBase}</span>
                  </p>
                )}
                <Button
                  className="w-full"
                  disabled={busy || !host.trim()}
                  onClick={() => void submitHost()}
                  data-testid="git-setup-next-host"
                >
                  {hostMut.isPending ? "Checking…" : "Continue"}
                </Button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="git-setup-pat">
                  GitLab personal access token
                </label>
                <Input
                  id="git-setup-pat"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="glpat-…"
                  data-testid="git-setup-pat"
                  allowAutofill
                  disabled={busy}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setStep(1)}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={busy || !token.trim()}
                    onClick={() => void submitPat()}
                    data-testid="git-setup-next-pat"
                  >
                    {patMut.isPending ? "Saving…" : "Save & continue"}
                  </Button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={repoMode === "existing" ? "default" : "outline"}
                    onClick={() => {
                      setRepoMode("existing");
                      setSelectedProject(null);
                      setBranchValidated(false);
                    }}
                    data-testid="git-setup-mode-existing"
                  >
                    Existing repo
                  </Button>
                  <Button
                    size="sm"
                    variant={repoMode === "fresh" ? "default" : "outline"}
                    onClick={() => {
                      setRepoMode("fresh");
                      setSelectedProject(null);
                      setBranch(FRESH_BRANCH);
                      setBranchValidated(false);
                    }}
                    data-testid="git-setup-mode-fresh"
                  >
                    Create new
                  </Button>
                </div>

                {repoMode === "existing" ? (
                  <>
                    <Input
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      placeholder="Search GitLab projects…"
                      data-testid="git-setup-project-search"
                      allowAutofill
                      disabled={busy}
                    />
                    <div
                      className="max-h-48 space-y-1 overflow-y-auto rounded border p-2"
                      data-testid="git-setup-project-list"
                    >
                      {projectsLoading && (
                        <p className="text-xs text-muted-foreground">Loading…</p>
                      )}
                      {(projectsData?.projects ?? []).map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          className="flex w-full flex-col rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                          onClick={() => pickExistingProject(project)}
                          data-testid={`git-setup-project-${project.id}`}
                        >
                          <span className="font-medium">{project.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {project.path_with_namespace}
                          </span>
                        </button>
                      ))}
                      {!projectsLoading &&
                        (projectsData?.projects?.length ?? 0) === 0 && (
                          <p className="text-xs text-muted-foreground">
                            No projects found.
                          </p>
                        )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Namespace</label>
                      <Select
                        value={namespaceId}
                        onValueChange={setNamespaceId}
                      >
                        <SelectTrigger data-testid="git-setup-namespace">
                          <SelectValue placeholder="Pick namespace" />
                        </SelectTrigger>
                        <SelectContent>
                          {(namespacesData?.namespaces ?? []).map((ns) => (
                            <SelectItem key={ns.id} value={String(ns.id)}>
                              {ns.full_path} ({ns.kind})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="New project name"
                      data-testid="git-setup-new-project-name"
                      allowAutofill
                      disabled={busy}
                    />
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Visibility</label>
                      <Select value={visibility} onValueChange={setVisibility}>
                        <SelectTrigger data-testid="git-setup-visibility">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="private">Private</SelectItem>
                          <SelectItem value="internal">Internal</SelectItem>
                          <SelectItem value="public">Public</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setStep(2)}
                      >
                        Back
                      </Button>
                      <Button
                        className="flex-1"
                        disabled={
                          busy ||
                          !newProjectName.trim() ||
                          !namespaceId
                        }
                        onClick={() => void createProject()}
                        data-testid="git-setup-create-project"
                      >
                        {createProjectMut.isPending
                          ? "Creating…"
                          : "Create & continue"}
                      </Button>
                    </div>
                  </>
                )}

                {repoMode === "existing" && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setStep(2)}
                  >
                    Back
                  </Button>
                )}
              </div>
            )}

            {step === 4 && repoMode === "existing" && (
              <div className="space-y-2">
                {activeProject && (
                  <p className="text-sm text-muted-foreground">
                    Repo:{" "}
                    <span className="font-mono">
                      {activeProject.path_with_namespace}
                    </span>
                  </p>
                )}
                <label className="text-sm font-medium">Branch</label>
                <Select
                  value={branch}
                  onValueChange={(v) => {
                    setBranch(v);
                    setBranchValidated(false);
                  }}
                >
                  <SelectTrigger data-testid="git-setup-branch">
                    <SelectValue placeholder="Pick branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {(branchesData?.branches ?? []).map((b) => (
                      <SelectItem key={b.name} value={b.name}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {branchesLoading && (
                  <p className="text-xs text-muted-foreground">
                    Loading branches…
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setStep(3)}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={busy || !branch.trim()}
                    onClick={() => void validateBranch()}
                    data-testid="git-setup-validate-branch"
                  >
                    {validateBranchMut.isPending
                      ? "Validating…"
                      : "Validate & continue"}
                  </Button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {repoMode === "fresh"
                    ? "Upload your age-encrypted keys.age zip (production.pub, flow-ci.pub, flow-ci.key)."
                    : "Enter passphrase to decrypt keys.age from the repo after clone."}
                </p>
                {repoMode === "fresh" && (
                  <Input
                    type="file"
                    accept=".age,*"
                    onChange={(e) => {
                      setKeysAgeFile(e.target.files?.[0] ?? null);
                      setKeysUnlocked(false);
                    }}
                    data-testid="git-setup-keys-age-file"
                  />
                )}
                <Input
                  type="password"
                  value={passphrase}
                  onChange={(e) => {
                    setPassphrase(e.target.value);
                    setKeysUnlocked(false);
                  }}
                  placeholder="keys.age passphrase"
                  data-testid="git-setup-keys-passphrase"
                  allowAutofill
                  disabled={busy}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setStep(repoMode === "fresh" ? 3 : 4)
                    }
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={
                      busy ||
                      (repoMode === "fresh" && !keysAgeFile) ||
                      !passphrase.trim()
                    }
                    onClick={() => void unlockKeys()}
                    data-testid="git-setup-unlock-keys"
                  >
                    {unlockMut.isPending && repoMode === "fresh"
                      ? "Unlocking…"
                      : "Continue"}
                  </Button>
                </div>
              </div>
            )}

            {step === 6 && (
              <div className="space-y-2">
                {activeProject && (
                  <dl className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      Project:{" "}
                      <span className="font-mono">
                        {activeProject.path_with_namespace}
                      </span>
                    </div>
                    <div>
                      Branch:{" "}
                      <span className="font-mono">
                        {repoMode === "fresh" ? FRESH_BRANCH : branch}
                      </span>
                    </div>
                    <div>
                      Mode:{" "}
                      <span className="font-mono">{repoMode}</span>
                    </div>
                  </dl>
                )}
                {keysUnlocked && (
                  <p
                    className="text-sm text-green-600 dark:text-green-400"
                    data-testid="git-setup-keys-ok"
                  >
                    Keys ready
                  </p>
                )}
                {branchValidated && repoMode === "existing" && (
                  <p className="text-sm text-green-600 dark:text-green-400">
                    Branch layout validated
                  </p>
                )}
                {force && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={force}
                      onChange={(e) => setForce(e.target.checked)}
                    />
                    Replace existing local flows-repo folder
                  </label>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setStep(5)}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={
                      busy ||
                      !activeProject ||
                      !keysUnlocked ||
                      (repoMode === "existing" && !branchValidated)
                    }
                    onClick={() => void runInstall()}
                    data-testid="git-setup-install"
                  >
                    {installMut.isPending ? "Installing…" : "Install & hydrate"}
                  </Button>
                </div>
              </div>
            )}

            {step === 7 && (
              <div className="space-y-2" data-testid="git-setup-result">
                <CheckRow label="Git repository" ok={checks?.is_git} mandatory />
                <CheckRow
                  label=".langflow/production-branch"
                  ok={checks?.production_branch}
                  mandatory
                />
                <CheckRow
                  label=".langflow/keys.age"
                  ok={checks?.keys_age}
                  mandatory
                />
                <CheckRow label=".langflow/ directory" ok={checks?.langflow_dir} />
                <CheckRow label="flows/ folder" ok={checks?.flows_dir} />
                <CheckRow label="flows.lock" ok={checks?.flows_lock} />
                <CheckRow label="secrets/ folder" ok={checks?.secrets_dir} />
                <CheckRow label="secrets.lock" ok={checks?.secrets_lock} />
                {installResult?.ready || status?.ready ? (
                  <Button
                    className="mt-2 w-full"
                    onClick={() => {
                      onReady?.();
                      window.location.assign(
                        `${import.meta.env.BASE_URL || "/"}`,
                      );
                    }}
                    data-testid="git-setup-done"
                  >
                    Continue to FarhadFlowCI
                  </Button>
                ) : (
                  <Button
                    className="mt-2 w-full"
                    variant="outline"
                    onClick={() => {
                      setStep(repoMode === "fresh" ? 5 : 4);
                      setKeysUnlocked(false);
                      setBranchValidated(false);
                    }}
                  >
                    Fix & retry
                  </Button>
                )}
              </div>
            )}

            {error && (
              <p
                className="text-sm text-destructive"
                data-testid="git-setup-error"
              >
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </DotBackgroundDemo>
  );
}

export default GitSetupWizard;
