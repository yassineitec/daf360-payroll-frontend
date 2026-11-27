# Cohort simulation page — reactivation and audit

Branch `feature/cohort-reactivate` (local only, not pushed), worktree
`daf360-payroll-frontend-cohort-wt`, based on `origin/main` @ `790a11a`. Audit date: 2026-11-24.
Everything below was read from source or measured on **localhost** (payroll-service :8893,
rh-service :8888, SQL Server `DAF360_PAYROLL` / `DAF360_HR`). Figures are **aggregates only** —
no individual salary, name or user id appears in this document.

---

## 1. Summary

1. **Usable today?** The page loads, runs, and returns plausible-looking aggregates for Tunisia. For Egypt, its numbers are meaningless. It must not be shown to Finance or HR, or shared further, until the P0 defects in §6 are fixed.
2. **What it does.** You pick a country, optionally a grade, a discipline or a contract type, and a salary modifier (a % or an absolute amount on the **net**). It then calls `POST /cohort/aggregate`. That endpoint:
   - pulls the live active workforce from RH;
   - runs the old engine (net → gross) twice per employee;
   - returns the summed **loaded cost (S5)** today and after the modifier, the monthly and annual delta, and EUR and CHF conversions.

   Nothing is persisted.
3. **Gap 1 — only S5.** Only the loaded cost is aggregated. There are no 5-strata totals, no monthly cash-out, no year-on-year view and no comparison with the prior parameter set (spec R4, R6, R7, R8).
4. **Gap 2 — today's workforce only.** The cohort is the current workforce, with no planned hires, no planned promotions, no scenarios and no export to the budget Excel (R2, R9).
5. **Gap 3 — failures are silent.**
   - Convergence failures are summed into the totals: 69 of 69 Egyptian employees fail.
   - Employees without salary data are dropped without saying so.
   - When RH is down, the API returns **"0 employees, 0 cost"** with HTTP 200.
   - The "Entity" filter is ignored.
6. **Biggest risk — individual compensation is exposed.**
   - The aggregate has **no minimum group size**: `contractType=CDD` in Tunisia, or any grade held by one person, returns `headcount = 1`, i.e. one person's loaded cost.
   - The endpoint has **no country scoping**: a user scoped to Egypt gets Tunisia's figures.
   - The sibling `GET /cohort/{id}` returns per-employee gross, net, IRPP and loaded cost to anyone holding `PAYROLL_VIEW_AGGREGATE`, in any country.
7. **Wrong conversions.** Tunisia's EUR figure equals its TND figure, because `payroll_countries.eur_rate = 1.000` for TND. The synced rate (0.300) is never used.
8. **Egypt root cause.** The ACTIVE Egypt set (id 10) holds what look like EGP benefit amounts (800, 500 and 1 500 per month) in a USD payroll. They are applied to every employee, so the net-to-gross solve can never converge.
9. **Reactivation.** It took one file. `cohort.routes.ts` is restored byte-for-byte to its pre-`58f3aaf` content, in commit `6a9884e`. No other fix was needed.
10. **Unplugging was a side effect.** The page was not removed because it was broken; see §2.

---

## 2. Step 0 — why was it unplugged?

| Item | Finding |
|---|---|
| Commit | `58f3aaf`, Ihab Kaabi, 2026-09-24. Message: "feat(candidate-simulation): add candidate simulation component…" plus "feat(shared): add under development placeholder component" |
| What it did to cohort | `cohort.routes.ts` `loadComponent` was switched to `UnderDevelopmentComponent`, with the comment *"Route temporarily points at the shared placeholder rather than `CohortComponent` — the real component is untouched, just unplugged. Swap the `loadComponent` back to restore it."* The same commit **i18n-ised** `cohort.component.html` and `.ts`: hard-coded French became `PAYROLL.COHORT.*` keys, `app-pays-select` became `daf-select`, and breadcrumbs were added. It did not just park the page. |
| Calibration | Same commit, same comment, same mechanism |
| Budget | `54ac9a0` (2026-09-25, same author), inside an employee-config/home commit, with no stated reason |
| Deliberate or side effect? | **Deliberate "park for now", not a removal for breakage.** The comment says *temporarily* and *untouched*. The component was being actively polished in the same commit. No commit message, comment or TODO says the page was wrong. |
| Changes to the cohort module since | `c6f3a5e` (2026-11-06) switched the country list to payroll-active countries (`listPayrollPays`), which shows the component was still being maintained. `0757f05` and `b8635ea` brought earlier minor edits. Nav (`payroll-nav.ts`) changes in `800555e`/`09cb026` and `app.routes.ts` changes in `800555e`/`b73db55` did not touch cohort. |
| Does anything depend on it being unplugged? | No. The nav entry, the `app.routes.ts` guard (`PAYROLL_RUN_SIMULATION`) and `payrollLandingGuard` never referenced the placeholder. |

---

