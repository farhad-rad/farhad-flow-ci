# ADR-002: Hub-spoke — Desktop ≠ Prod

## Status

Accepted

## Context

Operators need a headless production Langflow. Giving Desktop a direct prod API key creates accidental overwrite, bypasses review, and couples client UX to prod outages.

## Decision

**Hub-spoke:**

- **Spoke:** Langflow Desktop — git client only (clone/commit/push/pull/branch/conflict/lease).
- **Hub:** GitLab flows-only repo — MRs and protected production branch.
- **Publish:** GitLab CI only, using `PROD_API_URL` / `PROD_API_KEY` (CI variables, not Desktop).

Desktop has **no** direct link to the production headless API.

## Consequences

- Sample `.gitlab-ci.yml` (flows template) documents the publish contract; real publish impl may replace the stub curl.
- Prod credentials never live in Desktop keyring for publish.
- Operational publish failures are CI/ops concerns, not Desktop Save failures.
