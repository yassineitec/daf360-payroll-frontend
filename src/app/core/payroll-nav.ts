/**
 * Single source of truth for the payroll module's navigation and its permission gating.
 *
 * Two consumers, and they MUST agree:
 *  - `layout/payroll-shell.component.ts` — what the sidebar shows;
 *  - `app.routes.ts`                     — what `permissionGuard` lets through.
 * A nav entry visible to a user the guard then bounces to `/forbidden` is the exact
 * mismatch this file exists to prevent, so change the codes here and nowhere else.
 */

export interface PayrollNavDef {
  id:    string;
  label: string;
  icon:  string;
  /** Child segment of `/payroll`, matching the route `path` in `app.routes.ts`. */
  route: string;
  /** Any-of. Empty ⇒ no permission required. Mirrors the guard's default `mode: 'any'`. */
  permissions: string[];
}

/** `/payroll/simulator` — running a simulation. Reference reads (pays, active parameter
 *  set, grades) all accept `PAYROLL_RUN_SIMULATION` on the backend, so one code covers
 *  the whole page. */
export const PAYROLL_SIMULATOR_PERMISSIONS = ['PAYROLL_RUN_SIMULATION'];

/**
 * `/payroll/admin` — creating a parameter set.
 *
 * It used to be gated on `PAYROLL_SUPER_ADMIN` alone, but the only call the panel makes,
 * `POST /parameter-sets`, is annotated `hasAuthority('PAYROLL_APPROVE_PARAMSET')` — so a
 * super-admin without that code saw the page and collected a 403 on submit, and an
 * approver who could actually use it never saw the entry. Both codes now open it, and the
 * backend stays the authority on the write itself.
 */
export const PAYROLL_ADMIN_PERMISSIONS = [
  'PAYROLL_APPROVE_PARAMSET',
  'PAYROLL_SUPER_ADMIN',
];

/**
 * The live payroll screens.
 *
 * ⚠️ Only the simulator and the administration panel are enabled. The other six modules
 * (cohort, engine-run, engine-results, calibration, parameter-sets, budget) are built but
 * intentionally switched off for now — their nav entries are commented out below AND their
 * routes are commented out in `app.routes.ts`. Re-enable a screen by uncommenting BOTH,
 * never just one: an entry with no route navigates into the `**` redirect, and a route with
 * no entry is only reachable by typing the URL.
 */
export const PAYROLL_NAV_DEFS: PayrollNavDef[] = [
  {
    id:          'simulator',
    label:       'Simulateur manuel',
    icon:        'calculate',
    route:       'simulator',
    permissions: PAYROLL_SIMULATOR_PERMISSIONS,
  },
  {
    id:          'admin',
    label:       'Administration',
    icon:        'admin_panel_settings',
    route:       'admin',
    permissions: PAYROLL_ADMIN_PERMISSIONS,
  },

  // ── Disabled for now — keep in sync with app.routes.ts ──────────────────────
  // { id: 'cohort',         label: 'Simulation cohorte', icon: 'groups',                route: 'cohort',         permissions: ['PAYROLL_RUN_SIMULATION'] },
  // { id: 'engine-run',     label: 'Calcul de paie',     icon: 'payments',              route: 'engine-run',     permissions: ['PAYROLL_RUN_ENGINE'] },
  // { id: 'engine-results', label: 'Historique de paie', icon: 'history',               route: 'engine-results', permissions: ['PAYROLL_VIEW_RESULTS'] },
  // { id: 'calibration',    label: 'Calibration',        icon: 'tune',                  route: 'calibration',    permissions: ['PAYROLL_RUN_CALIBRATION'] },
  // { id: 'parameter-sets', label: 'Paramètres',         icon: 'settings_applications', route: 'parameter-sets', permissions: ['PAYROLL_VIEW_PARAMSET'] },
  // { id: 'budget',         label: 'Budget prévisionnel', icon: 'account_balance',      route: 'budget',         permissions: ['PAYROLL_VIEW_BUDGET_AGGREGATE'] },
];

/**
 * The current URL reduced to the nav segment it belongs to.
 *
 * `daf-side-nav` lights an item on **strict equality** (`activeRoute === item.route`),
 * but the nav routes are relative segments (`simulator`) while `router.url` is absolute
 * (`/payroll/simulator`) — so passing the raw URL, as this shell did, meant no entry was
 * ever highlighted. Same fix as `fact-shell` and `hr-shell`.
 *
 * Longest route first, so a future nested segment wins over its parent prefix.
 */
export function activeNavRoute(url: string, defs: PayrollNavDef[] = PAYROLL_NAV_DEFS): string {
  const path = (url ?? '').split(/[?#]/)[0];
  const match = [...defs]
    .sort((a, b) => b.route.length - a.route.length)
    .find(def => new RegExp(`(^|/)${def.route}(/|$)`).test(path));
  return match ? match.route : '';
}
