import { ChangeDetectionStrategy, Component, DestroyRef, TemplateRef, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent,
  CardComponent,
  CheckboxComponent,
  DataTableComponent,
  FormFieldComponent,
  MetricCardComponent,
  ModalService,
  PageComponent,
  PageHeaderComponent,
  SearchToolbarComponent,
  SectionCardComponent,
  SectionTitleComponent,
  SelectComponent,
  SkeletonComponent,
  TabsComponent,
  tabParam,
  type ModalRef,
  type TabItem,
  type BreadcrumbItem,
  type MetricCardOptions,
  type MetricDelta,
  type SelectOption,
  type TableAction,
  type TableConfig,
  type TableColumn,
  type TableRow,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, BenefitCatalogueDto, PaysDto, FxRateDto } from '../../core/payroll-api.service';
import { EmployeeProfileDetail, HrProfileService, HrContractType, contractTypeLabel } from '../../core/hr-profile.service';
import { EmployeeDetailsCardComponent, MARITAL_KEYS } from '../../shared/employee-details/employee-details-card.component';
import { NotificationService } from '../../core/notification.service';
import { UserStore } from '../../core/user.store';
import {
  PAYROLL_AUDIT_PERMISSIONS,
} from '../../core/payroll-nav';
import {
  EmployeeConfigService, EmployeePayrollConfigDto, EmployeePayrollBonusDto, EmployeePayrollConfigHistoryDto,
  type CalculationFormValues,
} from './employee-config.service';
import { recallEmployee } from './employee-config-employee';
import { PageGuideComponent } from '../../shared/guide/page-guide.component';
import type { GuideStep } from '../../shared/guide/page-guide.types';
import { searchTableRows, tableTools } from '../../shared/table-tools';
import { flagDataUri } from '../../shared/country-flags';

const BONUS_CURRENCIES = ['TND', 'EUR', 'USD', 'EGP', 'SAR', 'AED'];

/** Anciens codes RH (assistant d'intégration d'avant migration) → codes de la paie. */
const LEGACY_CONTRACT: Record<string, string> = { PERMANENT: 'CDI', FIXED_TERM: 'CDD', INTERN: 'STAGE' };

/**
 * `/payroll/employee-config/:userId` — assign a payroll configuration (country, contract
 * type, benefits-in-kind, salary, bonuses) to one specific employee, opened from the
 * directory `/payroll/employee-config` (`EmployeeConfigListComponent`). The payroll-side twin of
 * daf360-rh-frontend's Rémunération tab — both call the same
 * `GET/PUT /api/payroll/employee-configs/{id}`.
 *
 * Même mise en page que `/payroll/engine-results/:id` : à gauche le titre, la carte
 * « Détails » partagée (fiche RH) et les actions ; à droite les KPI de la configuration
 * enregistrée, puis trois `daf-tabs` : configuration de paie, primes exceptionnelles (modèle
 * des sections /rh/admin : barre + « Ajouter » → pop-up), historique des versions.
 * Retours d'action en toasts, suppression et sortie sans enregistrer confirmées via
 * `ModalService`.
 */
/** Guide de la page — `target` = un `data-guide` du gabarit, `tab` = l'onglet montré. */
const guideStep = (key: string, icon: string, target?: string, tab?: string): GuideStep => ({
  icon, titleKey: `GUIDE.EMPLOYEE_CONFIG_DETAIL.${key}_TITLE`, textKey: `GUIDE.EMPLOYEE_CONFIG_DETAIL.${key}_TEXT`, target, tab,
});
const GUIDE_STEPS: GuideStep[] = [
  guideStep('WELCOME',    'manage_accounts', 'ec-detail-header'),
  guideStep('KPIS',       'monitoring',      'ec-detail-kpis'),
  guideStep('TABS',       'tab',             'ec-detail-tabs'),
  // Le formulaire est dans une pop-up : le guide montre le résumé et le bouton qui l'ouvre.
  guideStep('SUMMARY',    'fact_check',      'ec-detail-summary',    'config'),
  guideStep('EDIT',       'edit',            'ec-detail-edit',       'config'),
  guideStep('BONUSES',    'card_giftcard',   'ec-detail-bonuses',    'bonuses'),
  guideStep('HISTORY',    'history',         'ec-detail-history',    'history'),
];

