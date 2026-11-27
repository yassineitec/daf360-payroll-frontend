# Cohort page: reactivated, hardened, salary what-if and coverage warning

**Draft. Pairs with the backend PR `daf360-payroll-service` · `feature/cohort-hardening`; deploy them together.**

## Summary

- **Reactivates the "Simulation cohorte" page.** Commit 58f3aaf had parked it ("temporarily"). The route points back to `CohortComponent`.
- **Rewrites the page on the hardened backend contract:**
  - choose a **group** (grade, discipline and contract type, from the RH reference lists, CIVP included) or **one employee**;
  - choose a **PERCENT or AMOUNT change** applied to the **net or gross salary**, with a live hint.
- **Results:**
  - a warning block, fed by the server's message codes in FR and EN;
  - empty, suppressed (group below 5) and no-total states;
  - KPIs, before→after averages, EUR/CHF;
  - a per-employee table, for `PAYROLL_VIEW_INDIVIDUAL` only and on screen only, with no export;
  - a five-strata card for a single employee.
- **New:**
  - "X sur Y employés inclus" is always shown next to the KPI cards;
  - when the share of the group in the totals is below 90 % (`LOW_COVERAGE`), a prominent banner appears and the figures are dimmed until the user ticks "J'ai compris, afficher quand même" (client-side; the totals do not change; every new run resets it);
  - warning for employees whose configuration selects no benefit (`BENEFITS_NONE_SELECTED`).
- **Documentation:** `docs/COHORT_DECISIONS.md` (decisions and API contract), `COHORT_HARDENING_REPORT.md`, `COHORT_PREMERGE_REPORT.md`, `COHORT_PAGE_AUDIT.md`, `COHORT_PROGRESS.md`.

## API and permission changes

None in this repo; it consumes the backend changes (see the backend PR for the table). What it relies on:

| Backend endpoint | Used for | Permission |
|---|---|---|
| `POST /api/payroll/simulations/cohort/aggregate` | group mode (`includeEmployees` only for the individual view) | `RUN_SIMULATION` (route guard), `VIEW_AGGREGATE` / `VIEW_INDIVIDUAL` for content |
| `POST /api/payroll/simulations/cohort/what-if/employee` (new) | one-employee mode, offered only with `VIEW_INDIVIDUAL` | `VIEW_INDIVIDUAL` |

## Behaviour changes users will notice

- The page is back in the Simulation menu.
- **Aggregate-only roles**:
  - see totals only;
  - see a "group too small" state with no amount below 5 employees;
  - cannot pick "Un employé".
- **Individual-view roles** see the per-employee table and the one-employee mode.
- **An error message when the RH service is down**, instead of a cost of 0.
- **The Tunisia monthly cost is higher than before** (≈ 325k vs 296k TND), and the EUR figure uses the synced rate (0.300, not 1.000). The causes are in the backend PR.
- **Egypt** shows "21 sur 70 employés inclus", a warning banner and dimmed figures until acknowledged. The cause is the Egypt parameter set, which is reported and not changed.
- The `entite` filter has been removed (the backend never applied it).

## Test evidence

- `npm ci` + `ng build` on a clean clone: bundle generated, exit 0. The NG8102 warnings come only from other modules.
- Playwright on localhost:
  - every payroll page loads with a scoped user and with a multi-country user (home TN, home EG), with 0 API 4xx/5xx;
  - the simulator "compute" action gives 201 in all three sessions.
- Cohort page checks:
  - group and one-employee runs;
  - the Net/Gross switch changes the projected cost;
  - a small group is suppressed for an aggregate role;
  - Egypt banner, dimmed figures, acknowledgement un-dims them, a new run dims them again;
  - Tunisia has no banner;
  - FR/EN keys at parity.
- The details are in `docs/COHORT_PREMERGE_REPORT.md` and `docs/COHORT_HARDENING_REPORT.md`.

## Schema and data

No schema change, no data change.

## Deployment notes

- Nothing to migrate.
- Deploy with the backend PR.
- On the backend side, set a non-default `INTERNAL_API_KEY` everywhere (see the backend PR).

## Explicitly not done

- Export of the per-employee table (DEC11: on screen only).
- A reusable five-strata component shared with the individual simulator: the card has its own table.
- Calibration and budget pages: still placeholders ("Module en cours de développement"), not touched.
- Static FX on other screens.

## Manual test list (test platform)

1. **A scoped user** (one country): open Simulation cohorte, choose the country, run a +5 % on the net for the whole country. Check that:
   - the KPIs appear;
   - "X sur Y employés inclus" is shown;
   - the warnings are readable.
2. **A multi-country user**: run it for each of their countries; both work.
3. **An aggregate-only role** (`PAYROLL_VIEW_AGGREGATE` without `PAYROLL_VIEW_INDIVIDUAL`):
   - with a grade of fewer than 5 people, check the "Groupe trop petit" state, with no amount and no per-employee table;
   - check that "Un employé" is not offered.
4. **An individual-view role**: run a group (per-employee table visible), then "Un employé" (five-strata card).
5. **Egypt, whole country**:
   - the banner is visible and the figures are dimmed;
   - tick "J'ai compris, afficher quand même" and the figures become readable with the same values;
   - run again and they are dimmed again.
6. **The candidate simulation from the HR page** still gives the same figures (backend PR, item 3).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