## 3. Step 1 — reactivation

**Diff (commit `6a9884e`, one file)**

```diff
 export const COHORT_ROUTES: Routes = [
   {
     path: '',
     loadComponent: () =>
-      import('../../shared/under-development/under-development.component')
-        .then(m => m.UnderDevelopmentComponent),
-    data: {
-      titleKey: 'PAYROLL.COHORT.TITLE',
-    },
+      import('./cohort.component').then(m => m.CohortComponent),
   },
 ];
```

The file is now the exact blob it was before `58f3aaf` (`eedae30`). **No other fix was needed**: the component compiles and runs as is.

**Proof**

| Check | How | Result |
|---|---|---|
| Build | `ng build` in the worktree | 0 errors. The only warnings are pre-existing ones in other modules; none in cohort. |
| Loads for an allowed user | Worktree served on :4215. Headless Chromium (Playwright) with only the portal's `/api/me` stubbed: a fake user holding `PAYROLL_RUN_SIMULATION` and `PAYROLL_VIEW_AGGREGATE`, plus a locally minted RS256 JWT signed with the portal dev key. Every payroll API call hit the real localhost backend. | `/cohort` renders "Simulation cohorte — Impact budgétaire" and the form, with no placeholder. Picking "Tunisie (TN)" and clicking "Simuler l'impact" shows "119 employés simulés" and the 4 KPI cards. |
| Refused without the permission | Same harness, user holding only `PAYROLL_VIEW_RESULTS` | A deep link to `/cohort` lands on `/accueil`. No form. No "Simulation cohorte" in the sidebar. |
| Sidebar entry | Open the "Simulation" group, then click "Simulation cohorte" | Navigates to `/cohort`. The control case, "Simulateur manuel", goes to `/simulator`. |
| `payrollLandingGuard` | `/` and an unknown path (`/budget-old-bookmark`) | Both land on `/accueil`, unchanged. |
| Console | Same runs | No errors from the page. The only errors were EventSource MIME errors caused by the stubbed portal. |

---

## 4. Step 2 — full page inventory (frontend)

Files: [`cohort.component.ts`](../src/app/modules/cohort/cohort.component.ts) (132 lines), [`cohort.component.html`](../src/app/modules/cohort/cohort.component.html) (220), `cohort.component.scss` (empty), [`cohort.routes.ts`](../src/app/modules/cohort/cohort.routes.ts). There are no child components, dialogs or pipes beyond `TranslatePipe`.

### 4.1 Layout, in order

| # | Element | Where |
|---|---|---|
| 1 | `daf-page` with `[loading]="loading()"`: a full-page loading overlay while a request runs | html:1 |
| 2 | Page header: title `PAYROLL.COHORT.TITLE`, subtitle (*"…Aucun salaire individuel n'est affiché"*), breadcrumbs Paie › Simulation cohorte | html:2-6, ts:52-55 |
| 3 | Card "Périmètre & modificateur": the country, the "Filtres démographiques" block and the "Modificateur salarial" block | html:11-115 |
| 4 | Action row: "Simuler l'impact" button and an inline error banner | html:99-113 |
| 5 | Results card, only when a result exists: header with a headcount badge and applied-filter chips, 4 KPI cards, FX block | html:118-217 |

There are no tabs, steps, tables or charts.

### 4.2 Inputs and controls

| Label (fr) | Type | Default | Validation | Feeds |
|---|---|---|---|---|
| Pays * | `daf-select`, searchable; options from `GET /ref/pays/payroll` as "Tunisie (TN)" / "Égypte (EG)" | none | Button disabled until set (html:103). `required` is visual only. | `paysId` |
| Grade | `daf-form-field` text, placeholder "ex : Senior" | `''` | none | `grade` (`''` → `null`) |
| Discipline | text, placeholder "ex : Engineering" | `''` | none | `discipline` |
| Type de contrat | `daf-select`: Tous / CDI / CDD (ts:81-85) | `''` (Tous) | none | `contractType` |
| Entité | text, placeholder "ex : ITEC Tunisia" | `''` | none | `entite`. **Sent, but ignored by the backend.** |
| Type (modifier) | `daf-select`: Pourcentage (%) / Montant absolu (devise locale) | `PCT` | none | `modifierType` (`PCT` / `ABSOLU`) |
| Valeur (%) / Montant (devise locale) | number field. Hint: "5 = +5% · −3 = −3% du net versé" or "Montant à ajouter / soustraire au salaire net" | `0` | No min/max; −100 % or −100 000 accepted | `modifierValue` |

**Mismatches with the data**
- **Grade and discipline values.** HR returns *codes* (e.g. `AG2`, `BC1`, `ADMIN`, `BIM_CAD`). The placeholders suggest free labels ("Senior", "Engineering"), and those return 0 employees. There is no dropdown, even though `GET /api/hr/ref/grades` and `/disciplines` exist.
- **Contract types.** Only CDI and CDD are offered. Tunisia has 12 active `CIVP` employees who can be reached only by "Tous".

