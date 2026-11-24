# Cohort hardening + salary what-if — decisions and API contract

Decisions applied without stopping to ask, as the brief allowed (`PROMPT_COHORT_hardening_and_whatif.md`, §4).
Where the code had to refine a default, the refinement and its reason are given.

## Decisions

| # | Decision | Applied as | Refinement / note |
|---|---|---|---|
| DEC1 | Who sees what | `PAYROLL_VIEW_INDIVIDUAL` (or `PAYROLL_SUPER_ADMIN`) → `visibility = INDIVIDUAL`: exact figures, any group size, per-employee rows on request. Everyone else allowed on the endpoint (`RUN_SIMULATION`, `VIEW_AGGREGATE`) → `AGGREGATE`: totals only; below **k = 5** (`app.cohort.min-group-size`) `suppressed = true` and **every** amount field is `null` (totals, deltas, averages, EUR, CHF, %). | k is compared with `headcount` (employees whose figures are in the totals), not `matched`, since the totals are computed over `headcount`. Counts (matched, excluded, failed, non-converged) are always returned. |
| DEC2 | Salary base | `salaryBase`: `NET` (default) or `GROSS`. | `BRUT` accepted as an alias of `GROSS`. |
| DEC3 | Bounds | `PERCENT` −50 … +200 inclusive; `AMOUNT`: rejected if any resulting salary is **≤ 0**. | The default said "≥ 0". A salary of exactly 0 is refused too, because the individual simulator refuses a non-positive input (`inputNet`/`inputGross` must be positive) and the what-if must stay identical to it. |
| DEC4 | Non-converged | Never summed. Counted in `nonConverged`. When none converges, totals are `null` and message `ALL_NON_CONVERGED`. An employee counts as converged only if **both** the current and the projected computation converged. | |
| DEC5 | Benefits | Employee with an `employee_payroll_config` row → its `selected_benefit_codes` (an empty or NULL list = no benefit, exactly as the Rémunération screen reads it). No config → every benefit of the set, counted in `benefitsAssumed`, warning `BENEFITS_ASSUMED`. | On localhost all 121 Tunisian configs have `selected_benefit_codes = NULL`, so Tunisia is now computed **without** benefits (it was "all benefits" before). |
| DEC6 | Current gross | `employee_payroll_config.current_gross_salary` is used when re-computing the net from it gives the HR net back within `app.cohort.gross-consistency-tolerance` (default **0.05** in payroll currency); otherwise the gross is computed from the HR net with `computeFromNet`. Reported per employee as `grossSource` (`CONFIG` / `COMPUTED`) and in total as `grossFromConfig`. | 0.05 chosen because the config gross comes from the new payroll engine (orchestrator preview) and the cohort uses the simulator engine: agreeing to 5 hundredths means both engines say the same thing. |
| DEC7 | FX | `CohortFxResolver`: `payroll_fx_rates` (synced, CHF composed through EUR) → `payroll_countries` → `app.fx-rates`. A rate of exactly 1 between two different currencies is skipped; no usable rate → amount `null` + message `FX_MISSING_EUR` / `FX_MISSING_CHF`. | The `app.fx-rates` entries default every rate to 1 (`AppProperties.FxRateEntry`), which is why the 1.0 guard also applies to the config fallback. |
| DEC8 | Family status | HR `married` / `childrenCount` passed to the engine, with exactly the individual simulator's rule (married known → children default 0; unknown → engine default). | |
| DEC9 | Working days | `app.cohort.working-days`, default **22**. | Searched: no parameter set column (`parameter_sets` has 22 columns, none for days), no country column. Every engine path defaults to 22 (`SimulationRequest.joursTravailes`, `RunPayrollRequest.joursOuvresMois`, `EmployeePayrollConfigService.PREVIEW_WORKING_DAYS`), and 22 is `TopologicalEvaluator.STANDARD_WORKING_DAYS`, the full-month denominator of FIXE_JOURNALIER rubriques. No "26" exists in payroll-service. Now a setting, echoed as `workingDays`. |
| DEC10 | `entite` | Removed from the UI. The field stays in the request record only so that an old client sending `"entite": null` keeps working (DEC15); any non-blank value → **400**. Unknown fields → 400 (`@StrictJson`). | |
| DEC11 | Per-employee table | On screen only; no export added. | |
| DEC12 | Single employee | `POST /cohort/what-if/employee`, `VIEW_INDIVIDUAL` (or super-admin) only. The employee must be in the requested country's active HR workforce (404 otherwise); the country itself is scope-checked (A1). | |
| DEC13 | Persistence / access log | Nothing persisted. One log line per run: `[cohort-access] actor=<caller id> perms=<PAYROLL_* held> pays=<id> scope=GROUP|EMPLOYEE change=<type>/<base> filters=<codes> counts=<…>`. No amount, no name, no **employee** id. | The caller's own id is logged: an access log without an actor is useless. No existing audit mechanism fits (the trigger-based `audit_trail` only sees table writes, and nothing is written). Proposed table, not created (schema change withheld): `payroll_cohort_access_log(id, at, actor_user_id, permissions, pays_id, scope_type, filters_json, change_type, salary_base, matched, included, suppressed)`. |
| DEC14 | Display | API unrounded (engine scale 4); screen rounds to 2 decimals with the locale; percentages 2 decimals. | |
| DEC15 | Compatibility | The 13 original response fields keep their names and meaning; `modifierType` echoes what was sent (`PCT` / `ABSOLU` still accepted); new fields are additive. | One change of **value**: an amount that is hidden or cannot be computed honestly is `null` instead of `0` (empty cohort, suppressed group, nothing converged, no FX rate). |

