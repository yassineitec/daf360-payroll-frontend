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
  /**
   * Kept out of the sidebar, but still a module: the payroll home card and the landing
   * guard keep offering it. Set when the screen is reached from somewhere else — its
   * sidebar entry would only duplicate that way in.
   */
  hiddenInSidebar?: boolean;
  /** Sidebar entry lit while this screen is open, for a `hiddenInSidebar` one — the entry
   *  it is reached from. Omitted ⇒ its own `route`. */
  highlightRoute?: string;
}

/** `/payroll/simulator` — running a simulation. Reference reads (pays, active parameter
 *  set, grades) all accept `PAYROLL_RUN_SIMULATION` on the backend, so one code covers
 *  the whole page. */
export const PAYROLL_SIMULATOR_PERMISSIONS = ['PAYROLL_RUN_SIMULATION'];

/**
 * Creating a parameter set — the « Nouveau paramétrage » section of the administration home
 * (`/payroll/admin`, formerly `/payroll/parameter-sets`). It was once a separate admin page,
 * merged in because creating and then managing/approving a parameter set is one workflow
 * on one entity.
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
 * `/payroll/salary-advances` — payroll owns the salary advances (V25): the payout of what
 * finance approved, the monthly deductions, the follow-up and the per-country rules. Finance
 * only approves or declines (its cost approval queue); the employee asks from self-service.
 */
export const PAYROLL_SALARY_ADVANCES_PERMISSIONS = ['PAYROLL_MANAGE_SALARY_ADVANCES'];

/** Carte « Pays de paie » de l'administration — mêmes codes que `GET /admin/countries`. */
export const PAYROLL_COUNTRIES_PERMISSIONS = [
  'PAYROLL_VIEW_PARAMSET',
  'PAYROLL_MANAGE_COUNTRIES',
  'PAYROLL_SUPER_ADMIN',
];

/** Carte « Rubriques du moteur » — mêmes codes que `GET /engine/rubriques`. */
export const PAYROLL_ENGINE_RUBRIQUES_PERMISSIONS = ['PAYROLL_MANAGE_RUBRIQUES', 'PAYROLL_VIEW_PARAMSET'];

/** Carte « Catalogue des avantages » — mêmes codes que `GET /parameter-sets`, qui les porte. */
export const PAYROLL_BENEFITS_PERMISSIONS = ['PAYROLL_VIEW_PARAMSET', 'PAYROLL_APPROVE_PARAMSET'];

/** Modifier les avantages d'un jeu en brouillon — mêmes codes que `PUT …/benefits` (et que
 *  les charges et rubriques d'un jeu). */
export const PAYROLL_EDIT_PARAMSET_PERMISSIONS = ['PAYROLL_APPROVE_PARAMSET', 'PAYROLL_APPROVE_PARAMSET_FAST_TRACK'];

/** Carte « Paramètres du moteur » — mêmes codes que `GET /engine/param-sets`. */
export const PAYROLL_ENGINE_PARAMS_PERMISSIONS = ['PAYROLL_VIEW_PARAMSET'];

/** Circuit des paramètres du moteur — mêmes codes que le serveur, étape par étape :
 *  créer / modifier un brouillon, soumettre et approuver (RH) ; approuver (Finance) et activer. */
export const PAYROLL_ENGINE_EDIT_PERMISSIONS    = ['PAYROLL_APPROVE_PARAMSET', 'PAYROLL_SUPER_ADMIN'];
export const PAYROLL_ENGINE_SUBMIT_PERMISSIONS  = ['PAYROLL_APPROVE_PARAMSET'];
export const PAYROLL_ENGINE_FINANCE_PERMISSIONS = ['PAYROLL_APPROVE_PARAMSET_FAST_TRACK'];

/** Créer / modifier une rubrique du moteur — mêmes codes que `POST`/`PUT /admin/engine/rubriques`. */
export const PAYROLL_MANAGE_RUBRIQUES_PERMISSIONS = ['PAYROLL_MANAGE_RUBRIQUES', 'PAYROLL_SUPER_ADMIN'];

/** Créer / modifier un pays de paie — mêmes codes que `POST`/`PUT /admin/countries`. */
export const PAYROLL_MANAGE_COUNTRIES_PERMISSIONS = ['PAYROLL_MANAGE_COUNTRIES', 'PAYROLL_SUPER_ADMIN'];

/** Carte « Journal des modifications » — mêmes codes que `GET /admin/audit` (le serveur ne
 *  renvoie ensuite que les historiques que chacun de ces codes permet de lire). */