### 4.3 Buttons and actions

| Action | Triggers |
|---|---|
| "Simuler l'impact" | `submit()` (ts:92-115): clears the error and result, calls `runCohortAggregate`, then sets `result` or `error` |

There is no reset, no save, no export, no PDF and no history.

### 4.4 Results: KPI cards and chips

| Element | Field | Where |
|---|---|---|
| Badge "{n} employés simulés" | `headcount` | html:128-131 |
| Chips Grade / Discipline / Contract | `appliedFilters.grade`, `.discipline`, `.contractType` (the entity chip is **not** shown) | html:132-146 |
| Modifier chip | `modifierType` and `modifierValue` (`+5%` or `+100,00 TND`) | html:147-153 |
| Coût mensuel actuel | `currentMonthlyCost` + `localCurrency` | html:159-163 |
| Coût mensuel projeté | `projectedMonthlyCost` | html:165-169 |
| Δ mensuel | `deltaMonthly`, coloured green if ≥ 0 and red if < 0, with a `MetricDelta` arrow | html:171-176 |
| Impact annuel | `deltaAnnual` (= Δ × 12) | html:178-183 |
| FX block "Conversions devises — coût mensuel chargé" | EUR row: `currentMonthlyCostEur` → `projectedMonthlyCostEur`. CHF row: same for CHF. Shown only when a value is non-null. | html:187-214 |

### 4.5 States

| State | Behaviour |
|---|---|
| Loading | Full-page overlay (`daf-page [loading]`) and a spinner on the button |
| Error | Inline red banner showing `err.error.message`, else the generic "Erreur lors de la simulation cohorte" (ts:111). The backend returns RFC-7807 `ProblemDetail` (`detail`, not `message`), so **the backend's message is never shown**. An unknown country, for example, gives the generic text. |
| Empty (0 employees) | No empty state: the result card shows "0 employés simulés" and four cards at 0. |
| HR down | Looks exactly like the empty state: HTTP 200, 0 employees (see §5.5). |
| Partial / convergence failure | Not represented at all. The DTO has no field for it. |

### 4.6 Permissions on the page

The page itself performs no permission check. The route guard (`app.routes.ts:105-110`) and the nav entry (`payroll-nav.ts:191-195`) both require `PAYROLL_RUN_SIMULATION`. `PAYROLL_VIEW_AGGREGATE` has no effect on this page. There is no notion of a Finance, HR, Country Director or Regional Head view.

### 4.7 HTTP calls

| Service method | Verb and URL | Body | Response |
|---|---|---|---|
| `listPayrollPays()` (payroll-api.service.ts:434) | `GET {payrollApiUrl}/api/payroll/ref/pays/payroll` | none | `PaysDto[]` `{id, isoCode, frenchLabel, devise}` |
| `runCohortAggregate()` (payroll-api.service.ts:568) | `POST …/api/payroll/simulations/cohort/aggregate` | `CohortFilterRequest` | `CohortAggregateResponse` |
| `runCohortSimulation()` / `getCohortResults()` (564/572) | `POST …/simulations/cohort`, `GET …/simulations/cohort/{id}` | — | **Never called by any component** (dead in the UI) |

The `Authorization: Bearer <rhToken>` header is added by `auth.interceptor.ts`.

### 4.8 Models (payroll-api.service.ts:289-315)

| `CohortFilterRequest` | type | `CohortAggregateResponse` | type / unit |
|---|---|---|---|
| paysId | number, required | headcount | int: employees that *succeeded*, not employees matched |
| grade, discipline, contractType, entite | string \| null | currentMonthlyCost, projectedMonthlyCost | local currency, S5 loaded cost per month, 4 decimals |
| modifierType | `"PCT"` \| `"ABSOLU"` | deltaMonthly, deltaAnnual | local currency (Δ × 12) |
| modifierValue | number | current/projectedMonthlyCost**Eur**, **Chf** | EUR / CHF, or null when the rate is missing |
| | | localCurrency | ISO code from `payroll_countries` (TN = **TND**, EG = **USD**) |
| | | modifierType, modifierValue, appliedFilters | echo of the request (`modifierType` echoes even an invalid "FOO") |

**Unfinished or hard-coded items:** no TODOs, no commented-out code and no console logs. Hard-coded items:
- the contract list CDI/CDD (ts:83-84);
- the free-text placeholders "Senior", "Engineering" and "ITEC Tunisia".

The sidebar's **display-currency switcher ("Devise") is ignored** by this page: it always shows the local currency plus EUR and CHF. i18n: 35 `PAYROLL.COHORT.*` keys, fr and en in parity, all used, none missing.

---

## 5. Step 3 — backend trace

### 5.1 Endpoints (`SimulationController`, `/api/payroll/simulations`)