Other choices made on the way:

- **A1 for every body `paysId`, not only `/cohort*`.** One `RequestBodyAdvice` (`PaysScopeBodyAdvice`) checks any request body exposing a `paysId`, so the eleven body-`paysId` endpoints listed in the report are all covered, not just the cohort ones. `/api/payroll/internal/**` (service-to-service, key-guarded) is excluded, as the interceptor already excluded it.
- **`POST /cohort` now requires `VIEW_INDIVIDUAL`** in addition to `RUN_SIMULATION`: it returns per-employee figures and `profileUserId`, which acceptance #4 forbids for non-individual roles.
- **Stored COHORT rows** (`simulation_results.simulation_type = 'COHORT'`) are now hidden from `/individual/history` and refused by `GET /simulations/{id}` and its PDF/Excel exports for callers without `VIEW_INDIVIDUAL` — the same leak through another door.
- **EMPLOYEE mode uses a dedicated endpoint** rather than a `mode` flag on `/cohort/aggregate`: different permission (individual only), different response shape (one person's five strata), and the aggregate contract stays untouched.

## Final API contract

All under `/api/payroll/simulations`. Errors are RFC 7807 problem details; the message is in `detail`.

### `POST /cohort/aggregate`

Permissions: any of `PAYROLL_RUN_SIMULATION`, `PAYROLL_VIEW_AGGREGATE`, `PAYROLL_VIEW_INDIVIDUAL`, `PAYROLL_SUPER_ADMIN`; `paysId` must be in the caller's scope.

Request (unknown fields → 400):

| Field | Type | Notes |
|---|---|---|
| `paysId` | number, required | |
| `grade`, `discipline`, `contractType` | string \| null | HR codes; null/blank = all |
| `entite` | null only | deprecated; non-blank → 400 |
| `modifierType` | `PERCENT` \| `AMOUNT` (aliases `PCT` \| `ABSOLU`), default `PERCENT` | other → 400 |
| `modifierValue` | number, default 0 | PERCENT −50…+200; AMOUNT keeps every salary > 0 |
| `salaryBase` | `NET` (default) \| `GROSS` | other → 400 |
| `includeEmployees` | boolean | true without `VIEW_INDIVIDUAL` → 403 |

Response: the 13 original fields (`headcount`, `currentMonthlyCost`, `projectedMonthlyCost`, `deltaMonthly`, `deltaAnnual`, `currentMonthlyCostEur`, `projectedMonthlyCostEur`, `currentMonthlyCostChf`, `projectedMonthlyCostChf`, `localCurrency`, `modifierType`, `modifierValue`, `appliedFilters`) plus `visibility`, `suppressed`, `minGroupSize`, `matched`, `excludedNoSalary`, `failed`, `nonConverged`, `benefitsAssumed`, `grossFromConfig`, `parameterSetId`, `parameterSetVersion`, `fiscalYear`, `asOf`, `fxSource`, `fx {currency, eurRate, eurSource, chfRate, chfSource, syncedAt}`, `changeType`, `salaryBase`, `workingDays`, `avgNetBefore`, `avgNetAfter`, `avgGrossBefore`, `avgGrossAfter`, `deltaPct`, `messages [{code, level, text}]`, `employees [EmployeeWhatIfRow] | null`.

`EmployeeWhatIfRow`: `profileUserId`, `contractType`, `grade`, `discipline`, `current` and `projected` (`Figures`: `netInHand`, `netTaxable`, `gross`, `grossWithBenefits`, `loadedCost`, `irppAmount`, `employeeCharges`, `employerCharges`, `taxableBase`, `convergenceOk`, `iterationsUsed`), `deltaNet`, `deltaGross`, `deltaLoadedCost`, `deltaLoadedCostPct`, `nonConverged`, `benefitsAssumed`, `grossSource`, `married`, `children`.

Message codes: `EMPTY`, `EXCLUDED_NO_SALARY`, `FAILED`, `NON_CONVERGED`, `ALL_NON_CONVERGED`, `BENEFITS_ASSUMED`, `SUPPRESSED`, `FX_MISSING_EUR`, `FX_MISSING_CHF`, `FX_NO_CURRENCY`.

Errors: 400 (validation, bounds, unknown field, non-numeric value, `entite`), 403 (country out of scope, `includeEmployees` without individual view), 404 (no active parameter set), 503 (HR unreachable or key refused).

### `POST /cohort/what-if/employee`

Permissions: `PAYROLL_VIEW_INDIVIDUAL` or `PAYROLL_SUPER_ADMIN`; `paysId` in scope.

Request: `paysId` (required), `profileUserId` (required), `modifierType`, `modifierValue`, `salaryBase` — same rules as above.

Response: `employee` (`EmployeeWhatIfRow`), `localCurrency`, `changeType`, `modifierValue`, `salaryBase`, `parameterSetId`, `parameterSetVersion`, `fiscalYear`, `workingDays`, `asOf`, `fxSource`, `fx`, `currentLoadedCostEur`, `projectedLoadedCostEur`, `currentLoadedCostChf`, `projectedLoadedCostChf`, `benefitCodes`, `messages`.

Errors: 400 (as above; employee without HR salary), 403, 404 (employee not in the country's active workforce), 503.

### Changed permissions on existing endpoints

| Endpoint | Before | After |
|---|---|---|
| `POST /cohort` | `RUN_SIMULATION` | `RUN_SIMULATION` **and** (`VIEW_INDIVIDUAL` or super-admin) |
| `GET /cohort/{id}` | `VIEW_INDIVIDUAL` or `VIEW_AGGREGATE`, no country check | `VIEW_INDIVIDUAL` or super-admin, and the cohort's country in scope |
| `GET /{id}`, `/{id}/export-pdf`, `/{id}/export.xlsx` | unchanged permission | a COHORT row also needs `VIEW_INDIVIDUAL` |
| `GET /individual/history` | unchanged permission | COHORT rows only for `VIEW_INDIVIDUAL` |
| `POST /cohort/aggregate` | `RUN_SIMULATION` | `RUN_SIMULATION`, `VIEW_AGGREGATE`, `VIEW_INDIVIDUAL` or super-admin |