@Component({
  selector: 'app-employee-config',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    ButtonComponent, CardComponent, CheckboxComponent, DataTableComponent, FormFieldComponent,
    EmployeeDetailsCardComponent, MetricCardComponent, PageComponent, PageHeaderComponent, SearchToolbarComponent, SectionCardComponent,
    SectionTitleComponent, SelectComponent, SkeletonComponent, TabsComponent, PageGuideComponent,
  ],
  templateUrl: './employee-config.component.html',
  styleUrl: './employee-config.component.scss',
})
export class EmployeeConfigComponent implements OnInit {
  private svc = inject(EmployeeConfigService);
  private payrollApi = inject(PayrollApiService);
  private hrService = inject(HrProfileService);
  private translate = inject(TranslateService);
  private notify = inject(NotificationService);
  private modal = inject(ModalService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private userStore = inject(UserStore);
  private destroyRef = inject(DestroyRef);

  /** Même pattern que `cohort`/`simulator` : lire `currentLang()` rend les `computed`
   *  réactifs au changement de langue du shell. */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  private isEn(): boolean {
    return this.translate.currentLang() === 'en';
  }

  private locale(): string {
    return this.isEn() ? 'en-US' : 'fr-FR';
  }

  // ── Collaborateur ──────────────────────────────────────────────────────
  readonly userId = Number(this.route.snapshot.paramMap.get('userId'));
  /** Fiche transmise par la liste ; `null` si la page est ouverte directement par lien. */
  readonly employee = signal(recallEmployee(this.userId));
  readonly employeeName = computed(() =>
    this.employee()?.fullName ?? this.t('PAYROLL.EMPLOYEE_CONFIG.EMPLOYEE_FALLBACK', { id: this.userId }));

  /** Même fil que /payroll/engine-results/:id : Paie › Rémunération › collaborateur. */
  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.layout.NAV.EMPLOYEE_CONFIG'), link: '/payroll/employee-config' },
    { label: this.employeeName() },
  ]);

  // ── Carte « Détails » (colonne gauche) : fiche RH complète, lue par `profileId` (transmis
  //    par la liste). Ouverte par lien, la page n'en a pas : la carte se limite au nom.
  readonly profile = signal<EmployeeProfileDetail | null>(null);
  readonly profileLoading = signal(false);

  private loadProfile(): void {
    const profileId = this.employee()?.profileId;
    if (!profileId) return;
    this.profileLoading.set(true);
    this.hrService.getProfile(profileId).subscribe({
      next: p  => { this.profile.set(p); this.profileLoading.set(false); },
      error: () => this.profileLoading.set(false),
    });
  }

  // ── Écarts avec la fiche RH ───────────────────────────────────────────────
  // La carte « Détails » montre la fiche RH, le formulaire la configuration de PAIE (celle
  // que le moteur utilise) : quand elles diffèrent, le formulaire le dit sous le champ.
  private static normContract(code: string | null | undefined): string | null {
    const c = code?.trim().toUpperCase();
    return c ? (LEGACY_CONTRACT[c] ?? c) : null;
  }

  /** « Fiche RH : CDI » quand le contrat de la fiche RH n'est pas celui choisi ici. */
  readonly hrContractDiff = computed((): string | null => {
    const hr = this.profile()?.contractType ?? this.employee()?.contractType;
    const cfg = this.config()?.contractType;
    const a = EmployeeConfigComponent.normContract(hr), b = EmployeeConfigComponent.normContract(cfg);
    if (!a || !b || a === b) return null;
    return this.t('PAYROLL.EMPLOYEE_CONFIG.HR_DIFF', { value: contractTypeLabel(hr!, this.translate) });
  });

  /** « Fiche RH : marié(e), 2 enfants » quand la situation familiale de la fiche RH diffère. */
  readonly hrFamilyDiff = computed((): string | null => {
    const p = this.profile();
    const cfg = this.config();
    if (!p || !cfg) return null;
    const key = p.maritalStatus ? MARITAL_KEYS[p.maritalStatus.toUpperCase()] : undefined;
    const marriedDiff = key != null && (key === 'MARRIED') !== cfg.isMarried;
    const children = p.numberOfChildren;
    const childrenDiff = children != null && children !== (cfg.childrenCount ?? 0);
    if (!marriedDiff && !childrenDiff) return null;
    const parts = [
      key ? this.t(`PAYROLL.ENGINE_RESULTS.DETAILS.MARITAL.${key}`) : null,
      children != null ? this.t('PAYROLL.EMPLOYEE_CONFIG.HR_CHILDREN', { count: children }) : null,
    ].filter(Boolean);
    return this.t('PAYROLL.EMPLOYEE_CONFIG.HR_DIFF', { value: parts.join(', ') });
  });

  // ── KPI : la configuration ENREGISTRÉE (pas le formulaire en cours), comme les tuiles de
  //    /payroll/engine-results/:id résument ses résultats. ─────────────────────────────
  readonly kpiTiles = computed((): { label: string; value: string; delta: MetricDelta | null; options: MetricCardOptions }[] => {
    const saved = this.savedConfig();
    const empty = '—';
    const cur = EmployeeConfigComponent.realCurrencyFor(saved?.paysId, this.paysList().find(p => p.id === saved?.paysId)?.devise ?? '');
    const never = !saved || saved.updatedAt == null;
    const now = new Date();
    const thisMonth = this.bonuses().filter(b => b.periodYear === now.getFullYear() && b.periodMonth === now.getMonth() + 1).length;
    return [
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_GROSS'),
        value: never ? empty : (this.money(saved!.currentGrossSalary, cur) ?? empty),
        delta: saved?.inputCurrency && saved.inputAmountOriginal != null
          ? { value: this.t('PAYROLL.EMPLOYEE_CONFIG.ENTERED_AS', { amount: this.money(saved.inputAmountOriginal, saved.inputCurrency) }), direction: 'neutral' }
          : null,
        options: { icon: 'account_balance_wallet', help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_GROSS_HELP') },
      },
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_NET'),
        value: never ? empty : (this.moneyWhole(saved!.currentNetSalary, cur) ?? empty),
        delta: null,
        options: { icon: 'payments', valueColor: 'text-primary', help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_NET_HELP') },
      },
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_BENEFITS'),
        value: saved ? `${saved.selectedBenefitCodes.length} / ${this.benefits().length}` : empty,
        delta: null,
        options: { icon: 'redeem', help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_BENEFITS_HELP') },
      },
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_BONUSES'),
        value: this.bonusesLoading() ? empty : String(this.bonuses().length),
        delta: thisMonth ? { value: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_BONUSES_SUB', { count: thisMonth }), direction: 'neutral' } : null,
        options: { icon: 'card_giftcard', help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_BONUSES_HELP'), helpPlacement: 'top' },
      },
    ];
  });

  /** Liens d'en-tête vers les autres écrans du collaborateur, selon les droits. */
  readonly canViewResults = computed(() => this.userStore.hasPermission('PAYROLL_VIEW_RESULTS'));
  readonly canRunEngine   = computed(() => this.userStore.hasPermission('PAYROLL_RUN_ENGINE'));

  openResults(): void {
    this.router.navigate(['/payroll/engine-results', this.userId]);
  }

  /** Calcul de paie : fiche « Charge salariale » du collaborateur, pop-up de calcul ouverte
   *  (`?calc=1`), pays pré-sélectionné (`?pays=`). */
  openEngineRun(): void {
    const paysId = this.savedConfig()?.paysId ?? this.employee()?.paysId ?? null;
    this.router.navigate(['/payroll/engine-results', this.userId], {
      queryParams: { calc: 1, ...(paysId != null ? { pays: paysId } : {}) },
    });
  }

  // ── Onglets : configuration / primes / historique — `tabParam` porte l'onglet actif
  //    dans `?tab=` (F5, lien partagé, précédent/suivant), comme parameter-sets.
  readonly activeTab = tabParam(['config', 'bonuses', 'history'] as const, 'config');

  // ── Guide (« Aide & guides ») — tant que la configuration n'est pas chargée, il n'y a
  //    ni onglets ni formulaire à montrer : seule la présentation reste.
  readonly guideSteps = computed(() => this.config() ? GUIDE_STEPS : GUIDE_STEPS.slice(0, 1));
  /** L'onglet de l'utilisateur, rendu à la fermeture du guide (qui ouvre ceux qu'il explique). */
  private tabBeforeGuide: 'config' | 'bonuses' | 'history' | null = null;

  onGuideTab(tab: string): void {
    this.tabBeforeGuide ??= this.activeTab();
    this.activeTab.set(tab as 'config' | 'bonuses' | 'history');
  }

  onGuideClosed(): void {
    if (this.tabBeforeGuide) this.activeTab.set(this.tabBeforeGuide);
    this.tabBeforeGuide = null;
  }

  readonly tabs = computed<TabItem[]>(() => [
    { id: 'config',  label: this.t('PAYROLL.EMPLOYEE_CONFIG.CONFIG_TITLE'), icon: 'manage_accounts' },
    {
      id: 'bonuses', label: this.t('PAYROLL.EMPLOYEE_CONFIG.BONUSES'), icon: 'redeem',
      // `null` pendant le chargement : l'espace du badge reste réservé, pas de saut.
      count: this.bonusesLoading() ? null : this.bonuses().length,
    },
    {
      id: 'history', label: this.t('PAYROLL.EMPLOYEE_CONFIG.HISTORY'), icon: 'history',
      count: this.historyLoading() ? null : this.history().length,
    },
  ]);

  // ── Référentiels ───────────────────────────────────────────────────────
  readonly contractTypes = signal<HrContractType[]>([]);
  /** Tout le référentiel — devise et libellé des configurations et de l'historique. */
  readonly paysList = signal<PaysDto[]>([]);
  /** Pays actifs dans le moteur (« Pays de paie » de /payroll/admin) — les seuls proposés. */
  readonly payrollPays = signal<PaysDto[]>([]);
  readonly benefits = signal<BenefitCatalogueDto[]>([]);

  /** Pays de paie ; le pays déjà affecté reste affiché même s'il a été désactivé depuis. */
  readonly paysOptions = computed<SelectOption[]>(() => {
    const list = this.payrollPays();
    const id = this.config()?.paysId;
    const current = id != null && !list.some(p => p.id === id) ? this.paysList().find(p => p.id === id) : undefined;
    return (current ? [...list, current] : list)
      .map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})`, imageUrl: flagDataUri(p.isoCode) }));
  });

  readonly contractTypeOptions = computed<SelectOption[]>(() => {
    const en = this.isEn();
    return this.contractTypes().map(ct => ({
      value: ct.code,
      label: (en ? ct.labelEn : ct.labelFr) || ct.code,
    }));
  });

  readonly monthOptions = computed<SelectOption[]>(() => {
    const fmt = new Intl.DateTimeFormat(this.locale(), { month: 'long' });
    return Array.from({ length: 12 }, (_, i) => {
      const label = fmt.format(new Date(2000, i, 1));
      return { value: String(i + 1), label: label.charAt(0).toUpperCase() + label.slice(1) };
    });
  });

  benefitLabel(b: BenefitCatalogueDto): string {
    return (this.isEn() ? b.benefitLabelEn : null) || b.benefitLabelFr;
  }

  /** Sous le libellé de l'avantage : valeur mensuelle et régime fiscal, comme l'étape
   *  « Avantages » du simulateur. */
  benefitHint(b: BenefitCatalogueDto): string {
    const value = this.money(b.monthlyValue, this.salaryRealCurrency());
    const tax = this.t(b.isTaxable ? 'PAYROLL.SIMULATOR.STEP3.TAXABLE' : 'PAYROLL.SIMULATOR.STEP3.EXEMPT');
    return value ? `${this.t('PAYROLL.EMPLOYEE_CONFIG.BENEFIT_PER_MONTH', { amount: value })} · ${tax}` : tax;
  }

  readonly selectedBenefitCount = computed(() => this.config()?.selectedBenefitCodes.length ?? 0);

  /** Devise du pays choisi dans le formulaire — affichée dans les champs de salaire. */
  readonly salaryCurrency = computed(() => {
    const id = this.config()?.paysId;
    return this.paysList().find(p => p.id === id)?.devise ?? '';
  });

  /** `GET /api/payroll/ref/fx-rates` — currencies the gross-salary field's picker can
   *  offer, besides the country's own working currency (always offered, never needs a
   *  fetched rate) — same source the Simulator's own currency picker uses. */
  readonly fxRates = signal<FxRateDto[]>([]);

  /** The field's current currency: what's explicitly selected on the in-progress config, or
   *  `salaryRealCurrency` when nothing has been chosen yet. */
  readonly currentCurrency = computed(() =>
    this.config()?.inputCurrency ?? this.salaryRealCurrency());

  /** Native/working currency first (always valid, even before fxRates has loaded), then every
   *  other currency payroll has a cached rate for, alphabetically — same ordering as the
   *  Simulator's own picker. Named distinctly from `currencyOptions` below (the bonus-form
   *  currency list), which already owns that name on this component. */
  readonly salaryCurrencyOptions = computed((): SelectOption[] => {
    const working = this.salaryRealCurrency();
    const others = this.fxRates()
      .map(r => r.currencyCode)
      .filter(c => c !== working)
      .sort();
    return [working, ...others]
      .filter((c): c is string => !!c)
      .map(c => ({ value: c, label: c }));
  });

  readonly currencySelection = computed((): string[] => [this.currentCurrency()].filter(Boolean) as string[]);

  /** 1 `currency` = `rateToEur` EUR. EUR itself is hardcoded to 1 (it's never a row in
   *  `fxRates` — same convention as the backend's FxEntryConversionService). Null when
   *  no cached rate exists for a non-EUR currency, so callers can fall back rather than
   *  guess. */
  private rateToEur(currency: string): number | null {
    if (currency === 'EUR') return 1;
    return this.fxRates().find(r => r.currencyCode === currency)?.rateToEur ?? null;
  }

  /** Mirrors the backend's FxEntryConversionService.NATIVE_CURRENCY_BY_PAYS_ID: countries
   *  whose platform "working currency" is a deliberate accounting label for a different real
   *  currency, not that currency itself (Tunisia's "EUR" stands for real TND, Egypt's "USD"
   *  for real EGP — a convention shared with, and only meaningful to, the separate
   *  affaire/invoicing side, which legitimately bills in that label's real currency; payroll
   *  just reuses the same per-country `devise` field). Picking that real currency, or the
   *  default before anything is picked, must be a no-op relabel, not a rate conversion. */
  private static readonly NATIVE_CURRENCY_BY_PAYS_ID: Record<number, string> = {
    179: 'TND', // Tunisie
    53: 'EGP',  // Egypte
  };

  /** The REAL currency a `paysId`'s salary figures are actually in: its native currency when
   *  it has one (Tunisia's salaries are always entered in TND even though the platform's
   *  working-currency label is "EUR"), its raw working-currency label (`devise`) otherwise. */
  private static realCurrencyFor(paysId: number | null | undefined, devise: string): string {
    return (paysId != null ? EmployeeConfigComponent.NATIVE_CURRENCY_BY_PAYS_ID[paysId] : undefined) ?? devise;
  }

  /** `realCurrencyFor` of the config currently being edited. Public so the "Devise saisie"
   *  hint can explain what the default means. */
  readonly salaryRealCurrency = computed(() =>
    EmployeeConfigComponent.realCurrencyFor(this.config()?.paysId, this.salaryCurrency()));

  /** `currentNetSalary` is always computed/stored in the working currency label, but that
   *  label isn't always `salaryRealCurrency`, the REAL currency the number is in. This
   *  reformats it for display in whatever currency "Devise saisie" currently shows, converting
   *  FROM the real currency (never from the raw working-currency label, which would silently
   *  apply a conversion to a number that's already real), using the SAME
   *  payroll_fx_rates-sourced `fxRates` the picker already loaded (never a different rate
   *  source: mixing sources is exactly what caused a real round-trip bug in the Simulator
   *  earlier). Falls back to the raw value when a rate is missing, rather than guessing.
   *  Rounded to a whole number for display — the stored value itself keeps full precision. */
  readonly netInCurrentCurrency = computed((): number | null => {
    const net = this.config()?.currentNetSalary;
    if (net == null) return null;
    const trueCurrency = this.salaryRealCurrency();
    const target = this.currentCurrency();
    let value = net;
    if (trueCurrency && target && target !== trueCurrency) {
      const fromRate = this.rateToEur(trueCurrency);
      const toRate = this.rateToEur(target);
      if (fromRate != null && toRate != null) value = net * fromRate / toRate;
    }
    return Math.round(value);
  });

  setCurrency(selected: string[]): void {
    const cfg = this.config();
    if (!cfg) return;
    const picked = selected[0];
    const working = this.salaryRealCurrency();
    // Picking back the native/working currency is treated as null, not an explicit match —
    // same "no conversion" convention the backend already uses.
    this.config.set({ ...cfg, inputCurrency: picked && picked !== working ? picked : null });
  }

  // ── État ───────────────────────────────────────────────────────────────
  readonly config = signal<EmployeePayrollConfigDto | null>(null);
  /** Dernière version chargée / enregistrée — sert à savoir si le formulaire a été modifié
   *  et à annuler les modifications. */
  private readonly savedConfig = signal<EmployeePayrollConfigDto | null>(null);

  /** Jamais enregistrée : la configuration affichée est une proposition par défaut. */
  readonly neverSaved = computed(() => !!this.savedConfig() && this.savedConfig()!.updatedAt == null);

  private static benefitKey(c: EmployeePayrollConfigDto): string {
    return [...c.selectedBenefitCodes].sort().join(',');
  }

  /** Pays, contrat, avantages ou situation familiale modifiés — ce qui change le calcul du
   *  net côté serveur. */
  private readonly calcInputsChanged = computed(() => {
    const a = this.config(), b = this.savedConfig();
    if (!a || !b) return false;
    return a.paysId !== b.paysId || a.contractType !== b.contractType
      || a.isMarried !== b.isMarried || a.childrenCount !== b.childrenCount
      || EmployeeConfigComponent.benefitKey(a) !== EmployeeConfigComponent.benefitKey(b);
  });

  readonly dirty = computed(() => {
    const a = this.config(), b = this.savedConfig();
    if (!a || !b) return false;
    return this.calcInputsChanged()
      || a.currentGrossSalary !== b.currentGrossSalary || a.currentNetSalary !== b.currentNetSalary;
  });
  readonly reason = signal('');
  /** Enregistrement tenté sans motif : l'erreur s'affiche sous le champ. */
  readonly reasonTried = signal(false);
  readonly reasonError = computed(() =>
    this.reasonTried() && this.reason().trim() === '' ? this.t('PAYROLL.EMPLOYEE_CONFIG.REASON_REQUIRED') : undefined);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly calculatingNet = signal(false);
  readonly loadError = signal<string | null>(null);
  /** Refus d'enregistrement (motif du serveur), en bandeau au-dessus des boutons. */
  readonly saveError = signal<string | null>(null);

  // ── Contrat repris de la fiche RH ─────────────────────────────────────────
  /** Contrat de la fiche RH du collaborateur, en code de la paie (« CDI », « CIVP »…). */
  private readonly hrContract = computed(() => {
    const code = this.employee()?.contractType?.trim().toUpperCase();
    return code ? (LEGACY_CONTRACT[code] ?? code) : null;
  });

  /** Aide sous le select du contrat : d'où vient la valeur, ou en quoi elle diffère. */
  readonly contractHint = computed(() => {
    const hr = this.hrContract();
    const current = this.config()?.contractType;
    if (!hr || !current || !this.contractTypes().length) return '';
    return current === hr
      ? this.t('PAYROLL.EMPLOYEE_CONFIG.CONTRACT_FROM_HR')
      : this.t('PAYROLL.EMPLOYEE_CONFIG.CONTRACT_HR_DIFFERS', { contract: contractTypeLabel(hr, this.translate) });
  });

  // ── Contrat hors des règles de paie ─────────────────────────────────────────
  // La liste des contrats reste celle du RH (liste configurable « Type de contrat »), mais
  // seuls ceux que les règles de paie actives du pays tarifent (social_charge_rates) peuvent
  // être enregistrés : un autre contrat donnerait un net et une paie sans charges ni CNSS.
  /** Contrats tarifés par les règles de paie actives du pays ; `null` tant que non chargé
   *  (rien n'est bloqué avant de savoir). */
  readonly pricedContracts = signal<string[] | null>(null);

  /** Le contrat choisi n'a pas de règles de paie dans le pays : message + enregistrement bloqué. */
  readonly contractUnpriced = computed(() => {
    const code = this.config()?.contractType?.trim().toUpperCase();
    const priced = this.pricedContracts();
    return !!code && priced != null && !priced.includes(code);
  });

  readonly contractError = computed(() => {
    if (!this.contractUnpriced()) return '';
    const cfg = this.config()!;
    const ct = this.contractTypes().find(c => c.code === cfg.contractType);
    const contract = ct ? ((this.isEn() ? ct.labelEn : ct.labelFr) || ct.code) : cfg.contractType;
    const priced = this.pricedContracts() ?? [];
    return priced.length
      ? this.t('PAYROLL.EMPLOYEE_CONFIG.CONTRACT_NOT_PRICED', { contract, allowed: priced.join(', ') })
      : this.t('PAYROLL.EMPLOYEE_CONFIG.CONTRACT_NO_RULES', { contract });
  });

  // ── Brut ⇄ net calculés l'un de l'autre ───────────────────────────────────
  // Brut saisi → net recalculé ; net saisi → brut recalculé (calcul inverse du moteur), après
  // une courte pause de frappe, par le serveur. Le brut reste la valeur de référence enregistrée.
  // ⚠ Le serveur calcule avec le pays, le contrat et les avantages ENREGISTRÉS : après un
  // enregistrement qui les change, le net est recalculé et réenregistré (voir `save`).

  private grossTimer: ReturnType<typeof setTimeout> | null = null;
  private netTimer: ReturnType<typeof setTimeout> | null = null;
  readonly calculatingGross = signal(false);
  /** Le moteur n'a pas atteint exactement le net saisi : brut approché. */
  readonly grossApproximate = signal(false);

  /** Aide sous le net : comment il est obtenu, ou pourquoi il n'est pas encore à jour. */
  readonly netHint = computed(() => {
    // Le calcul suit le formulaire : seul un pays non choisi l'empêche.
    if (this.config()?.paysId == null) return this.t('PAYROLL.EMPLOYEE_CONFIG.NET_NEEDS_PAYS');
    if (this.grossApproximate()) return this.t('PAYROLL.EMPLOYEE_CONFIG.GROSS_NOT_CONVERGED');
    return this.t('PAYROLL.EMPLOYEE_CONFIG.NET_AUTO_HINT');
  });

  // ── Historique (versions enregistrées) ───────────────────────────────────
  readonly history = signal<EmployeePayrollConfigHistoryDto[]>([]);
  readonly historyLoading = signal(false);
  /** Nom des auteurs, lu dans le journal d'audit du pays (le service d'historique ne
   *  renvoie que leur id). Vide sans droit d'audit : repli sur « n° id ». */
  private readonly actorNames = signal<Map<number, string>>(new Map());

  private actorLabel(id: number | null): string {
    if (id == null) return '—';
    if (id === this.userStore.currentUser()?.userId) return this.t('PAYROLL.EMPLOYEE_CONFIG.ACTOR_YOU');
    return this.actorNames().get(id) ?? this.t('PAYROLL.EMPLOYEE_CONFIG.ACTOR_ID', { id });
  }

  private dateTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(this.locale(), { dateStyle: 'short', timeStyle: 'short' });
  }

  /** « Modifié le 12/10/2026 14:05 par S. Ben Ali — revalorisation annuelle ». */
  readonly lastChangeText = computed(() => {
    const h = this.history()[0];
    if (!h) return null;
    return this.t('PAYROLL.EMPLOYEE_CONFIG.LAST_CHANGE', {
      date: this.dateTime(h.changedAt), actor: this.actorLabel(h.changedBy),
    }) + (h.reason ? ` — ${h.reason}` : '');
  });

  readonly historyColumns = computed<TableColumn[]>(() => [
    { key: 'date',     label: this.t('PAYROLL.EMPLOYEE_CONFIG.HIST_COL_DATE'), sortable: true,
      sortAccessor: row => row['_at'] as string },
    { key: 'actor',    label: this.t('PAYROLL.EMPLOYEE_CONFIG.HIST_COL_ACTOR'), sortable: true },
    { key: 'gross',    label: this.t('PAYROLL.EMPLOYEE_CONFIG.GROSS_SALARY'), align: 'right' },
    { key: 'net',      label: this.t('PAYROLL.EMPLOYEE_CONFIG.CURRENT_SALARY'), align: 'right' },
    { key: 'contract', label: this.t('PAYROLL.EMPLOYEE_CONFIG.CONTRACT_TYPE') },
    { key: 'benefits', label: this.t('PAYROLL.EMPLOYEE_CONFIG.BENEFITS'), align: 'right' },
    { key: 'reason',   label: this.t('PAYROLL.EMPLOYEE_CONFIG.HIST_COL_REASON') },
  ]);

  readonly historyRows = computed<TableRow[]>(() =>
    this.history().map((h, i) => {
      const cur = EmployeeConfigComponent.realCurrencyFor(
        h.paysId, this.paysList().find(p => p.id === h.paysId)?.devise ?? '');
      return {
        id:       `${h.changedAt}-${i}`,
        _at:      h.changedAt,
        date:     this.dateTime(h.changedAt),
        actor:    this.actorLabel(h.changedBy),
        gross:    this.money(h.currentGrossSalary, cur) ?? '—',
        net:      this.moneyWhole(h.currentNetSalary, cur) ?? '—',
        contract: h.contractType ? contractTypeLabel(h.contractType, this.translate) : '—',
        benefits: String(h.selectedBenefitCodes?.length ?? 0),
        reason:   h.reason || '—',
      };
    }));

  readonly historyTableConfig = computed<TableConfig>(() => ({
    loading: this.historyLoading(),
    skeletonRows: 3,
    emptyMessage: this.t('PAYROLL.EMPLOYEE_CONFIG.HISTORY_EMPTY'),
    hoverable: true,
    defaultSort: { key: 'date', dir: 'desc' },
    ...tableTools(this.translate),
  }));

  // ── Primes ─────────────────────────────────────────────────────────────
  readonly bonuses = signal<EmployeePayrollBonusDto[]>([]);
  readonly bonusesLoading = signal(false);
  readonly addingBonus = signal(false);
  readonly newBonusAmount = signal<number | null>(null);
  readonly newBonusCurrency = signal('TND');
  readonly newBonusMonth = signal<number | null>(new Date().getMonth() + 1);
  readonly newBonusYear = signal<number | null>(new Date().getFullYear());
  readonly newBonusLabel = signal('');
  readonly newBonusComment = signal('');
  /** Les erreurs de champ n'apparaissent qu'après une première tentative d'ajout. */
  readonly bonusSubmitted = signal(false);

  /** Devise du pays enregistré du collaborateur — devise proposée pour une nouvelle prime
   *  (avant : TND pour tout le monde). */
  private readonly countryCurrency = computed(() => {
    const id = this.savedConfig()?.paysId ?? this.config()?.paysId ?? this.employee()?.paysId;
    return this.paysList().find(p => p.id === id)?.devise?.trim().toUpperCase() || null;
  });

  readonly currencyOptions = computed<SelectOption[]>(() => {
    const list = [...BONUS_CURRENCIES];
    const c = this.countryCurrency();
    if (c && !list.includes(c)) list.unshift(c);
    return list.map(code => ({ value: code, label: code }));
  });

  readonly bonusErrors = computed(() => {
    if (!this.bonusSubmitted()) return {};
    const required = this.t('PAYROLL.EMPLOYEE_CONFIG.FIELD_REQUIRED');
    const amount = this.newBonusAmount();
    const year = this.newBonusYear();
    return {
      amount: amount == null ? required
        : amount <= 0 ? this.t('PAYROLL.EMPLOYEE_CONFIG.FIELD_POSITIVE') : undefined,
      month: this.newBonusMonth() == null ? required : undefined,
      year: year == null ? required : undefined,
      label: this.newBonusLabel().trim() === '' ? required : undefined,
    };
  });

  // ── Tableau des primes ─────────────────────────────────────────────────
  readonly bonusColumns = computed<TableColumn[]>(() => [
    // Tri local (les primes du collaborateur arrivent toutes ensemble) ; la période,
    // écrite en toutes lettres, se trie sur AAAA-MM.
    { key: 'period',  label: this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_PERIOD'), sortable: true,
      sortAccessor: row => row['_periodKey'] as string },
    { key: 'label',   label: this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_LABEL'), sortable: true },
    { key: 'comment', label: this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_COMMENT_COL'), sortable: true },
    // Montant brut formaté par la colonne ; une devise commune passe dans le format, sinon
    // chaque ligne affiche la sienne dans une colonne dédiée.
    {
      key: 'amount', label: this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_AMOUNT'), type: 'currency', sortable: true,
      format: { currency: this.bonusCurrency() ?? undefined, minimumFractionDigits: 2, maximumFractionDigits: 2 },
    },
    ...(this.bonusCurrency() == null && this.bonuses().length
      ? [{ key: 'currency', label: this.t('PAYROLL.EMPLOYEE_CONFIG.CURRENCY'), sortable: true }]
      : []),
  ]);

  /** Devise unique des primes enregistrées, ou `null` si elles en mélangent plusieurs. */
  private readonly bonusCurrency = computed(() => {
    const set = new Set(this.bonuses().map(b => b.currency).filter(Boolean));
    return set.size === 1 ? [...set][0] : null;
  });

  readonly bonusRows = computed<TableRow[]>(() =>
    this.bonuses().map(b => ({
      id:      b.id,
      period:  `${this.monthLabel(b.periodMonth)} ${b.periodYear}`,
      _periodKey: `${b.periodYear}-${String(b.periodMonth).padStart(2, '0')}`,
      label:   b.label,
      comment: b.comment || '—',
      amount:  b.amount,
      currency: b.currency || '—',
    })),
  );

  /** Recherche de la barre au-dessus du tableau des primes. */
  readonly bonusSearch = signal('');

  /** Primes filtrées par la recherche — sur le texte affiché : la période en toutes
   *  lettres (pas la clé de tri AAAA-MM) et le montant formaté. */
  readonly filteredBonusRows = computed<TableRow[]>(() =>
    searchTableRows(this.bonusRows(), this.bonusColumns().map(c =>
      c.key === 'period' ? { ...c, sortAccessor: (row: TableRow) => row['period'] as string }
      : c.key === 'amount' ? { ...c, sortAccessor: (row: TableRow) => this.money(row['amount'] as number, row['currency'] === '—' ? '' : row['currency'] as string) }
      : c), this.bonusSearch()),
  );

  /** Outils de tableau communs (`tableTools`) sur le tableau des primes. */
  readonly bonusTableConfig = computed<TableConfig>(() => ({
    actions: this.bonusActions(),
    loading: this.bonusesLoading(),
    skeletonRows: 3,
    emptyMessage: this.t('PAYROLL.EMPLOYEE_CONFIG.NO_BONUSES'),
    ...tableTools(this.translate),
  }));

  readonly bonusActions = computed<TableAction[]>(() => [{
    id: 'delete',
    icon: 'delete',
    variant: 'danger',
    tooltip: this.t('PAYROLL.EMPLOYEE_CONFIG.DELETE_BONUS'),
    onClick: (row: TableRow) => this.confirmDeleteBonus(row['id'] as number),
  }]);

  // ── Formatage ──────────────────────────────────────────────────────────
  money(v: number | null | undefined, currency: string): string | null {
    if (v == null) return null;
    const n = v.toLocaleString(this.locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency ? `${n} ${currency}` : n;
  }

  /** Same as `money()`, but rounded to a whole number — net salary is always shown this way,
   *  display-only (the stored value keeps full precision). */
  moneyWhole(v: number | null | undefined, currency: string): string | null {
    if (v == null) return null;
    const n = Math.round(v).toLocaleString(this.locale(), { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return currency ? `${n} ${currency}` : n;
  }

  monthLabel(month: number): string {
    return this.monthOptions()[month - 1]?.label ?? String(month);
  }

  /** `daf-form-field` émet `string | number | null` — ramené à un nombre ou null. */
  toNumber(v: string | number | null | undefined): number | null {
    if (v == null || v === '') return null;
    const n = +v;
    return Number.isFinite(n) ? n : null;
  }

  // ── Chargement ─────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.payrollApi.listPays().subscribe(pays => this.paysList.set(pays));
    this.payrollApi.listPayrollPays().subscribe(pays => this.payrollPays.set(pays));
    this.payrollApi.getFxRates().subscribe(rates => this.fxRates.set(rates));
    if (Number.isFinite(this.userId)) this.load(this.userId);
    this.loadProfile();
    // Fermeture ou rechargement de l'onglet du navigateur avec des modifications en cours.
    const beforeUnload = (e: BeforeUnloadEvent) => { if (this.dirty()) e.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (this.grossTimer) clearTimeout(this.grossTimer);
      if (this.netTimer) clearTimeout(this.netTimer);
    });
  }

  private load(userId: number): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.svc.get(userId).subscribe({
      next: cfg => {
        this.config.set(cfg);
        this.savedConfig.set(cfg);
        this.loading.set(false);
        // Null on a never-configured employee whose country couldn't be auto-resolved — no
        // benefits list to show until the admin picks one via the country select below.
        if (cfg.paysId != null) {
          this.loadBenefitsFor(cfg.paysId);
          this.loadContractTypesFor(cfg.paysId);
          this.loadActorNames(cfg.paysId);
        }
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(this.t('PAYROLL.EMPLOYEE_CONFIG.LOAD_ERROR'));
      },
    });
    this.loadBonuses(userId);
    this.loadHistory(userId);
  }

  private loadBonuses(userId: number): void {
    this.bonusesLoading.set(true);
    this.svc.getBonuses(userId).subscribe({
      next: list => { this.bonuses.set(list); this.bonusesLoading.set(false); },
      error: () => {
        this.bonusesLoading.set(false);
        this.notify.error(this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_LOAD_ERROR'));
      },
    });
  }

  private loadHistory(userId: number): void {
    this.historyLoading.set(true);
    this.svc.getHistory(userId).subscribe({
      next: list => { this.history.set(list); this.historyLoading.set(false); },
      error: () => { this.history.set([]); this.historyLoading.set(false); },
    });
  }

  /** Noms des auteurs : entrées « configuration » de ce collaborateur dans le journal
   *  d'audit du pays. Silencieux sans droit d'audit (les ids restent affichés). */
  private loadActorNames(paysId: number): void {
    if (!PAYROLL_AUDIT_PERMISSIONS.some(code => this.userStore.hasPermission(code))) return;
    this.payrollApi.getAudit(paysId, 500).subscribe({
      next: entries => {
        const names = new Map(this.actorNames());
        for (const e of entries) {
          if (e.actorId != null && e.actorName) names.set(e.actorId, e.actorName);
        }
        this.actorNames.set(names);
      },
      error: () => { /* noms indisponibles : repli sur l'id */ },
    });
  }

  // ── Formulaire de configuration ────────────────────────────────────────
  onPaysChange(paysId: number): void {
    const cfg = this.config();
    if (!cfg) return;
    this.config.set({ ...cfg, paysId, selectedBenefitCodes: [] });
    this.loadBenefitsFor(paysId);
    this.loadContractTypesFor(paysId);
    this.scheduleNetRecalc();
  }

  onContractTypeChange(contractType: string): void {
    const cfg = this.config();
    if (cfg) this.config.set({ ...cfg, contractType });
    this.scheduleNetRecalc();
  }

  onMarriedChange(isMarried: boolean): void {
    const cfg = this.config();
    if (cfg) this.config.set({ ...cfg, isMarried });
    this.scheduleNetRecalc();
  }

  onChildrenCountChange(childrenCount: number | null): void {
    const cfg = this.config();
    if (cfg) this.config.set({ ...cfg, childrenCount: childrenCount ?? 0 });
    this.scheduleNetRecalc();
  }

  /** Ce que le formulaire AFFICHE (pas forcément enregistré) : le serveur calcule avec,
   *  dès la première saisie — plus besoin d'enregistrer le pays avant. */
  private formValues(cfg: EmployeePayrollConfigDto): CalculationFormValues {
    return {
      paysId: cfg.paysId,
      contractType: cfg.contractType,
      selectedBenefitCodes: cfg.selectedBenefitCodes,
      isMarried: cfg.isMarried,
      childrenCount: cfg.childrenCount,
    };
  }

  /** Empreinte des entrées du calcul : une réponse arrivée après leur changement est périmée. */
  private formKey(cfg: EmployeePayrollConfigDto): string {
    return JSON.stringify({ ...this.formValues(cfg), b: EmployeeConfigComponent.benefitKey(cfg), c: cfg.inputCurrency });
  }

  /** Pays, contrat, avantage ou situation familiale changé : le net suit le brut affiché. */
  private scheduleNetRecalc(): void {
    if (this.config()?.currentGrossSalary == null) return;
    if (this.netTimer) clearTimeout(this.netTimer);
    this.netTyped = null;
    if (this.grossTimer) clearTimeout(this.grossTimer);
    this.grossTimer = setTimeout(() => this.calculateNet(), 600);
  }

  /** Calcul possible : un pays choisi, et un contrat qui a des règles de paie dans ce pays
   *  (sinon le message est déjà sous le select du contrat). */
  private canCalculate(cfg: EmployeePayrollConfigDto | null): cfg is EmployeePayrollConfigDto {
    return cfg !== null && cfg.paysId != null && !this.contractUnpriced();
  }

  /** Brut saisi → net recalculé automatiquement après une courte pause de frappe. */
  onGrossSalaryChange(currentGrossSalary: number | null): void {
    const cfg = this.config();
    if (!cfg) return;
    this.config.set({ ...cfg, currentGrossSalary });
    if (this.grossTimer) clearTimeout(this.grossTimer);
    // La saisie du brut prend la main sur un calcul net → brut en attente.
    if (this.netTimer) clearTimeout(this.netTimer);
    this.netTyped = null;
    this.grossApproximate.set(false);
    if (currentGrossSalary == null) {
      this.config.set({ ...this.config()!, currentNetSalary: null });
      return;
    }
    this.grossTimer = setTimeout(() => this.calculateNet(), 600);
  }

  /** Dernier net saisi (devise affichée) — sert à ignorer une réponse périmée. */
  private netTyped: number | null = null;

  /** Net saisi → brut recalculé automatiquement après une courte pause de frappe. */
  onNetSalaryChange(net: number | null): void {
    if (this.netTimer) clearTimeout(this.netTimer);
    // La saisie du net prend la main sur un calcul brut → net en attente.
    if (this.grossTimer) clearTimeout(this.grossTimer);
    this.netTyped = net;
    if (net == null || net <= 0) return;
    this.netTimer = setTimeout(() => this.calculateGross(net), 600);
  }

  /** Brut donnant le net saisi, par le serveur (calcul inverse), avec les valeurs du
   *  formulaire. Le net affiché devient celui que le moteur obtient avec ce brut. */
  private calculateGross(net: number): void {
    const cfg = this.config();
    if (!this.canCalculate(cfg)) return;
    const key = this.formKey(cfg);
    this.calculatingGross.set(true);
    this.svc.calculateGross(this.userId, net, cfg.inputCurrency, this.formValues(cfg)).subscribe({
      next: res => {
        this.calculatingGross.set(false);
        // Net modifié entre-temps, brut saisi depuis, ou formulaire changé : réponse périmée.
        const current = this.config();
        if (!current || this.netTyped !== net || this.formKey(current) !== key) return;
        this.config.set({ ...current, currentGrossSalary: res.grossSalary, currentNetSalary: res.netInHand });
        this.grossApproximate.set(!res.convergenceOk);
      },
      error: () => {
        this.calculatingGross.set(false);
        this.notify.error(this.t('PAYROLL.EMPLOYEE_CONFIG.GROSS_CALC_ERROR'));
      },
    });
  }

  /** Net du brut courant, par le serveur — avec les valeurs du formulaire (pays, contrat,
   *  avantages, situation familiale). `then` reçoit le net obtenu. */
  calculateNet(then?: (net: number) => void, otherwise?: () => void): void {
    const cfg = this.config();
    if (!this.canCalculate(cfg) || cfg.currentGrossSalary == null) { otherwise?.(); return; }
    const gross = cfg.currentGrossSalary;
    const key = this.formKey(cfg);
    this.calculatingNet.set(true);
    this.svc.calculateNet(this.userId, gross, cfg.inputCurrency, this.formValues(cfg)).subscribe({
      next: res => {
        this.calculatingNet.set(false);
        // Relit la config courante : un brut ou un champ du calcul changé depuis rend ce
        // net périmé (un nouveau calcul est alors déjà programmé).
        const current = this.config();
        if (current && current.currentGrossSalary === gross && this.formKey(current) === key) {
          this.config.set({ ...current, currentNetSalary: res.netInHand });
          then?.(res.netInHand);
        } else {
          otherwise?.();
        }
      },
      error: () => {
        this.calculatingNet.set(false);
        this.notify.error(this.t('PAYROLL.EMPLOYEE_CONFIG.CALCULATE_ERROR'));
        otherwise?.();
      },
    });
  }

  // ── Onglet « Configuration de paie » : résumé en lecture + pop-up de saisie ─────────
  /** Résumé de la configuration affichée (enregistrée, ou en cours de saisie si la pop-up a
   *  été fermée sans enregistrer — le bandeau le signale). */
  readonly configSummary = computed(() => {
    const cfg = this.config();
    if (!cfg) return [];
    const cur = this.salaryRealCurrency();
    type Row = { label: string; value: string };
    const row = (labelKey: string, value: string | null | undefined): Row | null =>
      value == null || value === '' ? null : { label: this.t(labelKey), value };
    const rows = (list: (Row | null)[]) => list.filter((r): r is Row => !!r);
    const pays = this.paysOptions().find(o => o.value === String(cfg.paysId))?.label;
    const contract = this.contractTypeOptions().find(o => o.value === cfg.contractType)?.label
      ?? (cfg.contractType ? contractTypeLabel(cfg.contractType, this.translate) : null);
    const selected = this.benefits().filter(b => cfg.selectedBenefitCodes.includes(b.benefitCode));
    const total = this.benefits().length;
    // Pas de section « Salaire » : brut et net sont déjà les deux premiers KPI, juste au-dessus.
    return [
      {
        id: 'assignment', icon: 'badge', count: '', title: this.t('PAYROLL.EMPLOYEE_CONFIG.SECTION_ASSIGNMENT'), empty: '',
        rows: rows([row('PAYROLL.EMPLOYEE_CONFIG.COUNTRY', pays ?? '—'), row('PAYROLL.EMPLOYEE_CONFIG.CONTRACT_TYPE', contract ?? '—')]),
        diffs: [this.hrContractDiff()].filter((d): d is string => !!d),
      },
      {
        id: 'family', icon: 'family_restroom', count: '', title: this.t('PAYROLL.EMPLOYEE_CONFIG.FAMILY_SECTION'), empty: '',
        rows: rows([
          row('PAYROLL.EMPLOYEE_CONFIG.MARITAL', this.t(`PAYROLL.ENGINE_RESULTS.DETAILS.MARITAL.${cfg.isMarried ? 'MARRIED' : 'SINGLE'}`)),
          row('PAYROLL.EMPLOYEE_CONFIG.CHILDREN_COUNT', String(cfg.childrenCount ?? 0)),
        ]),
        diffs: [this.hrFamilyDiff()].filter((d): d is string => !!d),
      },
      {
        id: 'benefits', icon: 'redeem',
        count: total ? `${selected.length} / ${total}` : '',
        title: this.t('PAYROLL.EMPLOYEE_CONFIG.BENEFITS'),
        empty: this.t('PAYROLL.EMPLOYEE_CONFIG.NO_BENEFIT_SELECTED'),
        rows: selected.map(b => ({ label: this.benefitLabel(b), value: this.money(b.monthlyValue, cur) ?? '—' })),
        diffs: [] as string[],
      },
    ];
  });

  private readonly configFormTpl = viewChild<TemplateRef<unknown>>('configFormTpl');
  private configModalRef: ModalRef | null = null;

  /** Ouvre la saisie. Une saisie interrompue (pop-up fermée par la croix) est reprise telle
   *  quelle ; « Annuler » la remet à la version enregistrée. Boutons dans le corps : ceux de
   *  la pop-up ne sont pas réactifs (chargement, grisé). */
  openConfigForm(): void {
    const tpl = this.configFormTpl();
    if (!tpl || !this.config()) return;
    this.saveError.set(null);
    this.configModalRef = this.modal.open({
      title: this.t('PAYROLL.EMPLOYEE_CONFIG.CONFIG_TITLE'),
      subtitle: this.employeeName(),
      icon: 'manage_accounts',
      size: 'lg',
      closeOnBackdrop: false,
      maximizable: true,
      body: tpl,
      buttons: [],
    });
  }

  cancelConfigForm(): void {
    this.resetConfig();
    this.saveError.set(null);
    this.configModalRef?.close();
    this.configModalRef = null;
  }

  /** Revient à la dernière version enregistrée (référentiels du pays rechargés si besoin). */
  resetConfig(): void {
    const saved = this.savedConfig();
    if (!saved) return;
    const paysChanged = saved.paysId !== this.config()?.paysId;
    this.config.set(saved);
    this.reason.set('');
    this.reasonTried.set(false);
    if (paysChanged && saved.paysId != null) {
      this.loadBenefitsFor(saved.paysId);
      this.loadContractTypesFor(saved.paysId);
    }
  }

  isBenefitSelected(code: string): boolean {
    return this.config()?.selectedBenefitCodes.includes(code) ?? false;
  }

  toggleBenefit(code: string): void {
    const cfg = this.config();
    if (!cfg) return;
    const selected = cfg.selectedBenefitCodes.includes(code)
      ? cfg.selectedBenefitCodes.filter(c => c !== code)
      : [...cfg.selectedBenefitCodes, code];
    this.config.set({ ...cfg, selectedBenefitCodes: selected });
    this.scheduleNetRecalc();
  }

  /**
   * Enregistre la configuration. Sans motif : l'erreur s'affiche sous le champ (le bouton
   * n'est plus grisé sans explication). Si pays, contrat ou avantages ont changé, le net est
   * ensuite recalculé avec la nouvelle configuration et, s'il a bougé, réenregistré avec le
   * même motif — le serveur ne calcule qu'avec la configuration enregistrée.
   */
  save(): void {
    const cfg = this.config();
    if (cfg === null || cfg.paysId == null || this.saving()) return;
    // Contrat sans règles de paie dans le pays : bloqué (le message est sous le select).
    if (this.contractUnpriced()) { this.saveError.set(this.contractError()); return; }
    if (this.reason().trim() === '') { this.reasonTried.set(true); return; }
    if ((cfg.currentGrossSalary ?? 0) < 0 || (cfg.currentNetSalary ?? 0) < 0) {
      this.saveError.set(this.t('PAYROLL.EMPLOYEE_CONFIG.NEGATIVE_SALARY'));
      return;
    }
    const recalc = this.calcInputsChanged() && cfg.currentGrossSalary != null;
    const reason = this.reason().trim();
    this.saveError.set(null);
    this.saving.set(true);
    this.upsert(cfg, reason, updated => {
      if (!recalc) { this.afterSave(); return; }
      this.calculateNet(
        net => {
          if (net === updated.currentNetSalary) { this.afterSave(); return; }
          this.upsert({ ...this.config()!, currentNetSalary: net },
            `${reason} ${this.t('PAYROLL.EMPLOYEE_CONFIG.NET_RECALC_SUFFIX')}`, () => this.afterSave());
        },
        // Recalcul impossible (erreur déjà signalée) : l'enregistrement principal est fait.
        () => this.afterSave(),
      );
    });
  }

  private upsert(cfg: EmployeePayrollConfigDto, reason: string, done: (u: EmployeePayrollConfigDto) => void): void {
    this.svc.upsert(this.userId, {
      paysId: cfg.paysId!,
      contractType: cfg.contractType,
      selectedBenefitCodes: cfg.selectedBenefitCodes,
      currentGrossSalary: cfg.currentGrossSalary,
      currentNetSalary: cfg.currentNetSalary,
      isMarried: cfg.isMarried,
      childrenCount: cfg.childrenCount,
      reason,
      inputCurrency: cfg.inputCurrency,
    }).subscribe({
      next: updated => {
        this.config.set(updated);
        this.savedConfig.set(updated);
        done(updated);
      },
      error: err => {
        const body = (err as { error?: { detail?: string; message?: string } } | null)?.error;
        this.saving.set(false);
        this.saveError.set(body?.detail ?? body?.message ?? this.t('PAYROLL.EMPLOYEE_CONFIG.SAVE_ERROR'));
      },
    });
  }

  private afterSave(): void {
    if (!this.saving()) return;
    this.saving.set(false);
    this.reason.set('');
    this.reasonTried.set(false);
    this.notify.success(this.t('PAYROLL.EMPLOYEE_CONFIG.SAVE_SUCCESS'));
    this.configModalRef?.close();
    this.configModalRef = null;
    this.loadHistory(this.userId);
    const paysId = this.savedConfig()?.paysId;
    if (paysId != null) this.loadActorNames(paysId);
  }

  /** Sortie de la page (`canDeactivate`) avec des modifications non enregistrées : on
   *  demande confirmation dans une pop-up de la lib. */
  canLeave(): boolean | Promise<boolean> {
    if (!this.dirty()) return true;
    return new Promise<boolean>(resolve => {
      let answered = false;
      // La pop-up de la lib est un `<daf-modal-host>` ajouté au document puis retiré à sa
      // fermeture : fermée sans réponse (croix, Échap), on reste sur la page.
      const hosts = () => document.querySelectorAll('daf-modal-host').length;
      const before = hosts();
      this.modal.open({
        title: this.t('PAYROLL.EMPLOYEE_CONFIG.LEAVE_TITLE'),
        icon: 'warning',
        size: 'sm',
        closeOnBackdrop: false,
        body: this.t('PAYROLL.EMPLOYEE_CONFIG.LEAVE_BODY'),
        buttons: [
          { label: this.t('PAYROLL.EMPLOYEE_CONFIG.LEAVE_STAY'), variant: 'secondary',
            action: ref => { answered = true; ref.close(); resolve(false); } },
          { label: this.t('PAYROLL.EMPLOYEE_CONFIG.LEAVE_GO'), variant: 'primary', icon: 'logout',
            action: ref => { answered = true; ref.close(); resolve(true); } },
        ],
      });
      const watch = setInterval(() => {
        if (answered) { clearInterval(watch); return; }
        if (hosts() <= before) { clearInterval(watch); resolve(false); }
      }, 300);
    });
  }

  // ── Primes : modèle des sections /rh/admin — barre + « Ajouter » → pop-up ───────
  private readonly bonusFormTpl = viewChild<TemplateRef<unknown>>('bonusFormTpl');
  private bonusModalRef: ModalRef | null = null;

  openAddBonus(): void {
    const tpl = this.bonusFormTpl();
    if (!tpl) return;
    this.resetBonusForm();
    this.bonusModalRef = this.modal.open({
      title: this.t('PAYROLL.EMPLOYEE_CONFIG.ADD_BONUS'),
      icon: 'redeem',
      size: 'md',
      closeOnBackdrop: false,
      body: tpl,
      buttons: [
        { label: this.t('PAYROLL.EMPLOYEE_CONFIG.CANCEL'), variant: 'secondary',
          action: ref => { ref.close(); this.bonusModalRef = null; } },
        { label: this.t('PAYROLL.EMPLOYEE_CONFIG.ADD_BONUS'), variant: 'primary', icon: 'add',
          action: () => this.addBonus() },
      ],
    });
  }

  addBonus(): void {
    if (this.addingBonus()) return;
    this.bonusSubmitted.set(true);
    const errors = this.bonusErrors();
    if (errors.amount || errors.month || errors.year || errors.label) return;
    this.addingBonus.set(true);
    this.svc.createBonus(this.userId, {
      amount: this.newBonusAmount()!,
      currency: this.newBonusCurrency(),
      periodMonth: this.newBonusMonth()!,
      periodYear: this.newBonusYear()!,
      label: this.newBonusLabel().trim(),
      comment: this.newBonusComment().trim() || null,
    }).subscribe({
      next: created => {
        this.addingBonus.set(false);
        this.bonuses.set([created, ...this.bonuses()]);
        this.bonusModalRef?.close();
        this.bonusModalRef = null;
        this.notify.success(this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_SAVE_SUCCESS'));
      },
      error: () => {
        this.addingBonus.set(false);
        this.notify.error(this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_SAVE_ERROR'));
      },
    });
  }

  /** Formulaire « Nouvelle prime » remis à zéro : période = mois en cours, devise = celle du
   *  pays du collaborateur. */
  resetBonusForm(): void {
    this.newBonusAmount.set(null);
    this.newBonusCurrency.set(this.countryCurrency() ?? 'TND');
    this.newBonusMonth.set(new Date().getMonth() + 1);
    this.newBonusYear.set(new Date().getFullYear());
    this.newBonusLabel.set('');
    this.newBonusComment.set('');
    this.bonusSubmitted.set(false);
  }

  private confirmDeleteBonus(bonusId: number): void {
    const b = this.bonuses().find(x => x.id === bonusId);
    if (!b) return;
    this.modal.open({
      title: this.t('PAYROLL.EMPLOYEE_CONFIG.DELETE_BONUS_TITLE'),
      icon: 'delete',
      size: 'sm',
      body: this.translate.instant('PAYROLL.EMPLOYEE_CONFIG.DELETE_BONUS_BODY', {
        label: b.label,
        amount: this.money(b.amount, b.currency),
        period: `${this.monthLabel(b.periodMonth)} ${b.periodYear}`,
      }),
      buttons: [
        { label: this.t('PAYROLL.EMPLOYEE_CONFIG.CANCEL'), variant: 'secondary', action: ref => ref.close() },
        {
          label: this.t('PAYROLL.EMPLOYEE_CONFIG.DELETE'), variant: 'primary', icon: 'delete',
          action: ref => { ref.close(); this.deleteBonus(bonusId); },
        },
      ],
    });
  }

  private deleteBonus(bonusId: number): void {
    this.svc.deleteBonus(this.userId, bonusId).subscribe({
      next: () => {
        this.bonuses.set(this.bonuses().filter(b => b.id !== bonusId));
        this.notify.success(this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_DELETE_SUCCESS'));
      },
      error: () => this.notify.error(this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_DELETE_ERROR')),
    });
  }

  private loadBenefitsFor(paysId: number): void {
    this.pricedContracts.set(null);
    this.payrollApi.getActiveParameterSet(paysId).subscribe({
      next: ps => {
        this.benefits.set(ps.benefits ?? []);
        this.pricedContracts.set([...new Set((ps.socialChargeRates ?? [])
          .map(r => r.contractType?.trim().toUpperCase()).filter((c): c is string => !!c))]);
      },
      // Pas de règles de paie actives pour ce pays : aucun contrat n'a de règles.
      error: () => { this.benefits.set([]); this.pricedContracts.set([]); },
    });
  }

  /**
   * Contrats du pays. Configuration jamais enregistrée : le contrat de la fiche RH est
   * repris d'office s'il existe dans le pays (la version « enregistrée » de référence suit,
   * pour ne pas afficher « modifications non enregistrées » à l'ouverture).
   */
  private loadContractTypesFor(paysId: number): void {
    this.hrService.getContractTypes(paysId).subscribe({
      next: types => {
        this.contractTypes.set(types);
        const hr = this.hrContract();
        const cfg = this.config();
        if (this.neverSaved() && cfg && hr && cfg.contractType !== hr && types.some(t => t.code === hr)) {
          this.config.set({ ...cfg, contractType: hr });
          const saved = this.savedConfig();
          if (saved) this.savedConfig.set({ ...saved, contractType: hr });
        }
      },
      error: () => this.contractTypes.set([]),
    });
  }
}