| Endpoint | `@PreAuthorize` | Country scoping | Used by the page |
|---|---|---|---|
| `POST /cohort/aggregate` (:113-117) | `PAYROLL_RUN_SIMULATION` | **None.** `PaysIsolationInterceptor` reads only the `paysId`/`pays` *query parameter*, and here `paysId` is in the JSON body. Verified live. | yes |
| `POST /cohort` (:99-105) | `PAYROLL_RUN_SIMULATION` | **None** (body) | no |
| `GET /cohort/{cohortId}` (:107-111) | `PAYROLL_VIEW_INDIVIDUAL` **or `PAYROLL_VIEW_AGGREGATE`** | **None** (no paysId at all) | no |

### 5.2 `POST /cohort/aggregate` → `CohortAggregateService.aggregate()`

| Step | Code | Behaviour |
|---|---|---|
| Parameter set | `ParameterSetService.loadActiveEntity(paysId)` | `findFirstByPaysIdAndStatusOrderByVersionDesc(paysId,"ACTIVE")`. The **ACTIVE** set only; fiscal year plays no role; it cannot be chosen. None found → `NoSuchElementException` → 404. |
| Engine inputs | `loadRates`, `loadBenefits`, `loadRubriques` | **All** benefits of the set are applied to **every** employee. The employee's own `selectedBenefitCodes` (employee config) are ignored. |
| FX | `FxSnapshotService.resolve(paysId)`, called once | Reads `payroll_countries.currency_code/eur_rate/usd_rate/chf_rate`, with the YAML `app.fx-rates` as fallback. **Does not read `payroll_fx_rates`**, the table synced from facturation `/api/fact/ref/fx-rates` every 15 min. |
| Population | `HrEmployeeClient.fetchActiveEmployees(paysId)` | `GET {HR}/api/hr/internal/payroll-sync/employees?paysId=` with header `X-Internal-Key` (5 s connect / 15 s read timeouts). RH returns `lifecycle_status IN (ACTIVE, ON_LEAVE, ON_MISSION)`. Fields read: `userId, paysId, contractType` (code), `grade` (code), `discipline` (code), `salaireNetRh`, `married`, `childrenCount`. **Any error → empty list** (logged at WARN only). |
| Filters | Java stream | `equalsIgnoreCase` on grade, discipline and contractType. `null` = all. `""` matches nobody. **`entite` is never applied.** |
| Empty | `emptyResponse` | All zeros, headcount 0, HTTP 200. Identical whether the reason is "no match" or "RH down". |
| Per employee | `computeFromNet(salaireNetRh, ps, rates, benefits, rubriques, contractType ?: "CDI", 22)` → `loadedCost`; then the same call on `applyModifier(net)` | Iterative reverse calculation (bisection, tolerance and max iterations from the set: 0.01 / 50). **Family status is not passed** (married=false, children=0), unlike the individual simulator. **22 working days are hard-coded.** |
| Modifier | `applyModifier` | `ABSOLU`: net + value, floored at 0. Anything else (including "FOO", "pct"): treated as PCT, net × (1 + v/100), floored at 0. Always applied to the **net**. |
| Failures | `try/catch (Exception)` per employee | An exception (e.g. null salary → NPE "targetNet is null") **silently drops the employee**: WARN log, and `headcount` = successes. A **non-converged result is not an exception**: the engine returns its last estimate with `convergenceOk=false`, which is **summed like any other**. Nothing is counted or returned. |
| Totals | `deltaMonthly = projected − current`, `deltaAnnual = Δ × 12` | Scale 4, HALF_UP. EUR and CHF = total × snapshot rate. USD is computed in the snapshot but not returned. |
| Persisted | — | **Nothing.** No `cohort_definitions` row, no `simulation_results`, no audit. Not retrievable later. |

### 5.3 Strata and forex per employee

The engine computes all 5 strata per employee:
- S1 `netInHand`;
- S2 `netTaxable`/`taxableBase`;
- S3 `gross`;
- S4 gross + exempt benefits;
- S5 `loadedCost`;
- plus IRPP, employee charges and employer charges.

**The aggregate keeps only S5.** Forex snapshots (local, EUR, CHF, plus USD in the snapshot) are applied to the **S5 totals only**, not per stratum.

### 5.4 `POST /cohort` → `CohortSimulationService.simulate()` (not used by the page)

- It writes one `cohort_definitions` row: `name`, `fiscal_year`, `parameter_set_id`, `created_by`, `status = VALIDATED`, `total_loaded_cost`, `total_headcount`.
- It writes one `simulation_results` row per employee, with `simulation_type = COHORT`. Each row holds gross, S2, S4 (`gross_with_benefits`), loaded cost, IRPP, employee and employer charges, benefits and rubriques as JSON, iterations, `convergence_ok`, FX rates and EUR/USD/CHF loaded cost.
- Per-employee inputs are supplied **by the caller**, so this path does not use HR.
- The latest COHORT simulation is also the **fallback input to F.04 budget lines** (audit §6.3) when a parameter set is activated.

