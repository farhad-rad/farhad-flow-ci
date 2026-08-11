import { create } from "zustand";

type GitUiStore = {
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  /** Highlight connect wizard when opening panel */
  focusWizard: boolean;
  setFocusWizard: (v: boolean) => void;
  diffFlowId: string | null;
  setDiffFlowId: (id: string | null) => void;
  onboardingDismissed: boolean;
  dismissOnboarding: () => void;
};

const ONBOARDING_KEY = "langflow-git-onboarding-dismissed";

function readOnboardingDismissed(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

export const useGitUiStore = create<GitUiStore>((set, get) => ({
  panelOpen: false,
  setPanelOpen: (open) => set({ panelOpen: open }),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false, focusWizard: false }),
  togglePanel: () => set({ panelOpen: !get().panelOpen }),
  focusWizard: false,
  setFocusWizard: (v) => set({ focusWizard: v }),
  diffFlowId: null,
  setDiffFlowId: (id) => set({ diffFlowId: id }),
  onboardingDismissed: readOnboardingDismissed(),
  dismissOnboarding: () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      /* ignore */
    }
    set({ onboardingDismissed: true });
  },
}));
