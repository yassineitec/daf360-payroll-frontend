# Cohort work: pre-merge regression report

Brief: `PROMPT_COHORT_premerge_and_draft_prs.md` (2026-11-25). Earlier docs: `COHORT_HARDENING_REPORT.md`, `COHORT_DECISIONS.md`, `COHORT_PROGRESS.md`.

**Verdict: nothing legitimate is blocked.** The same 848 calls ran against the branch and against a build of `origin/main`. Every difference falls into one of these groups:

- a country outside the caller's scope now gets 403 (the A1 fix);
- validation errors are now 400 where `origin/main` returned 500;
- the new what-if endpoint exists;
- the documented "aggregate-only role" restrictions apply.

No scoped, multi-country, super-admin, HR or service-to-service call that worked before is refused. No fix was needed inside the scoping code.

Privacy: this report contains HTTP statuses, counts, codes and response fingerprints only. It contains no salary, no name and no employee id.

## Where the work lives

| Repo | Branch | Commits since the hardening report | Tests |
|---|---|---|---|
| daf360-payroll-service | `feature/cohort-hardening` (6 commits on origin/main 6a40a64) | `20d4701` step 2 (benefitsNoneSelected, coverage) | 243 run, 0 failures (231 before step 2) |
| daf360-payroll-frontend | `feature/cohort-reactivate` (7 commits on origin/main 790a11a) | `0b77169` step 2 UI, plus this report | `ng build`: 0 errors |

## 1. Regression pass

### 1a. Inventory

**The country in the body.** `PaysScopeBodyAdvice` checks every JSON body that exposes a `paysId`. The request bodies that carry one:

| Endpoint | Body type | Permission |
|---|---|---|
| `POST /simulations/individual` (HR candidate simulation, payroll simulator) | `SimulationRequest` | RUN_SIMULATION |
| `POST /simulations/cohort` | `CohortSimulationRequest` | RUN_SIMULATION + VIEW_INDIVIDUAL |
| `POST /simulations/cohort/aggregate` | `CohortFilterRequest` | RUN_SIMULATION / VIEW_AGGREGATE / VIEW_INDIVIDUAL |
| `POST /simulations/cohort/what-if/employee` (new) | `EmployeeWhatIfRequest` | VIEW_INDIVIDUAL |
| `POST /engine/run` | `RunPayrollRequest` | RUN_ENGINE |
| `POST /parameter-sets` | `CreateParameterSetRequest` | APPROVE_PARAMSET |
| `PUT /employee-configs/{id}` (Rémunération tab, employee config page) | `UpsertEmployeePayrollConfigRequest` | MANAGE_EMPLOYEE_CONFIG |
| `POST /employee-configs/{id}/simulate` | `RemunerationSimulationRequest` | MANAGE_EMPLOYEE_CONFIG |
| `POST /employee-configs/{id}/calculate-net` | `CalculateNetRequest` | MANAGE_EMPLOYEE_CONFIG |
| `POST /salary-changes/employee/{id}` | `SubmitSalaryChangeRequest` | MANAGE_EMPLOYEE_CONFIG |
| `PUT /salary-advances/policies/{paysId}` | `PolicyDto` (`paysId` optional in the body) | salary-advance admin |
| `POST /admin/countries`, `PUT /admin/countries/{id}` | `SavePayrollCountryRequest` | MANAGE_COUNTRIES / SUPER_ADMIN |

The other bodies carry no `paysId`, so the advice ignores them:

- the salary-advance installment actions and decisions;
- `calculate-gross`;
- the engine rubrique and param-set admin;
- the help FAQ;
- the exports;
- the list bodies of a parameter set.

**The country in the query.** `PaysIsolationInterceptor` checks these, and it is unchanged:

- `parameter-sets`, `parameter-sets/active`;
- `simulations/individual` (list) and `individual/history`;
- `engine/results/summary`, `engine/results/employees`, `engine/rubriques`, `engine/param-sets`, `engine/calibration`, `engine/calibration/kpi`, `engine/calibration/open`;
- `calibration`, `calibration/open`, `calibration/budget-lines`, `calibration/forecast-outputs`;
- `admin/audit`, `admin/engine/rubriques`, `admin/engine/param-sets` (POST).

**The country in the path, or on a stored row.**