### 5.5 Response DTO

See §4.8. There is no field for: parameter set id/version, failed or skipped count, non-converged count, excluded count, strata, or as-of date.

---

## 6. Step 4 — live behaviour (localhost, aggregates only)

### 6.1 Population (HR internal API)

| | Tunisia (179) | Egypt (53) |
|---|---|---|
| Active workforce returned by HR | 121 | 70 |
| With usable salary (`salaire_net_rh > 0`) | 119 | 69 |
| Excluded (salary NULL), **silently** | 2 | 1 |
| Contract codes | CDI 106, CIVP 12, CDD 1, null 2 | CDI 69, null 1 |
| Distinct grades / disciplines | 25 / 15 | 14 / 13 |
| grade × discipline × contract combinations held by exactly 1 person | 18 of 40 | 15 of 28 |

### 6.2 `POST /cohort/aggregate` results

| Scenario | Headcount | Current / month | Projected / month | Δ monthly | Δ annual | Δ % | Time |
|---|---|---|---|---|---|---|---|
| TN, no filter, 0 % | 119 | 296 447.12 TND | 296 447.12 | 0 | 0 | 0 | 1.9 s (cold) |
| TN, +5 % | 119 | 296 447.12 | 315 528.28 | +19 081.16 | +228 973.90 | +6.44 % | 1.2 s |
| TN, +100 absolute | 119 | 296 447.12 | 317 537.87 | +21 090.75 | +253 089.04 | +7.12 % | 1.2 s |
| EG, no filter, 0 % | 69 | 264 902.47 USD | 264 902.47 | 0 | 0 | 0 | 1.2 s |
| EG, +5 % | 69 | 264 902.47 | 278 147.59 | +13 245.12 | +158 941.50 | +5.00 % | 1.0 s |
| EG, +100 absolute | 69 | 264 902.47 | 290 644.99 | +25 742.52 | +308 910.24 | +9.72 % | 1.0 s |

**Internal consistency**
- In every run, projected − current = Δ monthly exactly, and Δ annual = 12 × Δ monthly exactly.
- Headcount = the usable population.

**Plausibility, Tunisia.** +5 % on net gives +6.4 % on loaded cost, which is expected with progressive IRPP. +100 TND net per head (11 900 in total) gives +21 091 of loaded cost, a marginal cost of about 1.77 per unit of net, which is plausible. The cohort-wide loaded/net ratio is 1.43.

**Plausibility, Egypt: not plausible.**
- The loaded/net ratio is **3.73**.
- +100 USD of net costs **+373 USD** per head.
- In the engine output, the **computed net (445 045) exceeds the gross (213 013)**, while the target net sum is 71 004.
- All 69 employees fail to converge: 50 of 50 iterations each, and the computed net is off target for 69 of 69.
- Root cause, from the data: the ACTIVE Egypt set (id 10) has benefits MEAL 800, TRANSPORT 500 (both non-taxable) and SCHOOLING 1 500 per month. These are EGP-sized amounts in a USD payroll, applied to every employee. Non-taxable benefits alone exceed most target nets, so no gross ≥ 0 can produce the target, and the solver returns garbage that the aggregate sums.

**FX**
- Tunisia: EUR = TND (rate 1.000) and CHF = 1.055 × TND. **Both are wrong.** The facturation-synced `payroll_fx_rates` has TND → EUR 0.300.
- Egypt: EUR rate 0.917, close to the synced 0.914. The CHF rate is 0.968, while the synced cross rate is about 0.84.

### 6.3 Filters

