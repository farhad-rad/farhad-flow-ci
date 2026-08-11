# ADR-003: Auto-commit ≠ auto-push to production

## Status

Accepted

## Context

Users want Save to persist history without manual commit every time. Auto-pushing to the production branch would skip MR review and fire CI publish from unfinished work.

## Decision

- **Auto-commit:** allowed on Save (debounced) onto the **current non-production** branch.
- **Auto-push to production:** **forbidden**. Never auto-push when the target is the branch named in `.langflow/production-branch`.
- Push to any remote branch is an explicit Git UI (or user) action; push while `HEAD` equals the production branch name is a **hard error**.

## Consequences

- Local history stays dense; sharing and publish stay behind push + MR + merge.
- Message template for auto-commit remains product-owned (e.g. `flow: update <name> (<id>)`).
- Operators rely on protected branches / MR rules on GitLab for the final gate.
- Frontend autosave (`use-autosave-flow` → PATCH `/api/v1/flows/{id}`) becomes the natural trigger point for backend auto-commit once FlowGitStore exists (Phase 2–3).
