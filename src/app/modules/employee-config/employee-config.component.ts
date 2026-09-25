import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
  SectionCardComponent,
  SelectComponent,
  SkeletonComponent,
  TabsComponent,
  tabParam,
  type TabItem,
  type BreadcrumbItem,
  type SelectOption,
  type TableAction,
  type TableColumn,
  type TableRow,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, BenefitCatalogueDto, PaysDto } from '../../core/payroll-api.service';
import { HrProfileService, HrContractType } from '../../core/hr-profile.service';
import { NotificationService } from '../../core/notification.service';
import {
  EmployeeConfigService, EmployeePayrollConfigDto, EmployeePayrollBonusDto,
} from './employee-config.service';
import { recallEmployee } from './employee-config-employee';

const BONUS_CURRENCIES = ['TND', 'EUR', 'USD', 'EGP', 'SAR', 'AED'];

/**
 * `/payroll/employee-config/:userId` — assign a payroll configuration (country, contract
 * type, benefits-in-kind, salary, bonuses) to one specific employee, opened from the
 * directory `/payroll/employee-config` (`EmployeeConfigListComponent`). The payroll-side twin of
 * daf360-rh-frontend's Rémunération tab — both call the same
 * `GET/PUT /api/payroll/employee-configs/{id}`.
 *
 * En-tête = le collaborateur ouvert, puis deux `daf-tabs` : configuration de paie et primes
 * exceptionnelles, chacune dans une `daf-section-card`. Retours
 * d'action en toasts (`NotificationService` → `daf-toast-host` du shell), suppression
 * confirmée via `ModalService`.
 */