- `GET /simulations/cohort/{id}`: checks the cohort's country (branch).
- `GET /simulations/{id}` and its PDF and Excel exports: a COHORT row also needs VIEW_INDIVIDUAL (branch).
- `GET /parameter-sets/{id}`: checks the set's country (unchanged).
- `GET /ref/users/by-pays/{paysId}` and `PUT /salary-advances/policies/{paysId}`: **the path is not scope-checked on either build** (question Q1/Q2).

**Service-to-service calls.**

- `GET /api/payroll/internal/headcount` and `/internal/loaded-costs`: facturation calls them with `X-Internal-Key`. Both the interceptor and the advice exclude them.
- `POST /api/payroll/ref/sync`: rh-service `ModuleSyncService` calls it with the HR user's token and no body.
- Payroll's own outbound calls do not go through these guards:
  - the RH `payroll-sync` and internal endpoints;
  - facturation `entities-for-sync` and `fx-rates`.
- No other caller of payroll-service was found in rh-service, facturation-service or the rh-frontend.

### 1b. Test matrix (live, localhost)

**Setup.**

- Branch backend on :8894.
- `origin/main` (6a40a64) built from a detached temporary worktree on :8896.
- Same environment and database for both.

**Tokens.** All are minted locally with subs 990001–990008, a range that has no `users_ref` row.

| Name | Permissions | Scope |
|---|---|---|
| `tn` | every PAYROLL_* code except SUPER_ADMIN | [TN 179] |
| `eg` | same | [EG 53] |
| `multi` | same | [TN, EG] |
| `super` | everything, including SUPER_ADMIN | [TN] (proves the bypass) |
| `agg` | VIEW_AGGREGATE + RUN_SIMULATION + VIEW_PARAMSET | [TN] |
| `hr` | the real local HRD role's codes **minus** PAYROLL_SUPER_ADMIN | [TN] |
| `hrd` | the real local HRD role, which **holds PAYROLL_SUPER_ADMIN** locally | [TN] |

**Requested countries.** TN, EG, OUT (pays 62, outside every scope) and `null` (body `paysId` null, or query parameter absent).

**No writes on either build.** Write endpoints were called with a body that fails validation *after* the body is read, so the country check runs first, or against a row that does not exist (`/admin/countries/999999`). Only the read-like endpoints ran in full:

- the simulations, which store a history row, cleaned up;
- simulate, calculate-net, aggregate and what-if.

**How to read a cell.** Each cell shows the branch status for TN/EG/OUT/null. Formatting marks the difference from `origin/main`:

- plain: same status and same response fingerprint;
- **bold**: same status, different body;
- **bold**<sub>(n)</sub>: different status, with `origin/main`'s status in brackets.

The table is from the final run, after step 2. The first run, before step 2, gave the same statuses everywhere.

