# Phase S workshop — secrets in flow JSON (S.1–S.2)

Status: **workshop done**. Strip/inject (S.3–S.5) **blocked** until storage option chosen below.

Pin: LangflowDesktopCI `v1.11.2`. Related fail-closed guard: [FAIL_CLOSED_STUB.md](./FAIL_CLOSED_STUB.md).

---

## S.1 Likely secret fields in committed flow JSON

Flows-repo SoT files are `flows/<uuid>.json`. Secrets usually live under node templates, not top-level metadata.

### Path shape (canonical)

```text
data.nodes[].data.node.template.<field_name>
```

Each template field is typically a dict with at least:

| Key | Role for secrets |
|-----|------------------|
| `name` | Field id (`api_key`, `password`, `token`, …) |
| `password` | `true` → UI treats as secret; export/strip helpers key off this |
| `value` | **Plaintext or bound value that must not hit git** |
| `load_from_db` | `true` → resolve from Langflow global variables at run |

Nested / group nodes repeat the same shape under `node.data.node.flow.data.nodes[...]`.

### Field categories that commonly hold secrets

| Category | Examples (field `name` / UI) | Detection notes |
|----------|------------------------------|-----------------|
| Provider API keys | `api_key`, `openai_api_key`, Anthropic/Google/etc. keys | Often `password: true` + name contains `api`/`key` |
| Tokens | `token`, `access_token`, `bearer_token`, Slack/Discord bot tokens | Name parts `token` / compound secret names |
| Passwords | `password`, DB / Redis / SMTP password | `password: true` |
| Client secrets | `client_secret`, OAuth client secret | Compound secret name |
| Connection strings | `connection_string`, `database_url`, `dsn` | May embed userinfo in URL |
| Private keys / PEM | `private_key`, SSH / TLS PEM blobs | Prefix `-----BEGIN … PRIVATE KEY-----` |
| Auth headers | Structured `headers` / key-value rows named `Authorization` | Value often `Bearer …` |
| Cloud access keys | AWS `AKIA…` access key id (+ secret key sibling field) | Pattern scan catches id even if field rename |

Upstream helpers already scrub some of this for **export / public read** (not Git-SoT yet):

- `remove_api_keys` — nulls `password` fields whose name looks like API key/token (`api/utils/core.py`)
- `strip_secret_field_values` — nulls **every** `password` (and secret-named) template value for public flows
- Setting `LANGFLOW_REMOVE_API_KEYS` — strip-on-DB-save when enabled (narrower than full Phase S)

### Non-flow locations (out of SoT JSON, still relevant)

| Location | Risk |
|----------|------|
| Langflow global variables DB | Secrets referenced via `load_from_db`; not in `flows/*.json` if bindings preserved |
| Desktop GitLab PAT (keyring / `LANGFLOW_GIT_PAT`) | Must never be written into flow files |
| CI `PROD_API_KEY` | GitLab masked var for publish only — not Desktop |

---

## S.2 Storage options (pick one — decision matrix)

No recommendation locked. Impl (S.3–S.6) waits on this choice.

| Option | How it works | Pros | Cons | Fits Desktop + GitLab CI? |
|--------|--------------|------|------|---------------------------|
| **A. External vault** (HashiCorp Vault / cloud SM / org secret store) | Flow JSON holds placeholder / ref id; Desktop + CI fetch at run/publish | Strong ACL / rotate / audit | Needs vault ops, network, mapping UI | Best long-term; heavier v1 |
| **B. `.secrets.local`** (gitignored map on Desktop) | e.g. `.langflow/secrets.local.json` or repo-root `.secrets.local` → placeholder → value; inject-on-run locally | Simple offline; no vault | Per-machine copy; sync discipline; easy to forget file | Good Desktop v1; CI needs **separate** inject path |
| **C. GitLab masked / protected CI vars** | Placeholders in committed JSON; CI injects for prod publish/run | Aligns with existing `PROD_API_*` pattern; no secrets in git history | **Does not** supply Desktop local run alone; var sprawl per key | Required for **prod** regardless; incomplete as sole Desktop answer |

### Hybrid sketches (for later ADR, not chosen here)

| Hybrid | Sketch |
|--------|--------|
| B + C | Desktop: `.secrets.local` · Prod: GitLab masked vars · same placeholder names |
| A + C | Desktop/CI pull from vault; GitLab vars only for non-vault break-glass |
| C only (interim) | Prod-safe git; local run uses Langflow global vars / env until B or A |

### Decision checklist (fill when choosing)

| Gate | Note |
|------|------|
| Placeholder syntax | e.g. `${SECRET:OPENAI_API_KEY}` vs empty + `load_from_db` only |
| Hash / `flows.lock` | Strip **before** canonical hash so lock never fingerprints raw keys |
| Auto-commit | Must run after scrub (or fail-closed scan blocks) |
| Rotate | Who updates Desktop vs CI when key rotates |
| Multi-user | Shared placeholders; private values stay off git |

---

## Out of scope this workshop

- S.3 strip-on-write  
- S.4 inject-on-run (Desktop)  
- S.5 CI inject for prod  
- S.6 full pre-commit + Desktop guard productization  
- S.7 red-team suite  

Until S.3–S.6: **no real customer flows with live keys to GitLab**. Fail-closed pattern scan: [FAIL_CLOSED_STUB.md](./FAIL_CLOSED_STUB.md).
