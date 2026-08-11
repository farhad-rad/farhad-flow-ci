import { useCallback, useEffect, useState } from "react";
import type { FlowType } from "@/types/flow";
import { api } from "@/controllers/API/api";
import { getURL } from "@/controllers/API/helpers/constants";
import type {
  GitDriftInfo,
  GitReconcileAction,
} from "@/modals/gitFlowReconcileModal";

type GetFlow = (payload: { id: string }) => Promise<FlowType>;

type UseLoadFlowForRouteProps = {
  id?: string;
  flows?: FlowType[];
  currentFlowId: string;
  types: Record<string, string>;
  getFlow: GetFlow;
  applyFlowToCanvas: (flow: FlowType) => void;
  navigate: (path: string) => void;
};

function parseGitDrift(error: unknown, flowId: string): GitDriftInfo | null {
  const detail = (error as { response?: { data?: { detail?: unknown } } })
    ?.response?.data?.detail;
  if (!detail || typeof detail !== "object") {
    return null;
  }
  const d = detail as {
    code?: string;
    flow_id?: string;
    db_sha256?: string;
    disk_sha256?: string;
    has_disk_file?: boolean;
  };
  if (d.code !== "GIT_FLOW_DRIFT") {
    return null;
  }
  return {
    flowId: d.flow_id ?? flowId,
    dbSha256: d.db_sha256,
    diskSha256: d.disk_sha256,
    hasDiskFile: d.has_disk_file,
  };
}

export default function useLoadFlowForRoute({
  id,
  flows,
  currentFlowId,
  types,
  getFlow,
  applyFlowToCanvas,
  navigate,
}: UseLoadFlowForRouteProps): {
  gitDrift: GitDriftInfo | null;
  gitReconcileBusy: boolean;
  onGitReconcile: (action: GitReconcileAction) => Promise<void>;
  clearGitDrift: () => void;
} {
  const [gitDrift, setGitDrift] = useState<GitDriftInfo | null>(null);
  const [gitReconcileBusy, setGitReconcileBusy] = useState(false);

  const clearGitDrift = useCallback(() => setGitDrift(null), []);

  const loadFlowToCanvas = useCallback(
    async (flowId: string) => {
      try {
        const flow = await getFlow({ id: flowId });
        applyFlowToCanvas(flow);
        setGitDrift(null);
      } catch (error) {
        const drift = parseGitDrift(error, flowId);
        if (drift) {
          setGitDrift(drift);
          return;
        }
        throw error;
      }
    },
    [applyFlowToCanvas, getFlow],
  );

  const onGitReconcile = useCallback(
    async (action: GitReconcileAction) => {
      if (!gitDrift) {
        return;
      }
      if (action === "abort") {
        setGitDrift(null);
        navigate("/all");
        return;
      }
      setGitReconcileBusy(true);
      try {
        const { data } = await api.post<FlowType>(
          `${getURL("FLOWS")}/${gitDrift.flowId}/git-reconcile`,
          { action },
        );
        applyFlowToCanvas(data);
        setGitDrift(null);
      } catch (error) {
        console.error("Git reconcile failed", error);
        navigate("/all");
      } finally {
        setGitReconcileBusy(false);
      }
    },
    [applyFlowToCanvas, gitDrift, navigate],
  );

  useEffect(() => {
    if (!flows || currentFlowId !== "" || Object.keys(types).length === 0) {
      return;
    }

    if (!id) {
      navigate("/all");
      return;
    }

    let cancelled = false;
    const storedFlow = flows.find((flow) => flow.id === id);

    const run = async (flowId: string) => {
      try {
        await loadFlowToCanvas(flowId);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error(`Failed to confirm flow ${id} from the server:`, error);
        navigate("/all");
      }
    };

    if (storedFlow) {
      void run(storedFlow.id);
    } else {
      void run(id);
    }

    return () => {
      cancelled = true;
    };
  }, [id, flows, currentFlowId, types, loadFlowToCanvas, navigate]);

  return { gitDrift, gitReconcileBusy, onGitReconcile, clearGitDrift };
}
