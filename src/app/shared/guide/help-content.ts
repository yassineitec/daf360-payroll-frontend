/**
 * Content of the « Aide & guides » page (/payroll/aide), per payroll page. Every text is an
 * i18n key: GUIDE.CENTER.* for the help page's own texts, GUIDE.<PAGE>.* reused for the
 * documentation so a page's guide and its documentation never say two things.
 *
 * Same structure as the Finance and RH modules. Filled in for the payroll home page; a new
 * page adds its FAQ, documentation and videos here, keyed by its `GUIDE_PAGES.guideKey`.
 */

export interface HelpFaq {
  id: string;
  questionKey: string;
  answerKey: string;
}

/** One section of a page's documentation: a title and its text. */
export interface HelpDocSection {
  titleKey: string;
  textKey: string;
}

export interface HelpVideo {
  titleKey: string;
  /** Shown as « 2 min ». */
  minutes: number;
  /**
   * Address of the video FILE (.mp4 / .webm), played in a `<video>` inside a modal — a
   * page link (a SharePoint or Stream viewer page) won't play there. Empty until the
   * video exists — the card then reads « Bientôt disponible ».
   */
  url: string;
}

export interface HelpPageContent {
  faq: HelpFaq[];
  docs: HelpDocSection[];
  videos: HelpVideo[];
}

const faq = (page: string, key: string, id: string): HelpFaq => ({
  id: `${page}-${id}`,
  questionKey: `GUIDE.CENTER.FAQ.${key}.Q`,
  answerKey: `GUIDE.CENTER.FAQ.${key}.A`,
});

