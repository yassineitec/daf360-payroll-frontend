# Cohort page — hardening and salary what-if: final report

Date: 2026-11-24 · Scope: `daf360-payroll-service` and `daf360-payroll-frontend`, localhost only.
Starting facts: `docs/COHORT_PAGE_AUDIT.md`. Decisions and the full API contract: `docs/COHORT_DECISIONS.md`.
Progress log: `docs/COHORT_PROGRESS.md`.

**Nothing was pushed, merged or deployed. Nothing ran against 192.168.1.233 or a non-localhost database.**
No individual salary, name or employee id appears in this report, the tests, the logs written by the
new code, or the chat: tests use synthetic employees, live checks print counts, statuses and
country-level aggregates only.

## Summary

| Item | Status | Evidence |
|---|---|---|
| A1 Country scoping | **DONE** | Egypt-scoped token → 403 on Tunisia for aggregate, `POST /cohort`, `GET /cohort/{id}`, what-if/employee (live §2); unit `PaysScopeBodyAdviceTest` (6) |
| A2 Role-based visibility, k = 5 | **DONE** | Live §3/§4: AGGREGATE group of 1 → `suppressed`, 0 amounts; 200 responses scanned, 0 leaks; `includeEmployees` → 403; `GET /cohort/{id}` → 403 |
| A3 Honest failures | **DONE** | HR unreachable → 503 (live); empty → 200 + `EMPTY`; counts returned; non-converged never summed |
| A4 Input validation | **DONE** | Live §5: missing paysId, "abc", unknown modifierType / salaryBase / field, `entite` set → 400 each; `/cohort/abc` → 400 |
| A5 Engine parity | **DONE** | Family status, working days from config, own benefits, configured gross; single employee = individual simulator to the cent (6 unit cases) |
| A6 FX | **DONE** | TN EUR rate 0.300 from `payroll_fx_rates` (was 1.000); missing / 1.0 rate → `null` + message (unit) |
| A7 UI of Stage A | **DONE** | Dropdowns from HR refs (grade 61, discipline 24, contract 6 incl. CIVP); `detail` shown; warning block; empty and "group too small" states (Playwright) |
| A8 Report-only findings | **DONE** (reported, nothing changed) | See §A8 |
| B1 What-if behaviour | **DONE** | 8 round-trip cases × 8 employees, totals = Σ rows exactly, annual = 12 × monthly |
| B2 API | **DONE** | `salaryBase`, `includeEmployees` on `/cohort/aggregate`; `POST /cohort/what-if/employee` |
| B3 UI | **DONE**, one deviation | Scope / Change cards, Net/Brut switch, per-employee table, one-employee strata card. Deviation: there is no reusable five-strata component in the individual simulator any more (its "Cascade S1→S5" was removed); the card renders the same strata in its own table. |

## Branches and commits

| Repo | Branch (worktree) | Commits |
|---|---|---|
| daf360-payroll-service | `feature/cohort-hardening` (`projects/daf360-payroll-service-cohort-wt`), from origin/main 6a40a64 | `51e3618` A1 · `5626bd9` A3/A4 (503, 400, unknown fields) · `65a0dd6` A6 · `ce81c4b` A2/A3/A5/B1/B2 · `cf65b3d` A4 (400 on non-numeric path value, found live) |
| daf360-payroll-frontend | `feature/cohort-reactivate` (`projects/daf360-payroll-frontend-cohort-wt`) | `90ab77c` progress log · `1da2ee3` A7/B3 · `44e8d40` card title · + this report and the decisions file |

Both branches have no upstream. "One commit per item" was followed where items live in separate
files (A1, A3/A4, A6, A7/B3). A2, A3's counts, A5 and B1/B2 all live in the same service class and
DTOs and landed together in `ce81c4b`; its message lists them item by item.

The working copies `daf360-payroll-service` (feature/cost-rates-f04 @ 6a40a64) and
`daf360-payroll-frontend` (feature/audit-actor-names @ 95e66f7) were never touched: `git status`
is clean on both, before and after.

## Test output

Backend — `mvn clean test` in the worktree (baseline before any change: 185 run, 0 failures):

