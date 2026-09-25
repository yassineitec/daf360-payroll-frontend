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
  /** i18n key under PAYROLL.layout.NAV.*, resolved in the shell — never a literal label. */
  labelKey: string;
  icon:  string;
  /**
   * Child segment of `/payroll`, matching the route `path` in `app.routes.ts`. Omitted on an
   * entry with `children`: a parent group doesn't navigate, it only expands — same contract
   * as the library's `NavItem`.
   */
  route?: string;
  /** Any-of. Empty ⇒ no permission required. Mirrors the guard's default `mode: 'any'`. */
  permissions: string[];
  /** Sub-entries rendered as an expandable group. One level only, like `NavItem.children`. */
  children?: PayrollNavDef[];
}

/** `/payroll/simulator` — running a simulation. Reference reads (pays, active parameter
 *  set, grades) all accept `PAYROLL_RUN_SIMULATION` on the backend, so one code covers
 *  the whole page. */
export const PAYROLL_SIMULATOR_PERMISSIONS = ['PAYROLL_RUN_SIMULATION'];

/**
 * Creating a parameter set — the "+ Nouveau jeu de paramètres" panel folded into
 * `/payroll/parameter-sets` (was its own `/payroll/admin` page until the two were merged:
 * creating and then managing/approving a parameter set were split across two menu entries
 * for what is really one workflow on one entity).
 *
 * It used to be gated on `PAYROLL_SUPER_ADMIN` alone, but the only call the panel makes,
 * `POST /parameter-sets`, is annotated `hasAuthority('PAYROLL_APPROVE_PARAMSET')` — so a
 * super-admin without that code saw the page and collected a 403 on submit, and an
 * approver who could actually use it never saw the entry. Both codes now open it, and the
 * backend stays the authority on the write itself.
 */
export const PAYROLL_CREATE_PARAMSET_PERMISSIONS = [
  'PAYROLL_APPROVE_PARAMSET',
  'PAYROLL_SUPER_ADMIN',
];

/**
 * `/payroll/payslips` — the monthly payslip batch (split the external payroll PDF, file it
 * to SharePoint). An RH-owned permission code, not a `PAYROLL_*` one: the whole feature runs
 * on daf360-rh-service (employee matching + SharePoint), this screen only triggers it. Was
 * first built in the Finance app, moved here 2026-09-15 at the user's request. Same code
 * already granted (in the RH database) to Administrateur, DRH, RH, PDG and DAF — no new
 * grant was needed for this move: every role currently holding a `PAYROLL_ADMIN_PERMISSIONS`
 * code (Administrateur, PDG) already has it too.
 */
export const PAYROLL_PAYSLIPS_PERMISSIONS = ['RH_MANAGE_PAYSLIPS'];

/** `/payroll/employee-config` — assigning a payroll configuration (country, contract type,
 *  benefits, current net salary) to a specific employee. Viewing needs either code;
 *  the backend's own PUT enforces MANAGE specifically. */
export const PAYROLL_EMPLOYEE_CONFIG_PERMISSIONS = [
  'PAYROLL_VIEW_EMPLOYEE_CONFIG',
  'PAYROLL_MANAGE_EMPLOYEE_CONFIG',
];

/**
 * `/payroll/budget` — the budget lines + forecast outputs. Mirrors the backend exactly:
 * both calls the page makes (`GET /calibration/budget-lines`, `/calibration/forecast-outputs`)
 * accept any of these four codes. It used to be gated on `PAYROLL_VIEW_BUDGET_AGGREGATE`
 * alone — a code rh-service's catalog doesn't list, so role administration can't grant it —
 * which hid the page from admins the backend would have served. Granting that code instead
 * would also cost cookie bytes on roles already at the 4096 B ceiling.
 */
export const PAYROLL_BUDGET_PERMISSIONS = [
  'PAYROLL_VIEW_BUDGET_AGGREGATE',
  'PAYROLL_VIEW_AGGREGATE',
  'PAYROLL_EXPORT_BUDGET',
  'PAYROLL_RUN_CALIBRATION',
];