export const HELP_CONTENT: Record<string, HelpPageContent> = {
  'home': {
    faq: [
      faq('home', 'HOME.WHAT',      'what'),
      faq('home', 'HOME.MISSING',   'missing'),
      faq('home', 'HOME.EMPTY',     'empty'),
      faq('home', 'HOME.CURRENCY',  'currency'),
      faq('home', 'HOME.SIMULATE',  'simulate'),
      faq('home', 'HOME.PAYSLIP',   'payslip'),
      faq('home', 'HOME.REAL_RUN',  'real-run'),
      faq('home', 'HOME.LANGUAGE',  'language'),
    ],
    docs: [
      { titleKey: 'GUIDE.HOME.MODULES_TITLE',  textKey: 'GUIDE.HOME.MODULES_TEXT' },
      { titleKey: 'GUIDE.HOME.SIMULATION_TITLE', textKey: 'GUIDE.HOME.SIMULATION_TEXT' },
      { titleKey: 'GUIDE.HOME.RUN_TITLE',      textKey: 'GUIDE.HOME.RUN_TEXT' },
      { titleKey: 'GUIDE.HOME.SETTINGS_TITLE', textKey: 'GUIDE.HOME.SETTINGS_TEXT' },
      { titleKey: 'GUIDE.HOME.CURRENCY_TITLE', textKey: 'GUIDE.HOME.CURRENCY_TEXT' },
      { titleKey: 'GUIDE.HOME.HELP_TITLE',     textKey: 'GUIDE.HOME.HELP_TEXT' },
    ],
    videos: [],
  },

  // ── Simulateur manuel : la liste, le formulaire, la fiche résultat ──────────
  'simulator': {
    faq: [
      faq('simulator', 'SIMULATOR.EMPTY',     'empty'),
      faq('simulator', 'SIMULATOR.NEW',       'new'),
      faq('simulator', 'SIMULATOR.DUPLICATE', 'duplicate'),
      faq('simulator', 'SIMULATOR.RATIO',     'ratio'),
      faq('simulator', 'SIMULATOR.PARTIAL',   'partial'),
      faq('simulator', 'SIMULATOR.EXPORT',    'export'),
    ],
    docs: [
      { titleKey: 'GUIDE.SIMULATOR.KPIS_TITLE',    textKey: 'GUIDE.SIMULATOR.KPIS_TEXT' },
      { titleKey: 'GUIDE.SIMULATOR.TOOLBAR_TITLE', textKey: 'GUIDE.SIMULATOR.TOOLBAR_TEXT' },
      { titleKey: 'GUIDE.SIMULATOR.RESULTS_TITLE', textKey: 'GUIDE.SIMULATOR.RESULTS_TEXT' },
    ],
    videos: [],
  },
  'simulator-new': {
    faq: [
      faq('simulator-new', 'SIMULATOR_NEW.NO_RULES',  'no-rules'),
      faq('simulator-new', 'SIMULATOR_NEW.DIRECTION', 'direction'),
      faq('simulator-new', 'SIMULATOR_NEW.EMPLOYEE',  'employee'),
      faq('simulator-new', 'SIMULATOR_NEW.CURRENCY',  'currency'),
      faq('simulator-new', 'SIMULATOR_NEW.BENEFITS',  'benefits'),
      faq('simulator-new', 'SIMULATOR_NEW.BLOCKED',   'blocked'),
    ],
    docs: [
      { titleKey: 'GUIDE.SIMULATOR_NEW.STEP1_TITLE', textKey: 'GUIDE.SIMULATOR_NEW.STEP1_TEXT' },
      { titleKey: 'GUIDE.SIMULATOR_NEW.STEP2_TITLE', textKey: 'GUIDE.SIMULATOR_NEW.STEP2_TEXT' },
      { titleKey: 'GUIDE.SIMULATOR_NEW.STEP3_TITLE', textKey: 'GUIDE.SIMULATOR_NEW.STEP3_TEXT' },
      { titleKey: 'GUIDE.SIMULATOR_NEW.SIMULATE_TITLE', textKey: 'GUIDE.SIMULATOR_NEW.SIMULATE_TEXT' },
    ],
    videos: [],
  },
  'simulation-detail': {
    faq: [
      faq('simulation-detail', 'SIMULATION_DETAIL.EDIT',     'edit'),
      faq('simulation-detail', 'SIMULATION_DETAIL.COST',     'cost'),
      faq('simulation-detail', 'SIMULATION_DETAIL.TABS',     'tabs'),
      faq('simulation-detail', 'SIMULATION_DETAIL.APPROX',   'approx'),
      faq('simulation-detail', 'SIMULATION_DETAIL.EXPORT',   'export'),
    ],
    docs: [
      { titleKey: 'GUIDE.SIMULATION_DETAIL.DETAILS_TITLE',  textKey: 'GUIDE.SIMULATION_DETAIL.DETAILS_TEXT' },
      { titleKey: 'GUIDE.SIMULATION_DETAIL.KPIS_TITLE',     textKey: 'GUIDE.SIMULATION_DETAIL.KPIS_TEXT' },
      { titleKey: 'GUIDE.SIMULATION_DETAIL.OVERVIEW_TITLE', textKey: 'GUIDE.SIMULATION_DETAIL.OVERVIEW_TEXT' },
      { titleKey: 'GUIDE.SIMULATION_DETAIL.RUBRIQUES_TITLE', textKey: 'GUIDE.SIMULATION_DETAIL.RUBRIQUES_TEXT' },
      { titleKey: 'GUIDE.SIMULATION_DETAIL.CHARGES_TITLE',  textKey: 'GUIDE.SIMULATION_DETAIL.CHARGES_TEXT' },
      { titleKey: 'GUIDE.SIMULATION_DETAIL.IRPP_TITLE',     textKey: 'GUIDE.SIMULATION_DETAIL.IRPP_TEXT' },
    ],
    videos: [],
  },

  // ── Simulations candidats : la liste et la fiche d'un candidat ─────────────
  'candidate-simulation': {
    faq: [
      faq('candidate-simulation', 'CANDIDATE_SIMULATION.EMPTY',   'empty'),
      faq('candidate-simulation', 'CANDIDATE_SIMULATION.ORIGIN',  'origin'),
      faq('candidate-simulation', 'CANDIDATE_SIMULATION.PENDING', 'pending'),
      faq('candidate-simulation', 'CANDIDATE_SIMULATION.GAP',     'gap'),
      faq('candidate-simulation', 'CANDIDATE_SIMULATION.DECIDE',  'decide'),
    ],
    docs: [
      { titleKey: 'GUIDE.CANDIDATE_SIMULATION.KPIS_TITLE',    textKey: 'GUIDE.CANDIDATE_SIMULATION.KPIS_TEXT' },
      { titleKey: 'GUIDE.CANDIDATE_SIMULATION.TOOLBAR_TITLE', textKey: 'GUIDE.CANDIDATE_SIMULATION.TOOLBAR_TEXT' },
      { titleKey: 'GUIDE.CANDIDATE_SIMULATION.RESULTS_TITLE', textKey: 'GUIDE.CANDIDATE_SIMULATION.RESULTS_TEXT' },
    ],
    videos: [],
  },
  'candidate-detail': {
    faq: [
      faq('candidate-detail', 'CANDIDATE_DETAIL.ROUNDS',    'rounds'),
      faq('candidate-detail', 'CANDIDATE_DETAIL.SURCOST',   'surcost'),
      faq('candidate-detail', 'CANDIDATE_DETAIL.DUPLICATE', 'duplicate'),
      faq('candidate-detail', 'CANDIDATE_DETAIL.RH',        'rh'),
    ],
    docs: [
      { titleKey: 'GUIDE.CANDIDATE_DETAIL.KPIS_TITLE',     textKey: 'GUIDE.CANDIDATE_DETAIL.KPIS_TEXT' },
      { titleKey: 'GUIDE.CANDIDATE_DETAIL.TIMELINE_TITLE', textKey: 'GUIDE.CANDIDATE_DETAIL.TIMELINE_TEXT' },
      { titleKey: 'GUIDE.CANDIDATE_DETAIL.DETAIL_TITLE',   textKey: 'GUIDE.CANDIDATE_DETAIL.DETAIL_TEXT' },
    ],
    videos: [],
  },

  // ── Avances sur salaire ─────────────────────────────────────────────────────
  'salary-advances': {
    faq: [
      faq('salary-advances', 'SALARY_ADVANCES.FLOW',       'flow'),
      faq('salary-advances', 'SALARY_ADVANCES.NOT_LISTED', 'not-listed'),
      faq('salary-advances', 'SALARY_ADVANCES.SCHEDULE',   'schedule'),
      faq('salary-advances', 'SALARY_ADVANCES.MONTH',      'month'),
      faq('salary-advances', 'SALARY_ADVANCES.SKIP_WAIVE', 'skip-waive'),
      faq('salary-advances', 'SALARY_ADVANCES.MATRICULE',  'matricule'),
      faq('salary-advances', 'SALARY_ADVANCES.RULES',      'rules'),
    ],
    docs: [
      { titleKey: 'GUIDE.SALARY_ADVANCES.KPIS_TITLE',       textKey: 'GUIDE.SALARY_ADVANCES.KPIS_TEXT' },
      { titleKey: 'GUIDE.SALARY_ADVANCES.PAYOUT_TITLE',     textKey: 'GUIDE.SALARY_ADVANCES.PAYOUT_TEXT' },
      { titleKey: 'GUIDE.SALARY_ADVANCES.PAY_TITLE',        textKey: 'GUIDE.SALARY_ADVANCES.PAY_TEXT' },
      { titleKey: 'GUIDE.SALARY_ADVANCES.MONTH_TITLE',      textKey: 'GUIDE.SALARY_ADVANCES.MONTH_TEXT' },
      { titleKey: 'GUIDE.SALARY_ADVANCES.DEDUCTIONS_TITLE', textKey: 'GUIDE.SALARY_ADVANCES.DEDUCTIONS_TEXT' },
      { titleKey: 'GUIDE.SALARY_ADVANCES.FOLLOWUP_TITLE',   textKey: 'GUIDE.SALARY_ADVANCES.FOLLOWUP_TEXT' },
    ],
    videos: [],
  },

  // ── Charge salariale : l'annuaire et la fiche d'un collaborateur ────────────
  'engine-results': {
    faq: [
      faq('engine-results', 'ENGINE_RESULTS.WHAT', 'what'),
      faq('engine-results', 'ENGINE_RESULTS.BATCH', 'batch'),
      faq('engine-results', 'ENGINE_RESULTS.MISSING', 'missing'),
      faq('engine-results', 'ENGINE_RESULTS.UNPRICED', 'unpriced'),
      faq('engine-results', 'ENGINE_RESULTS.RERUN', 'rerun'),
      faq('engine-results', 'ENGINE_RESULTS.CURRENCY', 'currency'),
      faq('engine-results', 'ENGINE_RESULTS.KPI_EMPTY', 'kpi-empty'),
    ],
    docs: [
      { titleKey: 'GUIDE.ENGINE_RESULTS.KPIS_TITLE', textKey: 'GUIDE.ENGINE_RESULTS.KPIS_TEXT' },
      { titleKey: 'GUIDE.ENGINE_RESULTS.BATCH_TITLE', textKey: 'GUIDE.ENGINE_RESULTS.BATCH_TEXT' },
      { titleKey: 'GUIDE.ENGINE_RESULTS.TOOLBAR_TITLE', textKey: 'GUIDE.ENGINE_RESULTS.TOOLBAR_TEXT' },
      { titleKey: 'GUIDE.ENGINE_RESULTS.RESULTS_TITLE', textKey: 'GUIDE.ENGINE_RESULTS.RESULTS_TEXT' },
    ],
    videos: [],
  },
  'engine-results-detail': {
    faq: [
      faq('engine-results-detail', 'ENGINE_RESULTS_DETAIL.CALC', 'calc'),
      faq('engine-results-detail', 'ENGINE_RESULTS_DETAIL.CONTRACT', 'contract'),
      faq('engine-results-detail', 'ENGINE_RESULTS_DETAIL.OLD', 'old'),
      faq('engine-results-detail', 'ENGINE_RESULTS_DETAIL.YEAR', 'year'),
      faq('engine-results-detail', 'ENGINE_RESULTS_DETAIL.EXPORT', 'export'),
      faq('engine-results-detail', 'ENGINE_RESULTS_DETAIL.PARTIAL', 'partial'),
    ],
    docs: [
      { titleKey: 'GUIDE.ENGINE_RESULTS_DETAIL.CARD_TITLE', textKey: 'GUIDE.ENGINE_RESULTS_DETAIL.CARD_TEXT' },
      { titleKey: 'GUIDE.ENGINE_RESULTS_DETAIL.ACTIONS_TITLE', textKey: 'GUIDE.ENGINE_RESULTS_DETAIL.ACTIONS_TEXT' },
      { titleKey: 'GUIDE.ENGINE_RESULTS_DETAIL.KPIS_TITLE', textKey: 'GUIDE.ENGINE_RESULTS_DETAIL.KPIS_TEXT' },
      { titleKey: 'GUIDE.ENGINE_RESULTS_DETAIL.PERIODS_TITLE', textKey: 'GUIDE.ENGINE_RESULTS_DETAIL.PERIODS_TEXT' },
      { titleKey: 'GUIDE.ENGINE_RESULTS_DETAIL.PAYSLIP_TITLE', textKey: 'GUIDE.ENGINE_RESULTS_DETAIL.PAYSLIP_TEXT' },
    ],
    videos: [],
  },
  // ── Fiches de paie : l'historique des lots, l'import, le rapport d'un lot ───
  'payslips': {
    faq: [
      faq('payslips', 'PAYSLIPS.HOW', 'how'),
      faq('payslips', 'PAYSLIPS.MISSING_BATCH', 'missing-batch'),
      faq('payslips', 'PAYSLIPS.TO_CHECK', 'to-check'),
      faq('payslips', 'PAYSLIPS.REDO', 'redo'),
      faq('payslips', 'PAYSLIPS.RIGHTS', 'rights'),
    ],
    docs: [
      { titleKey: 'GUIDE.PAYSLIPS.KPIS_TITLE', textKey: 'GUIDE.PAYSLIPS.KPIS_TEXT' },
      { titleKey: 'GUIDE.PAYSLIPS.NOTE_TITLE', textKey: 'GUIDE.PAYSLIPS.NOTE_TEXT' },
      { titleKey: 'GUIDE.PAYSLIPS.TOOLBAR_TITLE', textKey: 'GUIDE.PAYSLIPS.TOOLBAR_TEXT' },
      { titleKey: 'GUIDE.PAYSLIPS.RESULTS_TITLE', textKey: 'GUIDE.PAYSLIPS.RESULTS_TEXT' },
    ],
    videos: [],
  },
  'payslip-new': {
    faq: [
      faq('payslip-new', 'PAYSLIP_NEW.FORMAT', 'format'),
      faq('payslip-new', 'PAYSLIP_NEW.ALREADY', 'already'),
      faq('payslip-new', 'PAYSLIP_NEW.LONG', 'long'),
    ],
    docs: [
      { titleKey: 'GUIDE.PAYSLIP_NEW.PERIOD_TITLE', textKey: 'GUIDE.PAYSLIP_NEW.PERIOD_TEXT' },
      { titleKey: 'GUIDE.PAYSLIP_NEW.FILE_TITLE', textKey: 'GUIDE.PAYSLIP_NEW.FILE_TEXT' },
      { titleKey: 'GUIDE.PAYSLIP_NEW.SUBMIT_TITLE', textKey: 'GUIDE.PAYSLIP_NEW.SUBMIT_TEXT' },
    ],
    videos: [],
  },
  'payslip-report': {
    faq: [
      faq('payslip-report', 'PAYSLIP_REPORT.UNKNOWN', 'unknown'),
      faq('payslip-report', 'PAYSLIP_REPORT.UNIDENTIFIED', 'unidentified'),
      faq('payslip-report', 'PAYSLIP_REPORT.DUPLICATE', 'duplicate'),
      faq('payslip-report', 'PAYSLIP_REPORT.NOT_FILED', 'not-filed'),
      faq('payslip-report', 'PAYSLIP_REPORT.NOT_FOUND', 'not-found'),
    ],
    docs: [
      { titleKey: 'GUIDE.PAYSLIP_REPORT.DETAILS_TITLE', textKey: 'GUIDE.PAYSLIP_REPORT.DETAILS_TEXT' },
      { titleKey: 'GUIDE.PAYSLIP_REPORT.ACTIONS_TITLE', textKey: 'GUIDE.PAYSLIP_REPORT.ACTIONS_TEXT' },
      { titleKey: 'GUIDE.PAYSLIP_REPORT.KPIS_TITLE', textKey: 'GUIDE.PAYSLIP_REPORT.KPIS_TEXT' },
      { titleKey: 'GUIDE.PAYSLIP_REPORT.TABLE_TITLE', textKey: 'GUIDE.PAYSLIP_REPORT.TABLE_TEXT' },
    ],
    videos: [],
  },
  // ── Salaires des collaborateurs : la liste et la configuration d'un collaborateur
  'employee-config': {
    faq: [
      faq('employee-config', 'EMPLOYEE_CONFIG.WHY', 'why'),
      faq('employee-config', 'EMPLOYEE_CONFIG.MISSING', 'missing'),
      faq('employee-config', 'EMPLOYEE_CONFIG.READONLY', 'readonly'),
    ],
    docs: [
      { titleKey: 'GUIDE.EMPLOYEE_CONFIG.TOOLBAR_TITLE', textKey: 'GUIDE.EMPLOYEE_CONFIG.TOOLBAR_TEXT' },
      { titleKey: 'GUIDE.EMPLOYEE_CONFIG.RESULTS_TITLE', textKey: 'GUIDE.EMPLOYEE_CONFIG.RESULTS_TEXT' },
    ],
    videos: [],
  },
  'employee-config-detail': {
    faq: [
      faq('employee-config-detail', 'EMPLOYEE_CONFIG_DETAIL.CONTRACT', 'contract'),
      faq('employee-config-detail', 'EMPLOYEE_CONFIG_DETAIL.NET', 'net'),
      faq('employee-config-detail', 'EMPLOYEE_CONFIG_DETAIL.CURRENCY', 'currency'),
      faq('employee-config-detail', 'EMPLOYEE_CONFIG_DETAIL.NEVER_SAVED', 'never-saved'),
      faq('employee-config-detail', 'EMPLOYEE_CONFIG_DETAIL.BONUS_EDIT', 'bonus-edit'),
      faq('employee-config-detail', 'EMPLOYEE_CONFIG_DETAIL.WHO', 'who'),
    ],
    docs: [
      { titleKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.ASSIGNMENT_TITLE', textKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.ASSIGNMENT_TEXT' },
      { titleKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.SALARY_TITLE', textKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.SALARY_TEXT' },
      { titleKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.FAMILY_TITLE', textKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.FAMILY_TEXT' },
      { titleKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.BENEFITS_TITLE', textKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.BENEFITS_TEXT' },
      { titleKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.SAVE_TITLE', textKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.SAVE_TEXT' },
      { titleKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.BONUSES_TITLE', textKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.BONUSES_TEXT' },
      { titleKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.HISTORY_TITLE', textKey: 'GUIDE.EMPLOYEE_CONFIG_DETAIL.HISTORY_TEXT' },
    ],
    videos: [],
  },
  // ── Administration : l'accueil des cartes, puis une entrée par section (`?tab=`) ──
  'admin': {
    faq: [
      faq('admin', 'ADMIN.WHICH', 'which'),
      faq('admin', 'ADMIN.CARD_MISSING', 'card-missing'),
    ],
    docs: [
      { titleKey: 'GUIDE.ADMIN.CARDS_TITLE', textKey: 'GUIDE.ADMIN.CARDS_TEXT' },
      { titleKey: 'GUIDE.ADMIN.TWO_SYSTEMS_TITLE', textKey: 'GUIDE.ADMIN.TWO_SYSTEMS_TEXT' },
    ],
    videos: [],
  },
  'admin-rules': {
    faq: [
      faq('admin-rules', 'ADMIN_RULES.WORKFLOW', 'workflow'),
      faq('admin-rules', 'ADMIN_RULES.READONLY', 'readonly'),
    ],
    docs: [
      { titleKey: 'GUIDE.ADMIN_RULES.WELCOME_TITLE', textKey: 'GUIDE.ADMIN_RULES.WELCOME_TEXT' },
      { titleKey: 'GUIDE.ADMIN_RULES.SET_HEADER_TITLE', textKey: 'GUIDE.ADMIN_RULES.SET_HEADER_TEXT' },
      { titleKey: 'GUIDE.ADMIN_RULES.SET_TABS_TITLE', textKey: 'GUIDE.ADMIN_RULES.SET_TABS_TEXT' },
    ],
    videos: [],
  },
  'admin-create': {
    faq: [
      faq('admin-create', 'ADMIN_CREATE.COPY', 'copy'),
    ],
    docs: [
      { titleKey: 'GUIDE.ADMIN_CREATE.FORM_TITLE', textKey: 'GUIDE.ADMIN_CREATE.FORM_TEXT' },
      { titleKey: 'GUIDE.ADMIN_CREATE.ADVANCED_TITLE', textKey: 'GUIDE.ADMIN_CREATE.ADVANCED_TEXT' },
      { titleKey: 'GUIDE.ADMIN_CREATE.ACTIONS_TITLE', textKey: 'GUIDE.ADMIN_CREATE.ACTIONS_TEXT' },
    ],
    videos: [],
  },
  'admin-countries': {
    faq: [
      faq('admin-countries', 'ADMIN_COUNTRIES.INACTIVE', 'inactive'),
      faq('admin-countries', 'ADMIN_COUNTRIES.CURRENCY', 'currency'),
    ],
    docs: [
      { titleKey: 'GUIDE.ADMIN_COUNTRIES.WELCOME_TITLE', textKey: 'GUIDE.ADMIN_COUNTRIES.WELCOME_TEXT' },
      { titleKey: 'GUIDE.ADMIN_COUNTRIES.TABLE_TITLE', textKey: 'GUIDE.ADMIN_COUNTRIES.TABLE_TEXT' },
    ],
    videos: [],
  },
  'admin-engine-params': {
    faq: [
      faq('admin-engine-params', 'ADMIN_ENGINE_PARAMS.CIRCUIT', 'circuit'),
      faq('admin-engine-params', 'ADMIN_ENGINE_PARAMS.MISSING_KEYS', 'missing-keys'),
    ],
    docs: [
      { titleKey: 'GUIDE.ADMIN_ENGINE_PARAMS.WELCOME_TITLE', textKey: 'GUIDE.ADMIN_ENGINE_PARAMS.WELCOME_TEXT' },
      { titleKey: 'GUIDE.ADMIN_ENGINE_PARAMS.CIRCUIT_TITLE', textKey: 'GUIDE.ADMIN_ENGINE_PARAMS.CIRCUIT_TEXT' },
      { titleKey: 'GUIDE.ADMIN_ENGINE_PARAMS.PARAMS_TITLE', textKey: 'GUIDE.ADMIN_ENGINE_PARAMS.PARAMS_TEXT' },
    ],
    videos: [],
  },
  'admin-rubriques': {
    faq: [
      faq('admin-rubriques', 'ADMIN_RUBRIQUES.IMPACT', 'impact'),
      faq('admin-rubriques', 'ADMIN_RUBRIQUES.ORDER', 'order'),
    ],
    docs: [
      { titleKey: 'GUIDE.ADMIN_RUBRIQUES.WELCOME_TITLE', textKey: 'GUIDE.ADMIN_RUBRIQUES.WELCOME_TEXT' },
      { titleKey: 'GUIDE.ADMIN_RUBRIQUES.TABLE_TITLE', textKey: 'GUIDE.ADMIN_RUBRIQUES.TABLE_TEXT' },
    ],
    videos: [],
  },
  'admin-advance-rules': {
    faq: [
      faq('admin-advance-rules', 'ADMIN_ADVANCE_RULES.CLOSED', 'closed'),
    ],
    docs: [
      { titleKey: 'GUIDE.ADMIN_ADVANCE_RULES.WELCOME_TITLE', textKey: 'GUIDE.ADMIN_ADVANCE_RULES.WELCOME_TEXT' },
      { titleKey: 'GUIDE.ADMIN_ADVANCE_RULES.TABLE_TITLE', textKey: 'GUIDE.ADMIN_ADVANCE_RULES.TABLE_TEXT' },
    ],
    videos: [],
  },
  'admin-audit': {
    faq: [
      faq('admin-audit', 'ADMIN_AUDIT.WHAT', 'what'),
    ],
    docs: [
      { titleKey: 'GUIDE.ADMIN_AUDIT.WELCOME_TITLE', textKey: 'GUIDE.ADMIN_AUDIT.WELCOME_TEXT' },
      { titleKey: 'GUIDE.ADMIN_AUDIT.TABLE_TITLE', textKey: 'GUIDE.ADMIN_AUDIT.TABLE_TEXT' },
    ],
    videos: [],
  },
  // ── Administration › Assistant & FAQ ──
  'admin-help-faq': {
    faq: [
      faq('admin-help-faq', 'ADMIN_HELP_FAQ.ADD', 'add'),
      faq('admin-help-faq', 'ADMIN_HELP_FAQ.HIDE', 'hide'),
      faq('admin-help-faq', 'ADMIN_HELP_FAQ.TRANSLATION', 'translation'),
    ],
    docs: [
      { titleKey: 'GUIDE.ADMIN_HELP_FAQ.WELCOME_TITLE', textKey: 'GUIDE.ADMIN_HELP_FAQ.WELCOME_TEXT' },
      { titleKey: 'GUIDE.ADMIN_HELP_FAQ.TABLE_TITLE', textKey: 'GUIDE.ADMIN_HELP_FAQ.TABLE_TEXT' },
    ],
    videos: [],
  },
};

/**
 * Support contact shown on the help page. Empty = not configured yet: the « Support »
 * card is then hidden rather than offering a dead « Écrire au support ».
 */
export const SUPPORT_CONTACT = {
  email: '',
};
