# Cohort hardening + salary what-if — progress log

Brief: `PROMPT_COHORT_hardening_and_whatif.md` (2026-11-24). Starting facts: `docs/COHORT_PAGE_AUDIT.md`.
Decisions: `docs/COHORT_DECISIONS.md`. Final report: `docs/COHORT_HARDENING_REPORT.md`.

## Where the work lives (nothing pushed)

| Repo | Worktree (outside the working copies) | Branch | Base |
|---|---|---|---|
| daf360-payroll-service | `projects/daf360-payroll-service-cohort-wt` | `feature/cohort-hardening` | origin/main 6a40a64 |
| daf360-payroll-frontend | `projects/daf360-payroll-frontend-cohort-wt` | `feature/cohort-reactivate` | origin/main 790a11a |

The working copies `daf360-payroll-service` (feature/cost-rates-f04) and `daf360-payroll-frontend`
(feature/audit-actor-names) are not touched.

## Status

| Item | State | Commit(s) |
|---|---|---|
| Baseline backend tests | 185 run, 0 failures | — |
| A1 country scoping | DONE (backend) | 51e3618 |
| A3/A4 503 + 400 + unknown fields | DONE (backend) | 5626bd9 |
| A6 FX resolution | DONE (backend) | 65a0dd6 |
| A2/A3/A5 + B1/B2 service | DONE (backend), 231 tests green | ce81c4b |
| Live localhost verification (backend on :8894) | in progress | — |
| A7 + B3 UI | in progress | — |
| Report + decisions | pending | — |

## How to resume

- Backend on localhost without touching the container: `scratchpad/run_be.sh` pattern — env copied
  from `daf360-payroll-backend-dev` (`docker inspect`, never printed), DB host → localhost,
  HR → `http://localhost:8888`, `SERVER_PORT=8894`, JWT public key copied from the container.
- Frontend: `npx ng serve --port 4215` in the frontend worktree; Playwright redirects `:8893` → `:8894`.
- Tokens: `scratchpad/mint_jwt2.py <portal private.pem> <sub> <perms> <all|ids>`.
