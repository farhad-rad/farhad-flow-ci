# Chaos / hardening test plan (Wave 12.1–12.4)

Manual checklist for Langflow Desktop Git-SoT. Do **not** treat as automated CI.

Env: `LANGFLOW_GIT_ENABLED=true`, real flows clone, non-prod branch.

## 12.1 Kill mid-write → no half JSON

| Step | Action | Pass |
|------|--------|------|
| 1 | Open flow; edit nodes so Save will write | |
| 2 | Trigger Save (or wait autosave) | |
| 3 | Immediately `kill -9` Langflow process (or Task Manager End) during write window | |
| 4 | Inspect `flows/<id>.json` | Valid JSON **or** previous good file; **no** truncated mid-object |
| 5 | Check for leftover `flows/.<id>.json.staging` | Staging gone or unused; not used as SoT |
| 6 | Restart Desktop; open flow / reconcile if drift | UI usable; no corrupt load crash |

**Expect:** atomic `.staging` + rename — kill should leave either old or new full file.

## 12.2 Pull during Save

| Step | Action | Pass |
|------|--------|------|
| 1 | Two clones or one clone + remote tip ahead | |
| 2 | Local: edit + Save (disk write + auto-commit debounce) | |
| 3 | During debounce / write: Pull from Git UI | |
| 4 | Observe status | No silent overwrite of in-flight bytes; error toast or completed write then pull |
| 5 | If conflict | Appears in Conflicts UI; push blocked until resolve |

**Expect:** pull does not leave half JSON; conflict path preferred over merge of JSON graphs.

## 12.3 Push while lease held

| Step | Action | Pass |
|------|--------|------|
| 1 | User A acquires lease on flow F (open-edit) | |
| 2 | User B (other machine/clone): pull; open F | Read-only / lease banner |
| 3 | User B tries Push of other commits | Push of **unrelated** commits still allowed if no conflict; lease is edit-coord not push lock |
| 4 | User A still holds lease; User B force-edits if possible | Prefer block; if overwrite, conflict on next pull |

**Expect:** lease ≠ global push mutex. Document observed behavior in STATUS if product rule changes.

## 12.4 Fuzz path names / unicode titles

| Case | Action | Pass |
|------|--------|------|
| Unicode title | Name flow `مشتری αβγ テスト` · Save | File still `flows/<uuid>.json`; title inside JSON OK |
| Spaces in repo path | Clone under `/tmp/my flows repo/` · connect | Status/commit/push work |
| Traversal attempt | Craft path `../../etc/passwd` via API if possible | Jail reject; no write outside root |
| Very long name | 200+ char display name | Save OK; path stays UUID |

## Related (doc only here)

| ID | Item | Status |
|----|------|--------|
| 12.5 | `.langflow/trash/` on delete | See USER_MANUAL / FlowGitStore |
| 12.6 | Telemetry opt-in | **Deferred** |
| 12.7 | Security review PAT + path jail | Manual / follow-up |
| 12.8 | Perf 500 flows | **Deferred** (dirty list capped 120 in UI) |
| 12.9–12.10 | Manuals + release notes | This wave |

## Sign-off

| OS | Tester | Date | 12.1 | 12.2 | 12.3 | 12.4 |
|----|--------|------|------|------|------|------|
| Linux | | | | | | |
| Windows VM | | | | | | |
