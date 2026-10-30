import { ChangeDetectionStrategy, Component, DestroyRef, TemplateRef, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent,
  CardComponent,
  CheckboxComponent,
  DataTableComponent,
  FormFieldComponent,
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
  type SelectOption,
  type TableAction,
  type TableConfig,
  type TableColumn,
  type TableRow,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, BenefitCatalogueDto, PaysDto } from '../../core/payroll-api.service';
import { HrProfileService, HrContractType, contractTypeLabel } from '../../core/hr-profile.service';
import { AdminSectionHeaderComponent } from '../parameter-sets/admin/admin-section-header.component';
import { NotificationService } from '../../core/notification.service';
import { UserStore } from '../../core/user.store';
import {
  PAYROLL_AUDIT_PERMISSIONS,
} from '../../core/payroll-nav';
import {
  EmployeeConfigService, EmployeePayrollConfigDto, EmployeePayrollBonusDto, EmployeePayrollConfigHistoryDto,
} from './employee-config.service';
import { recallEmployee } from './employee-config-employee';
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
 * En-tête = le collaborateur ouvert (dernière modification, liens vers ses bulletins et son
 * calcul), puis trois `daf-tabs` : configuration de paie, primes exceptionnelles (modèle
 * des sections /rh/admin : barre + « Ajouter » → pop-up), historique des versions.
 * Retours d'action en toasts, suppression et sortie sans enregistrer confirmées via
 * `ModalService`.
 */