| Filter | Headcount | Note |
|---|---|---|
| Most common TN grade (code) | 18 | Works; case-insensitive (lower-case gives 18 too) |
| Most common TN discipline (code) | 49 | Works |
| contractType CDI / CIVP / CDD | 104 / 12 / **1** | CIVP is not offered by the UI. **CDD returns a single person.** |
| A grade held by one person | **1** | Individual loaded cost exposed |
| grade "Senior" (the UI's own placeholder) | 0 | Labels never match codes |
| grade "" (direct API) | 0 | Empty string is not treated as "all" |
| entite "NO_SUCH_ENTITY_XYZ" | 119 | **Filter ignored** |

### 6.4 Independent cross-check

1. **Whole population through `POST /cohort`** (the same engine path, cohorts `ZZ_AUDIT_full_*`). The sum of per-row `loadedCost` equals the aggregate's `currentMonthlyCost` exactly: TN 296 447.1201, difference 0.0000; EG 264 902.4690, difference 0.0000. `parameter_set_id` used: **TN 9, EG 10**. Non-converged: **TN 2, EG 69**.
2. **The first 10 usable employees by user id, through the individual simulator** (`POST /individual`, labels `ZZ_AUDIT_xcheck_*`).
   - **TN:** the individual sum is −0.30 % below the cohort-engine sum (−67.13 TND on 22 720). Cause: the individual simulator applies the RH family status (married/children → IRPP deduction) and the aggregate does not; 3 of the 10 sampled are married and/or have children.
   - **EG:** difference 0.000 %, because Egypt's engine ignores the family deduction.

### 6.5 Parameter set, convergence, timing

- ACTIVE sets: **TN id 9** (v1, FY 2025) and **EG id 10** (v1, FY 2025). Tolerance 0.01, 50 iterations.
- Non-converged employees, which the response does not report: TN 2 / 119, EG 69 / 69.
- Whole-workforce response time: 1.0–1.9 s for the aggregate (2 solves per employee). `POST /cohort` for the same population took 0.4–0.7 s.

### 6.6 Error behaviour

| Case | Result | Verdict |
|---|---|---|
| **HR unreachable** (rh container stopped, then restarted) | **HTTP 200, headcount 0, all costs 0**; a WARN log only | ❌ silent zero |
| Unknown country (999999) | 404 `ProblemDetail` "No ACTIVE parameter set for paysId=999999". The UI shows only the generic error (it reads `.message`). | ⚠ clear in the API, lost in the UI |
| Empty cohort (no match) | 200, headcount 0, zeros | ⚠ indistinguishable from "HR down" |
| Missing `paysId` | **500** generic | ❌ should be a 400 |
| `modifierValue: "abc"` | **500** generic | ❌ should be a 400 |
| `modifierType: "FOO"` | 200, treated as PCT, response echoes "FOO" | ❌ silently accepted |
| PCT −100 / ABSOLU −100 000 | 200, projected cost 0.00 | ⚠ no bounds |
| No token | 403 | ✅ |
| Token with `PAYROLL_VIEW_AGGREGATE` only | 403 | ✅ |
| **Token scoped to Egypt, `paysId = 179`** | **200, Tunisia's figures** | ❌ no country scoping |
| `GET /cohort/{TN cohort}` with `VIEW_AGGREGATE` + Egypt scope | **200, 119 rows** with `profileUserId`, `gross`, `inputNet`, `irppAmount`, `loadedCost` | ❌ per-employee compensation exposed |

---

## 7. Step 5 — comparison with the spec (H.10)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| R1 | Used by the Finance Manager (budget) and the HR Manager (benchmarking) | PARTIAL | One gate, `PAYROLL_RUN_SIMULATION`. No role-specific view, no budget-cycle notion. |
| R2 | Cohort = existing profiles + planned hires + planned promotions | MISSING (existing profiles only) | Population is the live HR workforce only (§5.2); no schema for planned hires or promotions |
| R3 | Same 5-strata model, parameter set and reverse calculation as the individual simulator | PARTIAL | Same engine (`computeFromNet`) and ACTIVE set. **But:** family status ignored, every benefit forced on everyone, 22 days hard-coded, convergence flag ignored. Sample difference −0.30 % (TN). |
| R4 | Aggregated 5-strata totals | MISSING | Only S5 is aggregated (§5.3) |
| R5 | Three forex snapshots per stratum, aggregated | PARTIAL | EUR and CHF on S5 totals only. TN rates wrong (1 TND = 1 EUR). Not per stratum. |
| R6 | Monthly cash-out projection (monthly payroll + quarterly statutory) | MISSING | Only "monthly × 12" |
| R7 | Year-on-year evolution | MISSING | — |
| R8 | Comparison against the prior parameter-set version | MISSING | ACTIVE set only; no set selector |
| R9 | Feeds the budget Excel to Cost Management (export) | MISSING | No export of any kind |
| R10 | Downstream feed per entity / cost category / month to F.04, and cash-out to F.07 | PARTIAL | F.04/F.07 exist in the backend (`payroll_budget_lines`/`payroll_forecast_outputs`) but are fed on parameter-set activation from calibration or the latest `POST /cohort` run, **not from this page**. F.07 is ×1/×3/×12, not a monthly cash-out. No cost category. |
| R11 | Per-resource only for HR/Finance Managers; aggregates for Country Director/Regional Head must not reveal individuals | MISSING / violated | No minimum group size (headcount 1 reachable). No country scoping. `GET /cohort/{id}` gives per-resource data to `VIEW_AGGREGATE`. |
| R12 | Wave 1A cohort level = grade × discipline | PARTIAL | Grade and discipline filters exist (free-text codes, unusable as labels). No grade × discipline breakdown in the output. |
| R13 | Convergence failure raises an exception surfaced to the user | MISSING | Non-converged results are summed silently (EG 69/69) |
| R14 | Outputs stored with the parameter-set version, retrievable for audit | MISSING for this page (aggregate persists nothing); PARTIAL in the backend (`POST /cohort` stores `parameter_set_id` and rows) | §5.2, §5.4 |
| R15 | Per-resource gross, employer charges, benefits-in-kind and loaded cost stored; payslip never stored | PARTIAL | Stored only by `POST /cohort` (unused by the UI). The aggregate stores nothing. |

---

## 8. Step 6 — defects and risks (most severe first)

| Sev. | Defect | Evidence |
|---|---|---|
| **P0** | `GET /cohort/{id}` returns per-employee gross, net, IRPP and loaded cost with `profileUserId` to `PAYROLL_VIEW_AGGREGATE` holders, in any country | §6.6 |
| **P0** | No minimum group size: a filter narrowing to 1 person reveals that person's loaded cost (TN CDD = 1; 7 TN and 8 EG grades held by one person) | §6.3 |
| **P0** | No country scoping on the body-`paysId` endpoints (`/cohort/aggregate`, `/cohort`) | §5.1, §6.6 |
| **P0** | Egypt results meaningless: the ACTIVE set has EGP-sized benefits in a USD payroll; 69/69 non-converged results are summed | §6.2 |
| P1 | HR down shows "0 employees, 0 cost" with 200 (silent zero) | §6.6 |
| P1 | Non-converged and skipped employees are neither counted nor surfaced | §5.2 |
| P1 | Tunisia EUR and CHF conversions wrong (`payroll_countries.eur_rate = 1.000` for TND; synced `payroll_fx_rates` unused) | §6.2 |
| P2 | `entite` filter accepted, echoed and ignored | §6.3 |
| P2 | Grade and discipline are free text but match codes; the placeholders lead to 0 results | §4.2 |
| P2 | Family status and per-employee benefits ignored (−0.3 % vs the individual simulator on the TN sample) | §6.4 |
| P2 | Invalid input → 500 (missing `paysId`, non-numeric value) or silently accepted ("FOO", −150 %) | §6.6 |
| P2 | UI never shows the backend's error text (`detail` vs `.message`) | §4.5 |
| P3 | CIVP (12 TN employees) cannot be selected; the display-currency switcher is ignored; no empty state; no export or history | §4.2, §4.5 |
| P3 | `HrEmployeeDto` RH endpoint does not exclude soft-deleted profiles (`deleted` flag not filtered) | rh `InternalPayrollSyncController.employeesByPays` |
| P3 | Both local containers run with the repo's **default** internal API key (no `INTERNAL_API_KEY` env set) | `docker exec … env` |

The smallest group the API will return is **1**.

---

## 9. Step 7 — dependencies and prerequisites

- **Parameter sets (localhost).**
  - ACTIVE: TN id 9 (FY 2025), EG id 10 (FY 2025).
  - TN drafts: id 10008 (v2, FY 2026, 17 rates, 4 benefits) and id 20007 (v3, FY 2026, 4 rates and 1 benefit, same rates as id 9).
  - The cohort **always** uses the ACTIVE set. Activating a corrected 2026 TN set *would* change every cohort figure. The size of the change cannot be measured without activating, which this audit was not allowed to do.
  - Egypt needs its benefit amounts fixed (currency) before any Egypt cohort figure is usable.
- **HR internal API.** It works on localhost: `X-Internal-Key`, `/api/hr/internal/payroll-sync/employees`. Both containers fall back to the repo default key, which must be overridden per environment.
- **Data completeness.** TN 119/121 have a salary, EG 69/70. `salaire_net_rh` is only kept current by the payroll employee-config save (`pushCurrentNetSalary`), so stale values flow into the cohort.
- **FX.**
  - The cohort reads static `payroll_countries` rates (admin-entered, YAML fallback).
  - The facturation sync (`ProfileSyncService.syncFxRates`, every 15 min) fills `payroll_fx_rates` with the latest rate only (no history), and the cohort does not use it.
  - A future month gets **today's static rate**: there is no dated or forecast rate.
- **Cash-out (R6) would need things that do not exist yet:**
  - a statutory payment calendar per country (e.g. TN CNSS quarterly, monthly IRPP withholding);
  - month-specific rubriques (13th month, bonuses, Ramadan/Eid allowances);
  - hire and leave dates for planned changes;
  - dated FX rates.

**Other unplugged pages (state only):** `budget.routes.ts` and `calibration.routes.ts` still point at `UnderDevelopmentComponent`. Budget ("Budget prévisionnel") is visible in the sidebar and opens the placeholder.

---

## 10. Step 8 — extension proposal (nothing built)

**Recommendation: keep `/cohort/aggregate` for the quick what-if, hardened, and add a new versioned *budget-scenario* API** for R2/R4–R10/R14. Bending one stateless endpoint into a stored, multi-month, multi-version budget would break its current callers and mix two jobs.

| Order | Item | Requirements | What | Effort | Risk / dependencies |
|---|---|---|---|---|---|
| 1 | Close the exposure | R11 | Scope `GET /cohort/{id}` to `VIEW_INDIVIDUAL` + the cohort's country. Make the interceptor (or the service) check body `paysId` for `/cohort*`. Add a **minimum group size `k = 5`**: below it, return headcount and a "group too small" flag, never amounts. Apply the same rule to any chip combination. | S | None; ship first |
| 2 | Honest failures | R13 | HR failure → 503 with a clear message. Response gains `excludedNoSalary`, `failed`, `nonConverged`, `parameterSetId/version`. UI shows a warning and refuses to show totals when `nonConverged > 0`, unless the user acknowledges. Validate `modifierType` and bounds (400). Show `ProblemDetail.detail`. | S | — |
| 3 | Data fixes | R3, R5 | Fix EG set id 10 benefit currency. Fix TN `payroll_countries` EUR/CHF (or read `payroll_fx_rates`). Pass married/children and per-employee benefits. Drop `entite` or implement it. | S | Payroll admin decision on the EG amounts |
| 4 | Usable filters | R12 | Grade and discipline dropdowns from `/api/hr/ref/grades|disciplines`; contract list from the country's contract types | S | — |
| 5 | Strata + FX per stratum + grade × discipline breakdown | R4, R5, R12 | Aggregate S1–S5, IRPP and charges, ×3 currencies; grouped table, subject to the k rule | M | k rule from item 1 |
| 6 | Scenarios, versions, stored results | R2, R8, R14, R15 | New tables (below), `POST /budget-scenarios`, `/{id}/run`, `/{id}/compare?vs=` | L | Schema in `daf360-sql` |
| 7 | Monthly projection, cash-out, YoY | R6, R7 | 12/24-month grid per entity and category, statutory calendar, dated FX | L | Statutory calendar + rates; finance sign-off |
| 8 | Export + F.04/F.07 feed | R9, R10 | Excel in the Cost-Management template; publish budget lines per entity / category / month from a *validated* scenario (not from "latest cohort") | M | Items 6 and 7; facturation contract |

**Schema sketch**
- `budget_scenario` (id, pays_id, fiscal_year, name, base_parameter_set_id, status DRAFT/VALIDATED, created_by/at).
- `budget_scenario_hire` (scenario_id, grade_code, discipline_code, contract_type, start_month, net_or_gross, amount, headcount).
- `budget_scenario_promotion` (scenario_id, user_ref_id, effective_month, new_grade_code, new_net).
- `budget_scenario_modifier` (scenario_id, scope grade/discipline/contract, type, value, effective_month).
- `budget_scenario_run` (id, scenario_id, parameter_set_id, parameter_set_version, fx_snapshot_json, run_at, run_by, non_converged, excluded).
- `budget_scenario_month` (run_id, month, entity, cost_category, stratum S1..S5, amount_local, amount_eur, amount_chf, headcount). Per-resource detail goes in a separate table readable only by HR/Finance Manager.

**Minimum-group-size rule:** k = 5. Any cell or filter result with headcount < 5 shows the headcount only, with amounts suppressed. It is enforced server-side, and also on differences between two allowed groups (complementary suppression) for grade × discipline grids.

---

## 11. Cleanup record (localhost only)

**Rows created**
- `cohort_definitions`: 3 rows named `ZZ_AUDIT_full_179` (×2: the first run aborted on a script error after the cohort was written) and `ZZ_AUDIT_full_53`.
- `simulation_results`: 307 rows, `cohort_id` in those 3.
- `simulation_results`: 20 rows with `candidate_label LIKE 'ZZ_AUDIT_xcheck_%'`.

Before the tests: `cohort_definitions` 4, `simulation_results` 86. After the tests: 7 / 413, and no row other than the `ZZ_AUDIT_` ones was added.

**Deletion**, in one transaction, rolled back if the counts differ:

```sql
DELETE FROM dbo.simulation_results
 WHERE cohort_id IN (SELECT id FROM dbo.cohort_definitions WHERE name LIKE 'ZZ[_]AUDIT[_]%');   -- 307
DELETE FROM dbo.simulation_results WHERE candidate_label LIKE 'ZZ[_]AUDIT[_]%';                -- 20
DELETE FROM dbo.cohort_definitions WHERE name LIKE 'ZZ[_]AUDIT[_]%';                            -- 3
```

After the deletion: `cohort_definitions` 4, `simulation_results` 86, back to the baseline.

**Left in place, owner's decision.** The audit triggers (`trg_audit_cohort_definitions`, `trg_audit_simulation_results`) wrote **663 `audit_trail` rows**:
- `cohort_definitions`: 3 I, 3 U, 3 D;
- `simulation_results`: 327 I, 327 D.

Their `old_value`/`new_value` JSON contains the per-employee figures of the test rows. They were not deleted, because removing audit-log rows is the owner's call. To remove them:
`DELETE FROM dbo.audit_trail WHERE table_name IN ('simulation_results','cohort_definitions') AND changed_at >= '2026-11-24T15:00:00';`
Check that window first.