```
[INFO] Tests run: 34, Failures: 0, Errors: 0, Skipped: 0 -- in ...simulation.service.CohortAggregateServiceTest
[INFO] Tests run: 3,  Failures: 0, Errors: 0, Skipped: 0 -- in ...simulation.service.CohortFxResolverTest
[INFO] Tests run: 6,  Failures: 0, Errors: 0, Skipped: 0 -- in ...security.PaysScopeBodyAdviceTest
[INFO] Tests run: 3,  Failures: 0, Errors: 0, Skipped: 0 -- in ...web.StrictJsonBodyAdviceTest
[INFO] Tests run: 231, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

`CohortAggregateServiceTest` runs the **real** engine with a synthetic Tunisia 2025 parameter set
(the brackets, abattement, family deductions, CNSS and CSS of `PayrollSimulatorServiceTunisiaConfigTest`)
and nine synthetic employees, two of them married with children, one with a payroll configuration
that selects only one of the two benefits.

Frontend — `ng build`: 0 errors. The remaining warnings (NG8102) are in `salary-advances.component.html`,
which predates this work; the cohort page has none.

## Acceptance, item by item

1. **Build and tests** — above.
2. **Isolation** (live, token scoped to Egypt):
   ```
   aggregate TN  -> 403 Accès refusé : ce pays est hors de votre périmètre.
   POST /cohort TN -> 403
   what-if/employee TN -> 403
   GET /cohort/{id} TN with EG token -> 403
   GET /cohort/{id} TN with individual token -> 200
   aggregate EG with EG token -> 200
   ```
3. **Roles** (live):
   ```
   AGG token, group >= 5: HTTP 200 headcount=18 suppressed=False visibility=AGGREGATE   amounts present: True | employees: None
   AGG token, group of 1: HTTP 200 headcount=1 suppressed=True  visibility=AGGREGATE   messages: ['SUPPRESSED']   non-null amounts: []
   AGG token includeEmployees=true -> 403
   AGG token GET /cohort/{id} -> 403
   RUN_SIMULATION-only token POST /cohort -> 403
   AGG token GET /simulations/{id} of a COHORT row -> 403      (IND token -> 200)
   AGG token /individual/history: COHORT rows returned = 0
   IND token, group of 1: headcount=1 suppressed=False visibility=INDIVIDUAL   amounts present: True | per-employee rows: 1
   ```
4. **No leak.** Every grade × contract type × base combination for Tunisia was run with the
   aggregate-only token: 200 responses, 80 of them groups of 1–4. Each was checked for a non-null
   `employees`, any `profileUserId`/`userId` field, any amount in a group below k, and any number
   equal to one of the 119 employees' own figures (net, taxable net, gross, S4, loaded cost, IRPP,
   charges, current and projected): **0 leaks**. Unit test `aggregate_noLeak_scan` does the same on
   the synthetic set. Logs: 317 lines of the worktree backend scanned, **0** decimal amounts outside
   SQL text and **0** `userId=` mentions. The only log line the cohort writes is the access line
   (DEC13). The old `Skipping employee userId=…` warning is gone; failures are counted instead.
5. **Honest failures** (live):
   ```
   HR unreachable (second instance, HR URL dead) -> HTTP 503 "Service RH indisponible"
   empty cohort -> 200 headcount=0 matched=0 messages: ['EMPTY'], amounts null
   missing paysId -> 400 / "abc" -> 400 / modifierType XYZ -> 400 / unknown field -> 400
   entite set -> 400 / salaryBase TAX -> 400 / GET /cohort/abc -> 400
   Egypt today -> 200 matched=70 excludedNoSalary=1 nonConverged=48 headcount=21, message NON_CONVERGED
   ```
   **Deviation from the expected outcome**, explained: the brief expected
   "Egypt → totals absent, `nonConverged = matched`". That was true under the old benefits rule
   (69/69 non-converged). With DEC5 applied, the employees' own benefit selection is used, and on
   localhost 69 of Egypt's 70 configurations select no benefit. 21 employees now converge and
   are summed. The 48 that still fail are counted, not summed, and flagged. The "nothing converges →
   no totals" path is proven by unit test `allNonConverged_noTotals`. Cause of the 48: see A8.
6. **What-if correctness** (unit, real engine): for PERCENT +5 / −10 and AMOUNT +250 / −300, on NET
   and on GROSS, every employee:
   - NET base: projected net = base × (1 + v) or base + v within 0.01; re-running gross → net on the
     projected gross gives that net back within 0.01.
   - GROSS base: projected gross = base × (1 + v) or base + v **exactly**; re-running net → gross on
     the projected net gives the net back within 0.01 and the gross within **0.05**, not 0.01 — the
     engine's net → gross solver stops at the parameter set's tolerance (0.01) **on the net**, so the
     gross it finds is only as precise as 0.01 ÷ the marginal net rate (observed ≤ 0.04). This is
     the engine's contract, not the what-if's.
   - Single employee = individual simulator **to the cent**: six cases (PERCENT/AMOUNT, NET/GROSS,
     married with 2 children, own benefit selection, family status unknown) compared field by field
     (net, gross, loaded cost, IRPP, both charges) with `IndividualSimulationService.compute` for
     the same inputs, current and projected: all `compareTo == 0`.
7. **Totals** (unit `totals_equal_sumOfRows`): current, projected and delta = Σ per-employee figures
   exactly; annual = 12 × monthly. Live: `annual == 12 x monthly: True`.
8. **Bounds** (live): −51 % → 400, +201 % → 400, −50 % → 200, +200 % → 200, AMOUNT −100000 → 400
   "rendrait au moins un salaire nul ou négatif".
9. **FX** (live, Tunisia): `currency=TND eurRate=0.3 (payroll_fx_rates) chfRate=0.27558 (payroll_fx_rates)`;
   EUR total ≠ TND total. Unit: a static 1.0 rate between TND and EUR / CHF → `null` + `FX_MISSING_*`.
10. **UI** — Playwright (chromium 1248) against the worktree frontend on :4215. Only the portal's
    `/api/me` is stubbed (test user + locally minted token); payroll calls are re-routed to the
    worktree backend on :8894, HR calls go to the real localhost HR service.
    ```
    [individual] scope radio (Groupe / Un employé) shown: true
    [individual] dropdown options: grade=62 discipline=25 contract=7 (CIVP present: true)   ← "Tous" + 61 / 24 / 6
    [individual] hint Net : +5,00 % du salaire net actuel de chaque employé ; le moteur recalcule le reste.
    [individual] hint Brut: +5,00 % du salaire brut actuel de chaque employé ; le moteur recalcule le reste.
    [individual] group run (Brut): KPI cards 4 | warnings block: true | per-employee table: true | table rows: 119
    [individual] Net/Brut switch changes the projected cost: true
    [individual] small group: KPIs shown: true | suppressed state: false
    [individual] one employee: strata rows 8
    [aggregate] scope radio shown: false
    [aggregate] small group → suppressed state: true | KPIs: false | per-employee table: false
    [aggregate] whole country → KPIs: true | per-employee table: false
    ```
    The one console error in each session is the dev server's EventSource against the stubbed
    portal — a harness artefact, not the page.
11. **Backward compatibility** (live, the exact 7-field body the old UI sent, `entite: null` included):
    status 200, all 13 old fields present, `modifierType` echoed `PCT`, `localCurrency` `TND`.
    Unit `oldFormat_keepsOldFields` checks the same on JSON.
12. **Cleanup** — see below.

## A8 findings (reported, nothing changed)

1. **Default internal API key.** On localhost both `daf360-payroll-backend-dev` and
   `daf360-rh-backend-dev` run without `INTERNAL_API_KEY`, so both use the repo default
   `daf360-internal-change-me` (payroll `application.yml:100,103`, rh `application.yml:108`,
   facturation `application.yml:90`). The only compose file in the repos that wires the variable,
   `daf360-shell/docker-compose.daf360.yml:114`, sets it for the timesheet backend only. Whether
   233 / production set it could not be checked (withheld) — **to verify there**: anyone who can
   reach the RH service and knows the default can read every employee's net salary.
2. **Soft-deleted profiles.** `GET /api/hr/internal/payroll-sync/employees` uses
   `findByPaysIdAndLifecycleStatusIn` on `EmployeeProfile`, which carries `@SQLRestriction("deleted = 0")`:
   soft-deleted profiles are excluded. Localhost: 0 soft-deleted profiles in an active status for TN or EG.
3. **Egypt — EGP-sized amounts in a USD payroll.** The audit attributed it to benefits; the cause
   that remains is in the **rubriques** of ACTIVE set 10: `MEAL_ALLOWANCE` 800 and
   `TRANSPORT_ALLOWANCE` 500 (CREDIT, FIXE_MENSUEL) and `MEDICAL_DEDUCTION` 200 (DEBIT), while
   `payroll_countries` gives Egypt the currency USD. With 1 100 USD of net already paid at a gross of
   0, any target net below that cannot be reached: 48 of 69 employees do not converge (all hit the
   50-iteration cap). Related: `FxEntryConversionService` comments say Egypt's amounts are "real EGP
   under the label USD" — the payroll currency of Egypt needs one decision (USD or EGP), then the
   set's amounts and `payroll_countries` must follow it.
4. **Tunisia 2026 drafts** (both `DRAFT`, approved by nobody, `previous_version_id` NULL):
   - **10008** (v2): abattement 0 and no cap, married / child deductions 0, IRPP brackets different
     from set 9, 17 charge lines (adds TFP 2 % and FOPROLOS 1 %, renames the work-accident line
     `AT_MP`), 7 rubriques. Activating it would remove the abattement and family deductions that the
     2025 set (and the HR worksheet) apply.
   - **20007** (v3): same IRPP, abattement and family values as set 9, but CNSS (CDI) has
     `cap_amount = 5000` — the spurious cap already found on 2026-11-11, which breaks every salary
     above 5 000 TND.
   Neither must be activated as is.
5. **Tunisia `payroll_countries.eur_rate = 1.000`** for TND (and `chf_rate = 1.055`): still stored,
   now **bypassed** by the cohort (synced 0.300 wins, and 1.0 is refused). Other screens that use
   `FxSnapshotService` directly (individual simulator snapshot, cohort `POST /cohort` rows) still
   read it — the stored value should be corrected by whoever owns the rates.

## Numbers that changed compared with the audit

Tunisia, whole country, no change applied (localhost, same data):

| | Audit (before) | Now (after A5/A6) |
|---|---|---|
| Employees in the totals | 119 (incl. 2 non-converged, summed) | 119 (0 non-converged) |
| Current monthly cost | 296 447.12 TND | 325 270.76 TND (+28 823.64, +9.7 %) |
| Same in EUR | 296 447.12 "EUR" (rate 1.000) | 97 581.23 EUR (rate 0.300) |
| Average net / gross | — | 1 737.14 / 2 348.51 TND |

Causes, in order of weight:
1. **DEC5 benefits.** All 121 Tunisian payroll configurations select no benefit, so the engine no
   longer adds the set's benefits for them. Paid benefits count towards the net, so without them the
   gross needed to reach the same HR net is higher, and so is the employer cost.
2. **DEC6 configured gross.** 104 of the 119 now take their current gross from their payroll
   configuration, where it reproduces the HR net within 0.05.
3. **DEC8 family status.** It lowers IRPP for married employees and employees with children, so it
   moves the cost **down**. The audit measured about −0.3 % on a sample.

The 2 employees that did not converge before now converge (benefit selection), so nothing is excluded.
The split between causes 1 and 2 was not isolated (it would need toggles in the code); the direction
of each is certain.

Egypt: 69/69 non-converged and silently summed (264 902.47 USD) → 48 non-converged, excluded; 21
summed; see A8 §3.

## Cleanup

Rows created by these tests in `DAF360_PAYROLL` (localhost): one cohort `ZZ_HARDEN_tn` (id 10007) and
its one `simulation_results` row (the read-back test of `GET /cohort/{id}`). Aggregates and what-ifs
persist nothing.

```sql
BEGIN TRAN;
DELETE FROM simulation_results WHERE cohort_id = 10007;                       -- (1 row affected)
DELETE FROM cohort_definitions WHERE id = 10007 AND name = 'ZZ_HARDEN_tn';    -- (1 row affected)
COMMIT;
```

| Table | Before tests | After cleanup |
|---|---|---|
| cohort_definitions | 4 | 4 |
| simulation_results | 86 | 86 |
| audit_trail | 3 437 | 3 442 |

The 5 new `audit_trail` rows were written by the existing triggers (insert, status update, deletes).
Like the 663 rows of the audit, they are **left for you to decide**; nothing in `audit_trail` was deleted.

Processes left running on localhost for you to stop or reuse: worktree backend on **:8894** and the
worktree frontend dev server on **:4215**. The Docker containers were not modified or restarted.

## Remaining gaps

- **Differencing.** k = 5 stops a single query from showing a small group, but not two overlapping
  queries: "grade X" minus "grade X without contract CDD" can isolate one person if both groups have
  at least 5 people. Closing it needs query auditing or noise. Not in this release.
- **AMOUNT probing.** An aggregate-only caller can learn that *some* employee's net or gross is below
  an amount by finding the AMOUNT value that triggers the 400. That reveals no identity or exact
  figure, but it is a signal.
- **Access log is in the service log only** (DEC13); a table is proposed in the decisions file.
- **Other screens still read the static FX** (A8 §5) and the individual simulator still defaults
  working days to 22 by its own literal (same value as the cohort setting).
- **Five-strata component**: the one-employee card has its own table, because the simulator no
  longer has a reusable strata component.
- **Radio buttons** of the shared library react to a click on the circle, not on the label text.
  This is library behaviour, the same on the simulator page; noted for the design-system owners.
- Egypt and the Tunisian drafts need the data decisions in A8 before their numbers can be trusted.
