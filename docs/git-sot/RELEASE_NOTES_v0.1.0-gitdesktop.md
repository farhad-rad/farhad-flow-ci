# Release notes — v0.1.0-gitdesktop

**Tag (intended):** `v0.1.0-gitdesktop`  
**Upstream pin:** Langflow `v1.11.2` (`baseline/v1.11.2`)  
**Date:** 2026-08-08  

Ship path: **OSS UI + local backend** (browser). Tauri / native installer **not** in this release.

## Highlights

- **Git working tree SoT** for flows (`FlowGitStore`): disk-first save/load, `flows.lock`, startup rebuild from tree.
- **GitPython engine**: status, commit, branch, fetch/pull/push, production-branch guards, auto-commit on Save (no auto-push to prod).
- **Collab primitives**: per-flow leases, conflict store + UI (ours/theirs/manual).
- **Desktop Git UI**: sidebar panel, connect wizard, auth settings, conflicts page, shortcuts, onboarding.
- **Secrets**: fail-closed pre-commit scan stub; full strip/inject deferred until workshop choice.
- **Flows template**: separate GitLab-oriented template + sample CI contract.
- **Linux scripts/docs**: parity notes + `scripts/linux/start-langflow-git.sh`.
- **Delete trash**: `.langflow/trash/` snapshot on flow delete.

## Docs / hygiene

- User + admin: `docs/git-sot/USER_MANUAL.md`
- Chaos checklist: `docs/git-sot/CHAOS_TEST_PLAN.md`
- Upstream rebase: `docs/git-sot/UPSTREAM_REBASE.md`
- Status: `STATUS.md`, `docs/git-sot/STATUS.md`

## Not in v0.1.0

| Item | Notes |
|------|--------|
| Secrets strip/inject (S.3–S.6) | Blocked on storage decision |
| Tauri shell / installer | After git-SoT proven on Windows |
| Windows VM full QA | High-DPI, AV rename, installer smoke |
| Auto-update channel | Manual update OK for v1 |
| Code signing | TBD |
| Telemetry (12.6) | Deferred |
| Perf profile 500 flows | UI dirty list capped; profile later |
| Graph conflict preview | JSON tabs only |

## Upgrade / install (developers)

1. Checkout this fork at tag `v0.1.0-gitdesktop` (when tagged).
2. Follow OS boot doc (Windows or Linux).
3. Point `LANGFLOW_GIT_FLOWS_DIR` at a flows clone from the template.
4. Do **not** push customer flows with live secrets until Phase S completes.

## Verify (smoke, not full suite)

```bash
PYTHONPATH=src/backend/base python scripts/git-sot/verify_atomic_write.py
PYTHONPATH=src/backend/base python scripts/git-sot/verify_git_engine.py
```