@Component({
  selector: 'app-employee-config',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    ButtonComponent, CardComponent, CheckboxComponent, DataTableComponent, FormFieldComponent,
    AdminSectionHeaderComponent, PageComponent, PageHeaderComponent, SearchToolbarComponent, SectionCardComponent,
    SectionTitleComponent, SelectComponent, SkeletonComponent, TabsComponent,
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

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.ADMIN_HOME.TITLE'), link: '/payroll/admin' },
    { label: this.t('PAYROLL.EMPLOYEE_CONFIG.BREADCRUMB'), link: '/payroll/employee-config' },
    { label: this.employeeName() },
  ]);

  /** Matricule · département · pays, puis la dernière modification enregistrée ; phrase
   *  générique si la page est ouverte par lien et jamais configurée. */
  readonly employeeSubtitle = computed(() => {
    const e = this.employee();
    const parts = e ? [e.employeeId, e.department, e.paysLabel].filter(Boolean) as string[] : [];
    const last = this.lastChangeText();
    if (last) parts.push(last);
    return parts.length ? parts.join(' · ') : this.t('PAYROLL.EMPLOYEE_CONFIG.SUBTITLE');
  });

  /** Liens d'en-tête vers les autres écrans du collaborateur, selon les droits. */
  readonly canViewResults = computed(() => this.userStore.hasPermission('PAYROLL_VIEW_RESULTS'));
  readonly canRunEngine   = computed(() => this.userStore.hasPermission('PAYROLL_RUN_ENGINE'));

  openResults(): void {
    this.router.navigate(['/payroll/engine-results', this.userId]);
  }

  /** Calcul de paie, collaborateur et pays pré-sélectionnés (lus par /payroll/engine-run). */
  openEngineRun(): void {
    const paysId = this.savedConfig()?.paysId ?? this.employee()?.paysId ?? null;
    this.router.navigate(['/payroll/engine-run'], {
      queryParams: { employee: this.userId, ...(paysId != null ? { pays: paysId } : {}) },
    });
  }

  // ── Onglets : configuration / primes / historique — `tabParam` porte l'onglet actif
  //    dans `?tab=` (F5, lien partagé, précédent/suivant), comme parameter-sets.
  readonly activeTab = tabParam(['config', 'bonuses', 'history'] as const, 'config');

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
  readonly paysList = signal<PaysDto[]>([]);
  readonly benefits = signal<BenefitCatalogueDto[]>([]);

  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})`, imageUrl: flagDataUri(p.isoCode) })),
  );

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
    const value = this.money(b.monthlyValue, this.salaryCurrency());
    const tax = this.t(b.isTaxable ? 'PAYROLL.SIMULATOR.STEP3.TAXABLE' : 'PAYROLL.SIMULATOR.STEP3.EXEMPT');
    return value ? `${this.t('PAYROLL.EMPLOYEE_CONFIG.BENEFIT_PER_MONTH', { amount: value })} · ${tax}` : tax;
  }

  readonly selectedBenefitCount = computed(() => this.config()?.selectedBenefitCodes.length ?? 0);

  /** Devise du pays choisi dans le formulaire — affichée dans les champs de salaire. */
  readonly salaryCurrency = computed(() => {
    const id = this.config()?.paysId;
    return this.paysList().find(p => p.id === id)?.devise ?? '';
  });

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

  /** Pays, contrat ou avantages modifiés — ce qui change le calcul du net côté serveur. */
  private readonly calcInputsChanged = computed(() => {
    const a = this.config(), b = this.savedConfig();
    if (!a || !b) return false;
    return a.paysId !== b.paysId || a.contractType !== b.contractType
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

  // ── Net calculé automatiquement à partir du brut ──────────────────────────
  // Le net n'est plus saisi : il est recalculé (après une courte pause de frappe) à chaque
  // changement du brut, par le serveur. ⚠ Le serveur calcule avec le pays, le contrat et les
  // avantages ENREGISTRÉS : après un enregistrement qui les change, le net est recalculé et
  // réenregistré (voir `save`).

  private grossTimer: ReturnType<typeof setTimeout> | null = null;

  /** Aide sous le net : comment il est obtenu, ou pourquoi il n'est pas encore à jour. */
  readonly netHint = computed(() => {
    if (this.savedConfig()?.paysId == null) return this.t('PAYROLL.EMPLOYEE_CONFIG.NET_NEEDS_PAYS');
    if (this.calcInputsChanged()) return this.t('PAYROLL.EMPLOYEE_CONFIG.NET_AFTER_SAVE');
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
      const cur = this.paysList().find(p => p.id === h.paysId)?.devise ?? '';
      return {
        id:       `${h.changedAt}-${i}`,
        _at:      h.changedAt,
        date:     this.dateTime(h.changedAt),
        actor:    this.actorLabel(h.changedBy),
        gross:    this.money(h.currentGrossSalary, cur) ?? '—',
        net:      this.money(h.currentNetSalary, cur) ?? '—',
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
    if (Number.isFinite(this.userId)) this.load(this.userId);
    // Fermeture ou rechargement de l'onglet du navigateur avec des modifications en cours.
    const beforeUnload = (e: BeforeUnloadEvent) => { if (this.dirty()) e.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (this.grossTimer) clearTimeout(this.grossTimer);
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
  }

  onContractTypeChange(contractType: string): void {
    const cfg = this.config();
    if (cfg) this.config.set({ ...cfg, contractType });
  }

  /** Brut saisi → net recalculé automatiquement après une courte pause de frappe. */
  onGrossSalaryChange(currentGrossSalary: number | null): void {
    const cfg = this.config();
    if (!cfg) return;
    this.config.set({ ...cfg, currentGrossSalary });
    if (this.grossTimer) clearTimeout(this.grossTimer);
    if (currentGrossSalary == null) {
      this.config.set({ ...this.config()!, currentNetSalary: null });
      return;
    }
    this.grossTimer = setTimeout(() => this.calculateNet(), 600);
  }

  /** Net du brut courant, par le serveur — avec la configuration ENREGISTRÉE (pays, contrat,
   *  avantages). `then` reçoit le net obtenu. */
  calculateNet(then?: (net: number) => void, otherwise?: () => void): void {
    const cfg = this.config();
    if (cfg === null || cfg.currentGrossSalary == null || this.savedConfig()?.paysId == null) { otherwise?.(); return; }
    const gross = cfg.currentGrossSalary;
    this.calculatingNet.set(true);
    this.svc.calculateNet(this.userId, gross).subscribe({
      next: res => {
        this.calculatingNet.set(false);
        // Relit la config courante : l'utilisateur a pu modifier un autre champ entre-temps,
        // et un brut changé depuis rend ce net périmé.
        const current = this.config();
        if (current && current.currentGrossSalary === gross) {
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
      reason,
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
    this.payrollApi.getActiveParameterSet(paysId).subscribe({
      next: ps => this.benefits.set(ps.benefits ?? []),
      error: () => this.benefits.set([]),
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
