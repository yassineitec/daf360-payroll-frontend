import {
  PAYROLL_AUDIT_PERMISSIONS, PAYROLL_COUNTRIES_PERMISSIONS, PAYROLL_CREATE_PARAMSET_PERMISSIONS,
  PAYROLL_ENGINE_PARAMS_PERMISSIONS, PAYROLL_ENGINE_RUBRIQUES_PERMISSIONS, PAYROLL_HELP_FAQ_PERMISSIONS,
  PAYROLL_SALARY_ADVANCES_PERMISSIONS,
} from '../../core/payroll-nav';

/**
 * A payroll page that has a guide, as listed by « Aide & guides » (/payroll/aide).
 * `guideKey` is the `storageKey` of the page's `app-page-guide`; `route` is its path under
 * the payroll shell (`/payroll/<route>`). Its FAQ, documentation and videos are in
 * `help-content.ts`, under the same key.
 */
export interface GuidePageDef {
  guideKey: string;
  labelKey: string;
  icon: string;
  route: string;
  /** Any-of gate; empty = every user. Same codes as the route's `data.permissions`. */
  permissions: string[];
  /**
   * Help-page tab the guide is listed under, for a sub-page (an invoice under « Factures »).
   * Omitted = the guide has its own tab, keyed by `guideKey`.
   */
  helpTab?: string;
  /** For a page whose URL carries an id (`invoicing/42`): the pattern of its path. */
  pattern?: RegExp;
  /** Query parameters the URL must carry (a section opened by `?tab=`). */
  query?: Record<string, string>;
  /**
   * Theme the sub-page is filed under in the help page's « Section » dropdown
   * (`GUIDE.GROUPS.<group>`), for a tab with many sub-pages — as in /rh/aide.
   */
  group?: string;
}