export const PAYROLL_AUDIT_PERMISSIONS = [
  'PAYROLL_VIEW_EMPLOYEE_CONFIG',
  'PAYROLL_MANAGE_EMPLOYEE_CONFIG',
  'PAYROLL_MANAGE_SALARY_ADVANCES',
  'PAYROLL_SUPER_ADMIN',
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
 * `admin` is the administration home (the former `parameter-sets` page, whose old URL now
 * redirects to it); `employee-config` is a module without a sidebar entry (`hiddenInSidebar`).
 * Every entry here MUST have a matching route in `app.routes.ts` and vice-versa: an entry
 * with no route navigates into the `**` redirect, and a route with no entry is only
 * reachable by typing the URL. If a screen ever has to be switched off again, comment it
 * out in BOTH files, never just one. (A `children` group itself has no route of its own —
 * only its leaves count as modules here.)
 */
export const PAYROLL_NAV_DEFS: PayrollNavDef[] = [
  /**
   * Accueil — first entry, like `accueil` in hr-shell and `home` in finance. No permission:
   * it only lists the other entries the user can open. Being first, it is also where
   * `payrollLandingGuard` sends `/payroll`.
   */
  {
    id:          'accueil',
    labelKey:    'PAYROLL.layout.NAV.HOME',
    icon:        'home',
    route:       'accueil',
    permissions: [],
  },
  // ── Ordre du parcours métier : simuler → paie du mois (avances → calcul → résultats →
  //    fiches) → piloter → paramétrer (en dernier, comme Administration / Admin).
  //    Groups first and last for the occasional screens, the monthly ones one click away
  //    in the middle. Keep the leaves in sync with app.routes.ts ──────────────────────
  /**
   * Expandable group — every simulation: one employee (manual), a group (cohort), and the
   * saved candidate simulations. The last one lived under a "Historique" group next to the
   * payroll results until 2026-09-28; it is simulated pay, not real payroll, so it sits here.
   */
  {
    id:          'simulation',
    labelKey:    'PAYROLL.layout.NAV.SIMULATION_GROUP',
    icon:        'science',
    permissions: [],
    children: [
      {
        id:          'simulator',
        labelKey:    'PAYROLL.layout.NAV.SIMULATOR',
        icon:        'calculate',
        route:       'simulator',
        permissions: PAYROLL_SIMULATOR_PERMISSIONS,
      },
      {
        id:          'cohort',
        labelKey:    'PAYROLL.layout.NAV.COHORT',
        icon:        'groups',
        route:       'cohort',
        permissions: ['PAYROLL_RUN_SIMULATION'],
      },
      {
        id:          'candidate-simulation',
        labelKey:    'PAYROLL.layout.NAV.CANDIDATE_SIMULATION',
        icon:        'person_search',
        route:       'candidate-simulation',
        permissions: ['PAYROLL_VIEW_RESULTS'],
      },
    ],
  },
  // Monthly payroll, in the order the month is worked: the advance deductions are settled
  // before the run, the results checked after it, the payslips published last.
  {
    id:          'salary-advances',
    labelKey:    'PAYROLL.layout.NAV.SALARY_ADVANCES',
    icon:        'account_balance_wallet',
    route:       'salary-advances',
    permissions: PAYROLL_SALARY_ADVANCES_PERMISSIONS,
  },
  {
    id:          'engine-run',
    labelKey:    'PAYROLL.layout.NAV.ENGINE_RUN',
    icon:        'payments',
    route:       'engine-run',
    permissions: ['PAYROLL_RUN_ENGINE'],
  },
  {
    id:          'engine-results',
    labelKey:    'PAYROLL.layout.NAV.ENGINE_RESULTS',
    icon:        'history',
    route:       'engine-results',
    permissions: ['PAYROLL_VIEW_RESULTS'],
  },
  {
    id:          'payslips',
    labelKey:    'PAYROLL.layout.NAV.PAYSLIPS',
    icon:        'receipt_long',
    route:       'payslips',
    permissions: PAYROLL_PAYSLIPS_PERMISSIONS,
  },
  {
    id:          'budget',
    labelKey:    'PAYROLL.layout.NAV.BUDGET',
    icon:        'account_balance',
    route:       'budget',
    permissions: PAYROLL_BUDGET_PERMISSIONS,
  },
  {
    id:          'calibration',
    labelKey:    'PAYROLL.layout.NAV.CALIBRATION',
    icon:        'tune',
    route:       'calibration',
    permissions: ['PAYROLL_RUN_CALIBRATION'],
  },
  /**
   * The per-employee payroll configuration — no sidebar entry: it opens from its card on
   * the administration home. Still a module, so the payroll home card and the landing guard
   * keep offering it (a holder of these codes alone cannot open the administration).
   */
  {
    id:          'employee-config',
    labelKey:    'PAYROLL.layout.NAV.EMPLOYEE_CONFIG',
    icon:        'manage_accounts',
    route:       'employee-config',
    permissions: PAYROLL_EMPLOYEE_CONFIG_PERMISSIONS,
    hiddenInSidebar: true,
    highlightRoute:  'admin',
  },
  /**
   * Administration — one entry, like Administration / Admin in RH and Finance, kept last. It
   * opens /payroll/admin, whose home is the card grid of every set-up section (parameter
   * sets, countries, line items, benefits, advance rules, log…).
   */
  {
    id:          'admin',
    labelKey:    'PAYROLL.layout.NAV.SETTINGS_GROUP',
    icon:        'admin_panel_settings',
    route:       'admin',
    permissions: ['PAYROLL_VIEW_PARAMSET'],
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
  return match ? (match.highlightRoute ?? match.route!) : '';
}
