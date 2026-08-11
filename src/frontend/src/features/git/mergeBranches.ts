export type RawGitBranch = {
  name: string;
  current?: boolean;
  is_current?: boolean;
  is_production?: boolean;
  remote?: boolean;
  is_remote?: boolean;
  commit?: string;
  ahead?: number | null;
  behind?: number | null;
  has_upstream?: boolean;
};

export type MergedGitBranch = {
  name: string;
  current: boolean;
  is_production: boolean;
  has_local: boolean;
  has_remote: boolean;
  local_only: boolean;
  commit?: string;
  ahead: number | null;
  behind: number | null;
};

export function shortBranchName(raw: string): string {
  if (raw.startsWith("origin/")) return raw.slice("origin/".length);
  return raw;
}

/** Collapse ``main`` + ``origin/main`` into one row named ``main``. */
export function mergeGitBranches(
  rows: RawGitBranch[],
  currentBranch: string | null | undefined,
  prodName: string | null | undefined,
): MergedGitBranch[] {
  const map = new Map<string, MergedGitBranch>();
  for (const row of rows) {
    const remote = Boolean(row.remote ?? row.is_remote);
    const name = shortBranchName(row.name);
    if (!name) continue;
    const existing = map.get(name) || {
      name,
      current: false,
      is_production: false,
      has_local: false,
      has_remote: false,
      local_only: false,
      commit: undefined,
      ahead: null,
      behind: null,
    };
    if (remote) {
      existing.has_remote = true;
    } else {
      existing.has_local = true;
      if (typeof row.ahead === "number") existing.ahead = row.ahead;
      if (typeof row.behind === "number") existing.behind = row.behind;
    }
    if (row.commit) existing.commit = row.commit;
    if (Boolean(row.current || row.is_current) || currentBranch === name) {
      existing.current = true;
    }
    if (
      Boolean(row.is_production) ||
      (prodName && (name === prodName || row.name === `origin/${prodName}`))
    ) {
      existing.is_production = true;
    }
    map.set(name, existing);
  }
  for (const b of map.values()) {
    b.local_only = b.has_local && !b.has_remote;
    if (b.local_only || !b.has_local) {
      b.ahead = null;
      b.behind = null;
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.is_production !== b.is_production) return a.is_production ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