/** A new page with a guide adds one line here. Sub-pages first: they are matched first. */
export const GUIDE_PAGES: GuidePageDef[] = [
  // Simulation — sous-pages d'abord : le formulaire, la fiche résultat, la fiche candidat.
  { guideKey: 'simulator-new', labelKey: 'GUIDE.SIMULATOR_NEW.PAGE', icon: 'add_circle', route: 'simulator/new',
    permissions: ['PAYROLL_RUN_SIMULATION'], helpTab: 'simulator' },
  { guideKey: 'simulation-detail', labelKey: 'GUIDE.SIMULATION_DETAIL.PAGE', icon: 'receipt_long', route: 'simulator',
    pattern: /(^|\/)simulator\/\d+\/?$/, permissions: ['PAYROLL_RUN_SIMULATION'], helpTab: 'simulator' },
  { guideKey: 'candidate-detail', labelKey: 'GUIDE.CANDIDATE_DETAIL.PAGE', icon: 'person', route: 'candidate-simulation',
    pattern: /(^|\/)candidate-simulation\/[^/]+\/?$/, permissions: ['PAYROLL_VIEW_RESULTS'], helpTab: 'candidate-simulation' },
  { guideKey: 'engine-results-detail', labelKey: 'GUIDE.ENGINE_RESULTS_DETAIL.PAGE', icon: 'badge', route: 'engine-results',
    pattern: /(^|\/)engine-results\/[^/]+\/?$/, permissions: ['PAYROLL_VIEW_RESULTS'], helpTab: 'engine-results' },
  // Fiches de paie — l'import (`new`) avant le rapport d'un lot (`:id`), qui l'attraperait.
  { guideKey: 'payslip-new', labelKey: 'GUIDE.PAYSLIP_NEW.PAGE', icon: 'cloud_upload', route: 'payslips/new',
    permissions: ['RH_MANAGE_PAYSLIPS'], helpTab: 'payslips' },
  { guideKey: 'payslip-report', labelKey: 'GUIDE.PAYSLIP_REPORT.PAGE', icon: 'summarize', route: 'payslips',
    pattern: /(^|\/)payslips\/[^/]+\/?$/, permissions: ['RH_MANAGE_PAYSLIPS'], helpTab: 'payslips' },
  { guideKey: 'employee-config-detail', labelKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.PAGE', icon: 'manage_accounts', route: 'employee-config',
    pattern: /(^|\/)employee-config\/[^/]+\/?$/, permissions: ['PAYROLL_VIEW_EMPLOYEE_CONFIG', 'PAYROLL_MANAGE_EMPLOYEE_CONFIG'],
    helpTab: 'employee-config' },

  { guideKey: 'home', labelKey: 'PAYROLL.layout.NAV.HOME', icon: 'home', route: 'accueil', permissions: [] },
  { guideKey: 'simulator', labelKey: 'PAYROLL.layout.NAV.SIMULATOR', icon: 'calculate', route: 'simulator',
    permissions: ['PAYROLL_RUN_SIMULATION'] },
  { guideKey: 'candidate-simulation', labelKey: 'PAYROLL.layout.NAV.CANDIDATE_SIMULATION', icon: 'person_search',
    route: 'candidate-simulation', permissions: ['PAYROLL_VIEW_RESULTS'] },
  { guideKey: 'salary-advances', labelKey: 'PAYROLL.layout.NAV.SALARY_ADVANCES', icon: 'payments',
    route: 'salary-advances', permissions: ['PAYROLL_MANAGE_SALARY_ADVANCES'] },
  { guideKey: 'engine-results', labelKey: 'PAYROLL.layout.NAV.ENGINE_RESULTS', icon: 'account_balance_wallet',
    route: 'engine-results', permissions: ['PAYROLL_VIEW_RESULTS'] },
  { guideKey: 'payslips', labelKey: 'PAYROLL.layout.NAV.PAYSLIPS', icon: 'folder_shared',
    route: 'payslips', permissions: ['RH_MANAGE_PAYSLIPS'] },
  { guideKey: 'employee-config', labelKey: 'PAYROLL.layout.NAV.EMPLOYEE_CONFIG', icon: 'manage_accounts',
    route: 'employee-config', permissions: ['PAYROLL_VIEW_EMPLOYEE_CONFIG', 'PAYROLL_MANAGE_EMPLOYEE_CONFIG'] },

  // Administration — une section par `?tab=` (avant l'accueil des cartes, qui les attraperait),
  // mêmes droits que leurs cartes ; toutes listées sous l'onglet « Administration ».
  { guideKey: 'admin-rules', labelKey: 'PAYROLL.ADMIN_HOME.CARDS.RULES', icon: 'gavel', route: 'admin',
    query: { tab: 'list' }, permissions: ['PAYROLL_VIEW_PARAMSET'], helpTab: 'admin', group: 'RULES' },
  { guideKey: 'admin-create', labelKey: 'PAYROLL.ADMIN_HOME.NEW_RULES', icon: 'add_circle', route: 'admin',
    query: { tab: 'create' }, permissions: PAYROLL_CREATE_PARAMSET_PERMISSIONS, helpTab: 'admin', group: 'RULES' },
  { guideKey: 'admin-countries', labelKey: 'PAYROLL.ADMIN_HOME.CARDS.COUNTRIES', icon: 'public', route: 'admin',
    query: { tab: 'countries' }, permissions: PAYROLL_COUNTRIES_PERMISSIONS, helpTab: 'admin', group: 'ENGINE' },
  { guideKey: 'admin-engine-params', labelKey: 'PAYROLL.ADMIN_HOME.CARDS.ENGINE_PARAMS', icon: 'tune', route: 'admin',
    query: { tab: 'engine-params' }, permissions: PAYROLL_ENGINE_PARAMS_PERMISSIONS, helpTab: 'admin', group: 'ENGINE' },
  { guideKey: 'admin-rubriques', labelKey: 'PAYROLL.ADMIN_HOME.CARDS.RUBRIQUES', icon: 'receipt_long', route: 'admin',
    query: { tab: 'rubriques' }, permissions: PAYROLL_ENGINE_RUBRIQUES_PERMISSIONS, helpTab: 'admin', group: 'ENGINE' },
  { guideKey: 'admin-advance-rules', labelKey: 'PAYROLL.ADMIN_HOME.CARDS.ADVANCE_RULES', icon: 'request_quote', route: 'admin',
    query: { tab: 'advance-rules' }, permissions: PAYROLL_SALARY_ADVANCES_PERMISSIONS, helpTab: 'admin', group: 'CONTROL' },
  { guideKey: 'admin-audit', labelKey: 'PAYROLL.ADMIN_HOME.CARDS.AUDIT', icon: 'history', route: 'admin',
    query: { tab: 'audit' }, permissions: PAYROLL_AUDIT_PERMISSIONS, helpTab: 'admin', group: 'CONTROL' },
  { guideKey: 'admin-help-faq', labelKey: 'PAYROLL.ADMIN_HOME.CARDS.HELP_FAQ', icon: 'smart_toy', route: 'admin',
    query: { tab: 'help-faq' }, permissions: PAYROLL_HELP_FAQ_PERMISSIONS, helpTab: 'admin', group: 'CONTROL' },
  { guideKey: 'admin', labelKey: 'PAYROLL.layout.NAV.ADMIN', icon: 'admin_panel_settings', route: 'admin',
    permissions: ['PAYROLL_VIEW_PARAMSET'] },
];

/** Help-page tab of a guide. */
export function helpTabOf(page: GuidePageDef): string {
  return page.helpTab ?? page.guideKey;
}

/**
 * The guide of the page at `url` (an app URL, query string allowed), if it has one.
 * `route` matches the END of the path (`/finance/affaires`, not `/finance/affaires/42` nor
 * `/affaires/new`): an affaire's file or the creation wizard are other pages, with their
 * own anchors — they get their own entry (`pattern`) when they get a guide.
 */
export function guidePageAt(url: string): GuidePageDef | undefined {
  const [path, rest = ''] = url.split('?');
  const params = new URLSearchParams(rest.split('#')[0]);
  return GUIDE_PAGES.find(p =>
    (p.pattern ?? new RegExp(`(^|/)${p.route}/?$`)).test(path.split('#')[0])
    && Object.entries(p.query ?? {}).every(([k, v]) => params.get(k) === v));
}