@Component({
  selector: 'app-employee-config',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    ButtonComponent, CardComponent, CheckboxComponent, DataTableComponent, FormFieldComponent,
    PageComponent, PageHeaderComponent, SectionCardComponent,
    SelectComponent, SkeletonComponent, TabsComponent,
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
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.EMPLOYEE_CONFIG.BREADCRUMB'), link: '/payroll/employee-config' },
    { label: this.employeeName() },
  ]);

  /** Matricule · département · pays ; phrase générique si la page est ouverte par lien. */
  readonly employeeSubtitle = computed(() => {
    const e = this.employee();
    const parts = e ? [e.employeeId, e.department, e.paysLabel].filter(Boolean) : [];
    return parts.length ? parts.join(' · ') : this.t('PAYROLL.EMPLOYEE_CONFIG.SUBTITLE');
  });

  // ── Onglets : "Configuration de paie" / "Primes exceptionnelles" — `tabParam` porte
  //    l'onglet actif dans `?tab=` (F5, lien partagé, précédent/suivant), comme parameter-sets.
  readonly activeTab = tabParam(['config', 'bonuses'] as const, 'config');

  readonly tabs = computed<TabItem[]>(() => [
    { id: 'config',  label: this.t('PAYROLL.EMPLOYEE_CONFIG.CONFIG_TITLE'), icon: 'manage_accounts' },
    {
      id: 'bonuses', label: this.t('PAYROLL.EMPLOYEE_CONFIG.BONUSES'), icon: 'redeem',
      // `null` pendant le chargement : l'espace du badge reste réservé, pas de saut.
      count: this.bonusesLoading() ? null : this.bonuses().length,
    },
  ]);

  // ── Référentiels ───────────────────────────────────────────────────────
  readonly contractTypes = signal<HrContractType[]>([]);
  readonly paysList = signal<PaysDto[]>([]);
  readonly benefits = signal<BenefitCatalogueDto[]>([]);

  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})` })),
  );

  readonly contractTypeOptions = computed<SelectOption[]>(() => {
    const en = this.isEn();
    return this.contractTypes().map(ct => ({
      value: ct.code,
      label: (en ? ct.labelEn : ct.labelFr) || ct.code,
    }));
  });

  readonly currencyOptions: SelectOption[] = BONUS_CURRENCIES.map(c => ({ value: c, label: c }));

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

  readonly dirty = computed(() => {
    const a = this.config(), b = this.savedConfig();
    if (!a || !b) return false;
    const codes = (c: EmployeePayrollConfigDto) => [...c.selectedBenefitCodes].sort().join(',');
    return a.paysId !== b.paysId || a.contractType !== b.contractType
      || a.currentGrossSalary !== b.currentGrossSalary || a.currentNetSalary !== b.currentNetSalary
      || codes(a) !== codes(b);
  });
  readonly reason = signal('');

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly calculatingNet = signal(false);
  readonly loadError = signal<string | null>(null);

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

  /** Le formulaire contient une saisie (hors valeurs par défaut) — active « Effacer ». */
  readonly bonusFormTouched = computed(() =>
    this.newBonusAmount() != null || this.newBonusLabel() !== '' || this.newBonusComment() !== ''
    || this.newBonusCurrency() !== 'TND' || this.bonusSubmitted());

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
    { key: 'period',  label: this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_PERIOD') },
    { key: 'label',   label: this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_LABEL') },
    { key: 'comment', label: this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_COMMENT_COL') },
    { key: 'amount',  label: this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_AMOUNT'), align: 'right' },
  ]);

  readonly bonusRows = computed<TableRow[]>(() =>
    this.bonuses().map(b => ({
      id:      b.id,
      period:  `${this.monthLabel(b.periodMonth)} ${b.periodYear}`,
      label:   b.label,
      comment: b.comment || '—',
      amount:  this.money(b.amount, b.currency) ?? '—',
    })),
  );

  readonly bonusActions = computed<TableAction[]>(() => [{
    id: 'delete',
    icon: 'delete',
    variant: 'danger',
    tooltip: this.t('PAYROLL.EMPLOYEE_CONFIG.DELETE_BONUS'),
    onClick: (row: TableRow) => this.confirmDeleteBonus(row['id'] as number),
  }]);

  // ── Formatage ──────────────────────────────────────────────────────────
  private money(v: number | null | undefined, currency: string): string | null {
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
        }
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(this.t('PAYROLL.EMPLOYEE_CONFIG.LOAD_ERROR'));
      },
    });
    this.loadBonuses(userId);
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

  onGrossSalaryChange(currentGrossSalary: number | null): void {
    const cfg = this.config();
    if (cfg) this.config.set({ ...cfg, currentGrossSalary });
  }

  onSalaryChange(currentNetSalary: number | null): void {
    const cfg = this.config();
    if (cfg) this.config.set({ ...cfg, currentNetSalary });
  }

  calculateNet(): void {
    const cfg = this.config();
    if (cfg === null || cfg.currentGrossSalary == null) return;
    this.calculatingNet.set(true);
    this.svc.calculateNet(this.userId, cfg.currentGrossSalary).subscribe({
      next: res => {
        this.calculatingNet.set(false);
        // Relit la config courante : l'utilisateur a pu modifier un autre champ entre-temps.
        const current = this.config();
        if (current) this.config.set({ ...current, currentNetSalary: res.netInHand });
      },
      error: () => {
        this.calculatingNet.set(false);
        this.notify.error(this.t('PAYROLL.EMPLOYEE_CONFIG.CALCULATE_ERROR'));
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

  save(): void {
    const cfg = this.config();
    // cfg.paysId == null is also checked here, not just on the save button's disabled
    // option: this narrows it to `number` for the request below.
    if (cfg === null || cfg.paysId == null || this.reason().trim() === '') return;
    this.saving.set(true);
    this.svc.upsert(this.userId, {
      paysId: cfg.paysId,
      contractType: cfg.contractType,
      selectedBenefitCodes: cfg.selectedBenefitCodes,
      currentGrossSalary: cfg.currentGrossSalary,
      currentNetSalary: cfg.currentNetSalary,
      reason: this.reason(),
    }).subscribe({
      next: updated => {
        this.saving.set(false);
        this.config.set(updated);
        this.savedConfig.set(updated);
        this.reason.set('');
        this.notify.success(this.t('PAYROLL.EMPLOYEE_CONFIG.SAVE_SUCCESS'));
      },
      error: () => {
        this.saving.set(false);
        this.notify.error(this.t('PAYROLL.EMPLOYEE_CONFIG.SAVE_ERROR'));
      },
    });
  }

  // ── Primes ─────────────────────────────────────────────────────────────
  addBonus(): void {
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
        this.resetBonusForm();
        this.notify.success(this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_SAVE_SUCCESS'));
      },
      error: () => {
        this.addingBonus.set(false);
        this.notify.error(this.t('PAYROLL.EMPLOYEE_CONFIG.BONUS_SAVE_ERROR'));
      },
    });
  }

  /** Vide le formulaire « Nouvelle prime » ; période remise au mois en cours. */
  resetBonusForm(): void {
    this.newBonusAmount.set(null);
    this.newBonusCurrency.set('TND');
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

  private loadContractTypesFor(paysId: number): void {
    this.hrService.getContractTypes(paysId).subscribe({
      next: types => this.contractTypes.set(types),
      error: () => this.contractTypes.set([]),
    });
  }
}