| Endpoint | tn | eg | multi | super | agg | hr | hrd |
|---|---|---|---|---|---|---|---|
| `POST /simulations/individual` | 201/**403**<sub>(201)</sub>/**403**<sub>(404)</sub>/**400**<sub>(500)</sub> | **403**<sub>(201)</sub>/201/**403**<sub>(404)</sub>/**400**<sub>(500)</sub> | 201/201/**403**<sub>(404)</sub>/**400**<sub>(500)</sub> | 201/201/404/**400**<sub>(500)</sub> | 201/**403**<sub>(201)</sub>/**403**<sub>(404)</sub>/**400**<sub>(500)</sub> | 201/**403**<sub>(201)</sub>/**403**<sub>(404)</sub>/**400**<sub>(500)</sub> | 201/201/404/**400**<sub>(500)</sub> |
| `POST /simulations/cohort (no fiscalYear)` | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **403**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> |
| `POST /simulations/cohort/aggregate` | **200**/**403**<sub>(200)</sub>/**403**<sub>(404)</sub>/**400**<sub>(500)</sub> | **403**<sub>(200)</sub>/**200**/**403**<sub>(404)</sub>/**400**<sub>(500)</sub> | **200**/**200**/**403**<sub>(404)</sub>/**400**<sub>(500)</sub> | **200**/**200**/404/**400**<sub>(500)</sub> | **200**/**403**<sub>(200)</sub>/**403**<sub>(404)</sub>/**400**<sub>(500)</sub> | **200**/**403**<sub>(200)</sub>/**403**<sub>(404)</sub>/**400**<sub>(500)</sub> | **200**/**200**/404/**400**<sub>(500)</sub> |
| `POST /simulations/cohort/what-if/employee` | **200**<sub>(404)</sub>/**403**<sub>(404)</sub>/**403**<sub>(404)</sub>/**400**<sub>(404)</sub> | **403**<sub>(404)</sub>/**200**<sub>(404)</sub>/**403**<sub>(404)</sub>/**400**<sub>(404)</sub> | **200**<sub>(404)</sub>/**200**<sub>(404)</sub>/**403**<sub>(404)</sub>/**400**<sub>(404)</sub> | **200**<sub>(404)</sub>/**200**<sub>(404)</sub>/404/**400**<sub>(404)</sub> | **403**<sub>(404)</sub>/**403**<sub>(404)</sub>/**403**<sub>(404)</sub>/**400**<sub>(404)</sub> | **200**<sub>(404)</sub>/**403**<sub>(404)</sub>/**403**<sub>(404)</sub>/**400**<sub>(404)</sub> | **200**<sub>(404)</sub>/**200**<sub>(404)</sub>/404/**400**<sub>(404)</sub> |
| `POST /engine/run (no employeeId)` | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **403**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> |
| `POST /parameter-sets (no irppBrackets)` | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **403**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> |
| `PUT /employee-configs/{id} (no reason)` | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **403**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> |
| `POST /employee-configs/{id}/simulate` | 200/**403**<sub>(200)</sub>/**403**<sub>(404)</sub>/200 | **403**<sub>(200)</sub>/200/**403**<sub>(404)</sub>/200 | 200/200/**403**<sub>(404)</sub>/200 | 200/200/404/200 | 403/403/403/403 | 403/403/403/403 | 403/403/403/403 |
| `POST /employee-configs/{id}/calculate-net` | 200/**403**<sub>(200)</sub>/**403**<sub>(409)</sub>/200 | **403**<sub>(200)</sub>/200/**403**<sub>(409)</sub>/200 | 200/200/**403**<sub>(409)</sub>/200 | 200/200/409/200 | 403/403/403/403 | 403/403/403/403 | 403/403/403/403 |
| `POST /salary-changes/employee/{id} (no reason)` | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **403**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> |
| `PUT /salary-advances/policies/{pays} (no currency)` | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **403**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**403**<sub>(500)</sub>/**403**<sub>(500)</sub>/**400**<sub>(500)</sub> | **400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub>/**400**<sub>(500)</sub> |
| `PUT /admin/countries/999999 (no such row)` | 404/**403**<sub>(404)</sub>/**403**<sub>(404)</sub>/404 | **403**<sub>(404)</sub>/404/**403**<sub>(404)</sub>/404 | 404/404/**403**<sub>(404)</sub>/404 | 404/404/404/404 | 403/403/403/403 | 404/**403**<sub>(404)</sub>/**403**<sub>(404)</sub>/404 | 404/404/404/404 |
| `GET /parameter-sets?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | 200/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /parameter-sets/active?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/404/500 | 200/403/403/500 | 200/403/403/500 | 200/200/404/500 |
| `GET /simulations/individual?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | 200/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /simulations/individual/history?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | **200**/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /engine/results/summary?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | 403/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /engine/results/employees?paysId` | 200/403/403/200 | 403/200/403/200 | 200/200/403/200 | 200/200/200/200 | 403/403/403/403 | 200/403/403/200 | 200/200/200/200 |
| `GET /engine/rubriques?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | 200/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /engine/param-sets?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | 200/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /engine/calibration?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/409/500 | 200/403/403/500 | 200/403/403/500 | 200/200/409/500 |
| `GET /engine/calibration/kpi?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | 200/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /calibration?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | 200/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /calibration/budget-lines?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | 200/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /calibration/forecast-outputs?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | 200/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /admin/audit?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | 403/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /admin/engine/rubriques?paysId` | 200/403/403/500 | 403/200/403/500 | 200/200/403/500 | 200/200/200/500 | 200/403/403/500 | 200/403/403/500 | 200/200/200/500 |
| `GET /ref/users/by-pays/{pays} (path)` | 200/200/200/– | 200/200/200/– | 200/200/200/– | 200/200/200/– | 200/200/200/– | 200/200/200/– | 200/200/200/– |
| `GET /simulations/cohort/{id} (path)` | 200/**403**<sub>(200)</sub>/**404**<sub>(200)</sub>/– | **403**<sub>(200)</sub>/200/**404**<sub>(200)</sub>/– | 200/200/**404**<sub>(200)</sub>/– | 200/200/**404**<sub>(200)</sub>/– | **403**<sub>(200)</sub>/**403**<sub>(200)</sub>/**403**<sub>(200)</sub>/– | 200/**403**<sub>(200)</sub>/**404**<sub>(200)</sub>/– | 200/200/**404**<sub>(200)</sub>/– |
| `GET /simulations/{id} COHORT row (path)` | 200/403/404/– | 403/200/404/– | 200/200/404/– | 200/200/404/– | **403**<sub>(200)</sub>/403/404/– | 200/403/404/– | 200/200/404/– |
| `GET /simulations/{id} INDIVIDUAL row (path)` | 200/403/404/– | 403/200/404/– | 200/200/404/– | 200/200/404/– | 200/403/404/– | 200/403/404/– | 200/200/404/– |

| Internal call | Caller | Branch | origin/main |
|---|---|---|---|
| `GET /internal/headcount` | key | 200 | 200 |
| `GET /internal/headcount` | no key | 403 | 403 |
| `GET /internal/headcount` | wrong key | 403 | 403 |
| `GET /internal/headcount` | key + EG user token | 200 | 200 |
| `GET /internal/loaded-costs` | key | 200 | 200 |
| `GET /internal/loaded-costs` | no key | 403 | 403 |
| `GET /internal/loaded-costs` | wrong key | 403 | 403 |
| `GET /internal/loaded-costs` | key + EG user token | 200 | 200 |

**Every difference from `origin/main`, classified (none is a legitimate case refused):**

| Difference | Where | Why it is intended |
|---|---|---|
| 201/200/409/404 → **403** | body endpoints when the country is outside the caller's scope (`tn`→EG/OUT, `eg`→TN/OUT, `multi`→OUT, `agg`/`hr`→EG/OUT) | A1. On `origin/main` a Tunisia-only user could run an Egypt simulation (201) or Egypt calculate-net (200). |
| 500 → **400** | every body endpoint with an invalid or missing field, and a `null` paysId on `@NotNull` fields | A4. `origin/main` has no handler for validation errors and answers 500. The branch answers 400 with the message. |
| 404 → 200/400/403 | `POST /cohort/what-if/employee` | New endpoint (B2). |
| 200 → **403** for `agg` | `GET /cohort/{id}`, `GET /simulations/{id}` on a COHORT row | Per-employee rows need VIEW_INDIVIDUAL (DEC1, documented). |
| 200 (fewer rows) for `agg` | `GET /simulations/individual/history` | COHORT rows hidden from non-individual roles (documented). |
| 200 `[]` → **404** | `GET /cohort/{id}` for a cohort that does not exist | Honest failure: the branch looks the cohort up first (404) and then checks its country. |
| 200 → **403** | `GET /cohort/{id}` for another country's cohort | A1 on a stored row. |
| 200, different body | `/cohort/aggregate` | New additive fields, synced FX rate, DEC5/6/8 (see the hardening report). |

**What stays exactly the same** (status *and* response fingerprint): every query-parameter endpoint for every caller, every in-scope call from the multi-country user in **both** of their countries, the super-admin everywhere including OUT, the `hrd` token everywhere, the internal calls.

### 1c. Cross-service paths

The HR candidate simulation was sent with the exact body shape of rh-frontend `PayrollSimulationService.simulateFromNet` (`selectedBenefitCodes: []` plus the request), and the same request went to both builds:

| Call | `hr` (HR role, scope TN, no super-admin) | `hrd` (real local HRD role) |
|---|---|---|
| candidate TN, net 1500 CDI | 201 = 201, **body identical** | 201 = 201, identical |
| candidate TN, net 3200, married + 2 children | 201 = 201, identical | 201 = 201, identical |
| candidate TN, gross 2500, BRUT_TO_NET | 201 = 201, identical | 201 = 201, identical |
| candidate TN, net 900, CIVP | 201 = 201, identical | 201 = 201, identical |
| candidate TN, net 500 entered in EUR | 201 = 201, identical | 201 = 201, identical |
| candidate **EG** (outside the HR user's scope) | main 201 → branch **403** | 201 = 201 (super-admin) |

"Identical" means the JSON was compared field by field, without `id` and `simulatedAt`.

The **Rémunération tab** calls, sent with an employee-config manager scoped to TN (`tn` token) on a Tunisian employee:

- GET config, history, salary changes, bonuses, active rules, FX rates, pays;
- calculate-net, simulate, calculate-gross.

Every call was 200 on both builds, with a **body identical**. With the local HRD role, the config, calculate and simulate calls are 403 on **both** builds, because that role has no employee-config permission locally. That is not a regression.

The other callers:

- **RH `ModuleSyncService` → `POST /ref/sync`** (UPDATE_USER token, no body): 204 on both builds.
- **Facturation → internal endpoints**:

  | Call | Status on both builds |
  |---|---|
  | with the key | 200 |
  | without the key | 403 |
  | wrong key | 403 |
  | key plus an unrelated Egypt user token | 200 (the advice skips `/internal/`) |

- **FX sync and RH payroll-sync** are outbound calls *from* payroll-service, so the change does not affect them.

### 1d. Pages (Playwright, worktree frontend :4215 → branch backend :8894)

Three sessions were run:

- a user scoped to TN;
- a multi-country user [TN, EG] whose home country is TN;
- the same multi-country user with EG as home country.

Each page was opened and every payroll API response it triggered was recorded.

| Page | API calls | 4xx/5xx (all 3 sessions) | Note |
|---|---|---|---|
| Accueil | 0 | 0 | |
| Simulator list | 5 | 0 | |
| Simulator new + **main action** (pick the country, net 1500, compute) | 3 + POST | 0 | `POST /simulations/individual` → **201** in all 3 sessions, including EG for the multi-country user |
| Candidate simulations | 1 | 0 | |
| Cohort | 1 | 0 | see step 2 for its actions |
| Calibration | 0 | 0 | **still a placeholder**: "Calibration mensuelle — Module en cours de développement." |
| Budget | 0 | 0 | **still a placeholder**: "Budget prévisionnel — Module en cours de développement." |
| Engine results (`/engine-run` redirects here) | 2 | 0 | the engine run itself was not triggered (it writes payroll results) |
| Employee config | 3–4 | 0 | |
| Payslip batch | 0 | 0 | talks to the RH service, not payroll |
| Salary advances | 4 | 0 | |
| Admin home | 4 | 0 | |
| Admin: countries | 6 | 0 | |
| Admin: parameter sets (create) | 4 | 0 | |
| Admin: engine params | 7 | 0 | |
| Admin: rubriques | 7 | 0 | |
| Admin: advance rules | 7 | 0 | |
| Admin: benefits | — | — | card commented out on `main` (`parameter-sets.component.ts`), so `?tab=benefits` falls back to the admin home; not related to this work |
| Admin: audit | 6 | 0 | |
| Help | 1 | 0 | |

No page error, no "accès refusé" text, and no 403 in any session.

### 1e. Fixes

None. No legitimate case was blocked, so the scoping code was not touched.

## 2. Fixes made

None in the scoping code; see 1e.

## 3. Step 2: the two warnings (additive, DEC15 holds)

**Backend** (`20d4701`):

- **`benefitsNoneSelected`** counts the simulated employees **with** a payroll configuration whose `selected_benefit_codes` is NULL or empty.
  - Message `BENEFITS_NONE_SELECTED`, level WARNING.
  - The flag is also on each `EmployeeWhatIfRow` and on the one-employee what-if.
  - The computation is unchanged: such employees are still computed without any benefit.
- **`coverage`** = `headcount ÷ matched`, at scale 4.
  - It is `null` when nothing matched.
  - It is returned even for a suppressed group, because it is a ratio of counts.
  - **`minCoverage`** echoes `app.cohort.min-coverage` (default 0.90, must be within 0..1).
  - Message `LOW_COVERAGE` (WARNING) when coverage is strictly below the threshold.
- **12 new unit tests**, all green: 243 in total, 0 failures. They cover:
  - NULL and empty lists counted, while employees without a config stay in `benefitsAssumed`;
  - the computation identical to the engine with no benefit;
  - 0 and no message on the default fixture;
  - the one-employee warning;
  - coverage 1 with no message;
  - 8/9 = 0.8889 giving LOW_COVERAGE with the totals still present;
  - the threshold inclusive;
  - nothing matched giving `null`;
  - nothing converged giving 0 plus LOW_COVERAGE plus ALL_NON_CONVERGED;
  - a suppressed group keeping its coverage and showing no amount;
  - the bounds of `min-coverage`.

**Live API** (counts only, PERCENT +5 on NET):

| Country | headcount / matched | coverage | benefitsNoneSelected | benefitsAssumed | messages |
|---|---|---|---|---|---|
| Egypt | 21 / 70 | 0.30 | 69 | 0 | EXCLUDED_NO_SALARY, NON_CONVERGED, BENEFITS_NONE_SELECTED, **LOW_COVERAGE** |
| Tunisia | 118 / 121 | 0.9752 | 119 | 0 | EXCLUDED_NO_SALARY, NON_CONVERGED, BENEFITS_NONE_SELECTED |

**Frontend** (`0b77169`):

- "X sur Y employés inclus" is always shown next to the KPI cards.
- Below the threshold:
  - a prominent banner appears (`role="alert"`);
  - the KPI, averages and currency figures are dimmed (`opacity`, `aria-hidden`, not selectable) until the user ticks "J'ai compris, afficher quand même".
- The acknowledgement is client-side only and resets on every new run.
- A suppressed group shows no amount and no banner, as before.
- FR/EN texts were added, plus singular `*_ONE` variants for the one-employee result. The COHORT keys are at parity: 102 FR / 102 EN.

**Playwright** (screenshots as text, `pw/coverage_ui.js`):

```
[egypt] coverage line: "21 sur 70 employés inclus"
[egypt] low-coverage banner shown: true
[egypt] figures dimmed before ack: true | aria-hidden: true
[egypt] warning BENEFITS_NONE_SELECTED shown: true
[egypt] warning LOW_COVERAGE shown: true
[egypt] figures dimmed after ack: false | totals unchanged by the ack: true
[egypt] dimmed again after a new run: true
[tunisia] coverage line: "119 sur 121 employés inclus"
[tunisia] low-coverage banner shown: false | figures dimmed: false
[tunisia] warning BENEFITS_NONE_SELECTED shown: true
[agg-small] suppressed state: true | KPIs: false | coverage line: false | banner: false
page errors: 0 in every session
```

The Tunisia UI run, at the default +0 %, included 119; the API run at +5 % included 118. One employee converges at one change and not at the other, and both counts are reported honestly.

## 4. Readiness for review

**Clean clones.** Each repo was cloned into a new temporary directory, with none of the user's uncommitted files, and the branch checked out:

| Repo | Command | Result |
|---|---|---|
| payroll-service | `mvn clean test` | **243 tests, 0 failures, BUILD SUCCESS** |
| payroll-frontend | `npm ci` + `ng build` | **bundle generated, exit 0** |

The frontend build shows 21 NG8102 warnings, all in other modules (`parameter-sets/admin/*`, `salary-advances`) and already present on `main`. The CLI printed one stray `fatal error:` line with no message after the output location, while the exit code stayed 0.

**Merge check.** In a temporary worktree, `git merge --no-commit --no-ff origin/main` gave:

| Repo | Result |
|---|---|
| payroll-service | "Already up to date" |
| payroll-frontend | "Already up to date" |

`origin/main` has **not moved** since the branch points (0 commits), so there are no conflicts and no overlapping files. The build and tests are the clean-clone results above. The merge was aborted and the worktree removed.

**Processes.** These were stopped, and their ports checked free:

- backend :8894;
- the `origin/main` baseline :8896;
- frontend :4215;
- the portal :8080 and shell :4200 started earlier in this session.

The baseline worktree and the clean clones were removed with `git worktree remove` / `rm -rf`. Nothing is left running.

**Temporary files.** The only ones left are the scripts and logs in the session scratchpad (`pm/`, `pw/`): no data, statuses only. Delete them whenever you like.

**Data.**

- The 98 `simulation_results` rows created by the test subs were deleted. Counts are back to **86** `simulation_results` and **4** `cohort_definitions`.
- No other table holds a row from those subs (every `*_by` column was scanned).
- `audit_trail` went from 3442 to **3638** (+196: the triggers wrote the 98 inserts and the 98 deletes). The rows were **left in place** (your decision, as with the 663 earlier rows).
- The baseline instance also ran the usual `pays_ref`/`users_ref` refresh from HR, which is idempotent; the Docker container runs it too.

**PRs.**

- `gh` is not authenticated on this machine, so no PR could be opened from here.
- The PR texts are in `docs/PR_feature-cohort-reactivate.md` (this repo) and in `docs/PR_feature-cohort-hardening.md` (payroll-service).
- Both branches were pushed to origin; see the final section of the hand-over message for their state.

## 5. Report only

**`INTERNAL_API_KEY`.** No value is printed here.

What the Spring configuration does:

- In each of the three services, `application.yml` reads `${INTERNAL_API_KEY:<default>}`:
  - **payroll-service** uses it for both `app.internal-api-key` and `app.hr-internal-api-key`;
  - **rh-service** uses it for `app.internal-api-key`;
  - **facturation-service** uses it for its client key.
- In all three, the default is the **same public placeholder** (`…change-me`), not empty.
- So a service started without the variable accepts, and sends, the placeholder.

Where the compose files pass the variable:

| Compose file | rh backend | facturation backend | payroll backend |
|---|---|---|---|
| `projects/docker-compose.dev.yml` | **not wired** | **not wired** | **not wired** |
| `daf360-shell/docker-compose.daf360.yml` | (not in file) | **not wired** | (not in file) |
| `daf360-portal/docker-compose.yml` | — | `facturation-service`: **not wired** | — |

- Only `daf360-timesheet-backend` gets `INTERNAL_API_KEY=${INTERNAL_API_KEY}`, in the shell compose file.
- Locally, every daf360 backend therefore runs on the placeholder, as found in the hardening audit.
- The test platform and production cannot be checked from here. Ask your colleague to confirm that each of the three backends has a non-default `INTERNAL_API_KEY`, with the **same** value in all three.

**Unchanged, restated:**

- Tunisian parameter-set drafts **10008** and **20007**: both still `DRAFT`, not approved, not activated.
  - 10008 has no abattement and no family deductions.
  - 20007 has CNSS `cap_amount = 5000`.
- Egypt: the active set **10** holds EGP-sized rubriques (MEAL 800, TRANSPORT 500, MEDICAL −200) in a USD payroll. As a result 48 of 69 employees are non-converged, and coverage is 0.30.

## 6. Questions for you (ambiguous access; current behaviour left as is)

1. **Q1. `GET /ref/users/by-pays/{paysId}`** returns another country's employee directory (names) to any user who can call it. The country is in the path, which neither guard reads, on `main` as on the branch. Should it be scope-checked?
2. **Q2. `PUT /salary-advances/policies/{paysId}`**: the country in the path is not checked. The body `paysId` is optional, so a Tunisia-only payroll admin can save Egypt's advance policy by leaving it out (pre-existing; follows from the code, not executed because it would write). Should the path be checked?
3. **Q3. `POST /admin/countries`**: a non-super-admin holding MANAGE_COUNTRIES, with a LIST/OWN scope, can no longer **create** a payroll country outside their scope (403), which `main` allowed. An ALL-scope admin and the super-admin are unaffected. Is that the intended rule for adding a new country, or should creation be exempt?
4. **Q4. Local HRD role (id 5) holds `PAYROLL_SUPER_ADMIN`**, so it bypasses all country scoping in payroll. If the test platform or production does the same, the A1 check never applies to HR directors. Intended?
5. **Q5. Tokens without scope claims** (only tokens older than the V74 scope claims) fall back to `users_ref.pays_id`. When that is missing, the body endpoints now refuse, exactly like the query-parameter interceptor already did. The portal always emits the claims today, so this should never happen. Tell me if you know of a caller that still uses such a token.

**Side note:** the earlier hardening session's test subs 10001/10003/10004 coincide with real `users_ref` ids. None of the rows it created remain (all deleted then). This session used 990001+ instead.
