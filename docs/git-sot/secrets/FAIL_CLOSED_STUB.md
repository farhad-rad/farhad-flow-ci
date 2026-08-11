# Fail-closed secret pattern stub (until Phase S impl)

Until strip/inject (S.3–S.6) ships, Desktop **blocks commit** if staged flow content matches known raw-key patterns. No silent scrub in this stub — **fail closed**.

Workshop / option pick: [WORKSHOP.md](./WORKSHOP.md).

---

## Behavior

1. Before `GitRepoService.commit` creates a commit object, scan file bytes that would be committed.
2. If any pattern matches → raise `SecretPatternBlockedError` (`GIT_SECRET_PATTERN`) → commit aborted (manual + auto-commit).
3. No rewrite of JSON. No placeholder injection. User/CI must remove the literal before retry.

### Patterns (stub set)

| Family | Example regex (conceptual) |
|--------|----------------------------|
| OpenAI-style | `\bsk-[A-Za-z0-9]{20,}\b` |
| GitHub PAT | `\bghp_[A-Za-z0-9]{36}\b` |
| GitLab PAT | `\bglpat-[A-Za-z0-9_\-]{20,}\b` |
| AWS access key id | `\bAKIA[0-9A-Z]{16}\b` |
| Slack | `\bxox[baprs]-[A-Za-z0-9\-]{10,}\b` |
| PEM private key | `-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----` |

False positives possible (docs/demo strings). Stub favors block over leak. Allowlist / entropy detectors = later (S.6+).

---

## Phase 3 commit path — hook here

**Yes — Phase 3 commit path must enforce this stub.**

| Call site | Why |
|-----------|-----|
| `GitRepoService.commit` | Single choke point for manual `POST /git/commit` **and** debounced auto-commit (`auto_commit.py` → `svc.commit`) |
| Not in `FlowGitStore.write_*` alone | Disk write without commit still local; **git history** is the leak surface for the stub era |

Proposed order inside `commit()`:

1. Path / immutable guards (existing)  
2. **Secret pattern scan** (this stub)  
3. `index.add` / whitespace skip / `index.commit`  
4. Ops log  

Optional later: repo-side `pre-commit` sample in LangflowFlowsRepoTemplate (defense in depth). Desktop guard remains authoritative for Desktop users who bypass git hooks.

### Tiny stub impl (landed with this doc)

| Piece | Path |
|-------|------|
| Scanner | `src/backend/base/langflow/services/flow_git/secret_scan.py` |
| Error | `SecretPatternBlockedError` in `exceptions.py` |
| Wire-up | `GitRepoService.commit` calls `assert_no_raw_secret_patterns` before staging |

Scope of stub: scan `flows/*.json` paths in the commit set (or all `flows/*.json` when committing with `paths=None`). Non-JSON / outside `flows/` not expanded in stub.

---

## Not this stub

- Strip-on-write / inject-on-run  
- Placeholder rewrite  
- Scanning GitLab push from remote only (local commit already blocked)  
- Red-team suite (S.7)  

When full Phase S lands, keep this scan as last line of defense **after** scrub, or fold into S.6 productization.
