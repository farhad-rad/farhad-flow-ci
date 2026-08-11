# Upstream rebase hygiene (Wave 13)

Keep Desktop Git-SoT patches rebaseable onto newer **stable** Langflow tags (not `main` tip unless intentional).

## 13.1 Stacked commits

Prefer small, titled commits for Desktop work (e.g. `feat(flow_git): …`, `feat(git-ui): …`). Avoid mixing upstream merge noise with feature work.

Baseline tag on fork day: `baseline/v1.11.2`.

## 13.2 Rebase onto newer stable

```bash
# From LangflowDesktopCI
git fetch upstream --tags
# Pick newer stable, e.g. v1.12.0
NEW=v1.12.0

git checkout -b rebase/${NEW}
git rebase --onto "${NEW}" baseline/v1.11.2   # or onto previous baseline if already advanced

# Fix conflicts → continue
# When green:
git tag baseline/${NEW}
# Update FORK.md + STATUS.md pin
```

Alternate if Desktop work lives on a named branch:

```bash
git rebase "${NEW}"
```

**Do not** `migrate:fresh` or run full upstream test suites from agent sessions unless explicitly asked.

After rebase, re-run:

```bash
PYTHONPATH=src/backend/base python scripts/git-sot/verify_atomic_write.py
PYTHONPATH=src/backend/base python scripts/git-sot/verify_git_engine.py
```

## 13.3 Known patched areas (conflict forecast)

Generate a live list:

```bash
./scripts/git-sot/list_patched_files.sh
# optional: BASE=baseline/v1.11.2 ./scripts/git-sot/list_patched_files.sh
```

### Expected hotspots

| Area | Paths (typical) |
|------|-----------------|
| FlowGitStore | `src/backend/base/langflow/services/flow_git/**` |
| Git API | `src/backend/base/langflow/api/v1/git.py` |
| Flows hooks | `src/backend/base/langflow/api/v1/flows.py`, `flows_helpers.py`, `api/utils/flow_utils.py` |
| Startup / preload | `src/backend/base/langflow/main.py`, `preload.py` |
| Settings | `src/lfx/src/lfx/services/settings/groups/git.py` (+ settings wiring) |
| Git UI features | `src/frontend/src/features/git/**` |
| Git panel / settings pages | `src/frontend/src/components/core/gitPanel/**`, `pages/SettingsPage/pages/GitAuthPage/**`, `…/git-conflicts` routes |
| Sidebar / flow page triggers | `folderSidebarComponent/**`, `FlowPage/index.tsx`, `AppAuthenticatedPage/index.tsx` |
| Docs / scripts | `docs/git-sot/**`, `docs/DESKTOP_DEV_*.md`, `scripts/git-sot/**`, `scripts/linux/**`, `scripts/windows/**` |

Upstream files that already own save/load (`flows_helpers`, Flow model, FE autosave) are **highest conflict risk** on rebase.

## 13.4 Optional upstream RFC

Not required for Desktop ship. If proposing SoT patterns upstream, open a discussion after internal bake — do not block this fork on it.