/**
 * The live payroll screens.
 *
 * Nine modules are enabled — `admin` was folded into `parameter-sets` (see
 * `PAYROLL_CREATE_PARAMSET_PERMISSIONS`), so it no longer has its own entry or route.
 * Every entry here MUST have a matching route in `app.routes.ts` and vice-versa: an entry
 * with no route navigates into the `**` redirect, and a route with no entry is only
 * reachable by typing the URL. If a screen ever has to be switched off again, comment it
 * out in BOTH files, never just one. (A `children` group itself has no route of its own —
 * only its leaves count as modules here.)
 */
export const PAYROLL_NAV_DEFS: PayrollNavDef[] = [
  {
    id:          'simulator',
    labelKey:    'PAYROLL.layout.NAV.SIMULATOR',
    icon:        'calculate',
    route:       'simulator',
    permissions: PAYROLL_SIMULATOR_PERMISSIONS,
  },
  {
    id:          'payslips',
    labelKey:    'PAYROLL.layout.NAV.PAYSLIPS',
    icon:        'receipt_long',
    route:       'payslips',
    permissions: PAYROLL_PAYSLIPS_PERMISSIONS,
  },
  {
    id:          'employee-config',
    labelKey:    'PAYROLL.layout.NAV.EMPLOYEE_CONFIG',
    icon:        'manage_accounts',
    route:       'employee-config',
    permissions: PAYROLL_EMPLOYEE_CONFIG_PERMISSIONS,
  },

  // ── Keep in sync with app.routes.ts ─────────────────────────────────────────
  {
    id:          'cohort',
    labelKey:    'PAYROLL.layout.NAV.COHORT',
    icon:        'groups',
    route:       'cohort',
    permissions: ['PAYROLL_RUN_SIMULATION'],
  },
  {
    id:          'engine-run',
    labelKey:    'PAYROLL.layout.NAV.ENGINE_RUN',
    icon:        'payments',
    route:       'engine-run',
    permissions: ['PAYROLL_RUN_ENGINE'],
  },
  /**
   * Expandable group — was a single `engine-results` entry with 2 internal tabs
   * (employee results / candidate simulations), split 2026-09-23 into 2 real pages so
   * each is directly linkable and no longer hides half its content behind a tab click.
   */
  {
    id:          'payroll-history',
    labelKey:    'PAYROLL.layout.NAV.PAYROLL_HISTORY_GROUP',
    icon:        'history',
    permissions: [],
    children: [
      {
        id:          'engine-results',
        labelKey:    'PAYROLL.layout.NAV.ENGINE_RESULTS',
        icon:        'payments',
        route:       'engine-results',
        permissions: ['PAYROLL_VIEW_RESULTS'],
      },
      {
        id:          'candidate-simulation',
        labelKey:    'PAYROLL.layout.NAV.CANDIDATE_SIMULATION',
        icon:        'groups',
        route:       'candidate-simulation',
        permissions: ['PAYROLL_VIEW_RESULTS'],
      },
    ],
  },
  {
    id:          'calibration',
    labelKey:    'PAYROLL.layout.NAV.CALIBRATION',
    icon:        'tune',
    route:       'calibration',
    permissions: ['PAYROLL_RUN_CALIBRATION'],
  },
  {
    id:          'parameter-sets',
    labelKey:    'PAYROLL.layout.NAV.PARAMETER_SETS',
    icon:        'settings_applications',
    route:       'parameter-sets',
    permissions: ['PAYROLL_VIEW_PARAMSET'],
  },
  {
    id:          'budget',
    labelKey:    'PAYROLL.layout.NAV.BUDGET',
    icon:        'account_balance',
    route:       'budget',
    permissions: PAYROLL_BUDGET_PERMISSIONS,
  },
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
 *
 * `defs` can carry one level of `children` (see `PayrollNavDef`) — flattened first, since a
 * group entry itself has no `route` to match against.
 */
export function activeNavRoute(url: string, defs: PayrollNavDef[] = PAYROLL_NAV_DEFS): string {
  const path = (url ?? '').split(/[?#]/)[0];
  const routable = defs.flatMap(def => def.children ?? [def]).filter(def => !!def.route);
  const match = [...routable]
    .sort((a, b) => b.route!.length - a.route!.length)
    .find(def => new RegExp(`(^|/)${def.route}(/|$)`).test(path));
  return match ? match.route! : '';
}
