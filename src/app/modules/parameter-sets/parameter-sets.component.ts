import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  AccordionCardComponent,
  ButtonComponent,
  CardComponent,
  CheckboxComponent,
  DataTableComponent,
  FormFieldComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  RadioGroupComponent,
  SectionTitleComponent,
  SelectComponent,
  StatusBadgeComponent,
  TabsComponent,
  tabParam,
  type AccordionState,
  type BadgeVariant,
  type BreadcrumbItem,
  type RadioOption,
  type SelectOption,
  type TableColumn,
  type TableRow,
} from '@khalilrebhiitec/daf360';
import {
  PayrollApiService,
  ParameterSetDto,
  PaysDto,
  SocialChargeRateDto,
  SavePayrollRubriqueRequest,
  PayrollRubriqueDto,
} from '../../core/payroll-api.service';
import { NotificationService } from '../../core/notification.service';
import { UserStore } from '../../core/user.store';
import { PAYROLL_CREATE_PARAMSET_PERMISSIONS } from '../../core/payroll-nav';

@Component({
  selector: 'app-parameter-sets',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule, TranslatePipe,
    AccordionCardComponent, ButtonComponent, CardComponent, CheckboxComponent, DataTableComponent,
    FormFieldComponent, MetricCardComponent, PageComponent, PageHeaderComponent, RadioGroupComponent,
    SectionTitleComponent, SelectComponent, StatusBadgeComponent, TabsComponent,
  ],
  templateUrl: './parameter-sets.component.html',
  styleUrl: './parameter-sets.component.scss',
})
export class ParameterSetsComponent implements OnInit {
  private readonly api          = inject(PayrollApiService);
  private readonly fb           = inject(FormBuilder);
  private readonly translate    = inject(TranslateService);
  private readonly userStore    = inject(UserStore);
  private readonly notification = inject(NotificationService);

  // ── Onglets : "Nouveau jeu" (formulaire, ouvert par défaut) / "Jeux existants" (filtre +
  //    liste) — `tabParam` porte l'onglet actif dans `?tab=`, deep-link et retour compris.
  readonly activeTab = tabParam(['create', 'list'] as const, 'create');

  readonly tabs = computed(() => [
    { id: 'create', label: this.t('PAYROLL.ADMIN.CARD_TITLE'), icon: 'add_circle', disabled: !this.canCreate() },
    { id: 'list',   label: this.t('PAYROLL.PARAMETER_SETS.PARAM_SETS_TAB'), icon: 'list_alt' },
  ]);

  // ── Pays : `daf-select`, même besoin déjà couvert par la bibliothèque dans
  //    engine-run/engine-results — liste chargée une fois.
  private readonly paysList = signal<PaysDto[]>([]);
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})` })),
  );

  ngOnInit(): void {
    this.api.listPays().subscribe(list => this.paysList.set(list));
  }

  /** La création reste ouverte qu'aux rôles qui pouvaient déjà y accéder sur l'ancienne
   *  page `/payroll/admin` (le formulaire écrit, l'approbation reste un contrôle serveur
   *  séparé — voir `core/payroll-nav.ts` pour l'historique du code). */
  readonly canCreate = computed(() =>
    PAYROLL_CREATE_PARAMSET_PERMISSIONS.some(code => this.userStore.hasPermission(code)));

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.PARAMETER_SETS.BREADCRUMB') },
  ]);

  /** Même pattern que les autres pages payroll. */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly loading   = signal(false);
  readonly paramSets = signal<ParameterSetDto[]>([]);
  readonly selected  = signal<ParameterSetDto | null>(null);

  // ── Charges sociales editor ───────────────────────────────────────────────
  readonly editingChargesId = signal<number | null>(null);
  readonly savingCharges    = signal(false);

  readonly contractTypes   = ['CDI', 'CDD', 'STAGE', 'CIVP'];
  readonly baseCalcOptions = computed(() => [
    { value: 'GROSS',        label: this.t('PAYROLL.PARAMETER_SETS.BASE_GROSS') },
    { value: 'CAPPED_GROSS', label: this.t('PAYROLL.PARAMETER_SETS.BASE_CAPPED_GROSS') },
    { value: 'FIXED',        label: this.t('PAYROLL.PARAMETER_SETS.BASE_FIXED') },
    { value: 'FORMULE',      label: this.t('PAYROLL.PARAMETER_SETS.BASE_FORMULA') },
  ]);

  readonly chargesForm = this.fb.group({ rates: this.fb.array([]) });
  get editRates(): FormArray { return this.chargesForm.get('rates') as FormArray; }
  editRateGroup(i: number): FormGroup { return this.editRates.at(i) as FormGroup; }

  // ── Rubriques de paie editor ──────────────────────────────────────────────
  readonly editingRubriquesId = signal<number | null>(null);
  readonly savingRubriques    = signal(false);
  readonly expandedRubriques  = signal<Set<number>>(new Set());
  readonly testGross          = signal<number>(3000);

  readonly natureOptions = computed(() => [
    { value: 'AVANTAGE',  label: this.t('PAYROLL.PARAMETER_SETS.NATURE.AVANTAGE.LABEL'),  description: this.t('PAYROLL.PARAMETER_SETS.NATURE.AVANTAGE.DESC') },
    { value: 'INDEMNITE', label: this.t('PAYROLL.PARAMETER_SETS.NATURE.INDEMNITE.LABEL'), description: this.t('PAYROLL.PARAMETER_SETS.NATURE.INDEMNITE.DESC') },
    { value: 'PRIME',     label: this.t('PAYROLL.PARAMETER_SETS.NATURE.PRIME.LABEL'),     description: this.t('PAYROLL.PARAMETER_SETS.NATURE.PRIME.DESC') },
    { value: 'RETENUE',   label: this.t('PAYROLL.PARAMETER_SETS.NATURE.RETENUE.LABEL'),   description: this.t('PAYROLL.PARAMETER_SETS.NATURE.RETENUE.DESC') },
  ]);

  readonly calcModeOptions = computed(() => [
    { value: 'FIXE_MENSUEL',         label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FIXE_MENSUEL.LABEL'),         description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FIXE_MENSUEL.DESC') },
    { value: 'FIXE_JOURNALIER',      label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FIXE_JOURNALIER.LABEL'),      description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FIXE_JOURNALIER.DESC') },
    { value: 'POURCENTAGE_BRUT',     label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_BRUT.LABEL'),     description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_BRUT.DESC') },
    { value: 'POURCENTAGE_CHARGES',  label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_CHARGES.LABEL'),  description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_CHARGES.DESC') },
    { value: 'POURCENTAGE_PLAFONNE', label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_PLAFONNE.LABEL'), description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_PLAFONNE.DESC') },
    { value: 'FORMULE',              label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FORMULE.LABEL'),              description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FORMULE.DESC') },
  ]);

  readonly rubriquesForm = this.fb.group({ items: this.fb.array([]) });
  get editRubriques(): FormArray { return this.rubriquesForm.get('items') as FormArray; }
  editRubriqueGroup(i: number): FormGroup { return this.editRubriques.at(i) as FormGroup; }

  // ── Filter ────────────────────────────────────────────────────────────────
  readonly filterForm = this.fb.group({ paysId: [null as number | null, Validators.required] });

  // ── Création d'un nouveau jeu (onglet "Nouveau jeu") ────────────────────────
  readonly savingNewSet = signal(false);

  readonly newSetForm = this.fb.group({
    paysId:                   [null as number | null, Validators.required],
    fiscalYear:               [new Date().getFullYear(), Validators.required],
    irppBrackets:             ['[]', Validators.required],
    convergenceTolerance:     [0.01],
    maxConvergenceIterations: [50],
    calibrationThresholdPct:  [1.00],
    changeRationale:          [''],
    socialChargeRates:        this.fb.array([]),
  });

  get newSetRates(): FormArray { return this.newSetForm.get('socialChargeRates') as FormArray; }
  newSetRateGroup(i: number): FormGroup { return this.newSetRates.at(i) as FormGroup; }

  addNewSetRate(): void {
    this.newSetRates.push(this.fb.group({
      contractType:    ['CDI'],
      chargeCode:      ['', Validators.required],
      chargeLabel:     ['', Validators.required],
      employeeRate:    [0, [Validators.required, Validators.min(0), Validators.max(1)]],
      employerRate:    [0, [Validators.required, Validators.min(0), Validators.max(1)]],
      baseCalculation: ['GROSS'],
      capAmount:       [null],
    }));
  }

  removeNewSetRate(i: number): void { this.newSetRates.removeAt(i); }

  submitNewSet(): void {
    if (this.newSetForm.invalid) return;
    this.savingNewSet.set(true);

    const raw = this.newSetForm.getRawValue();

    this.api.createParameterSet({
      paysId:                   raw.paysId!,
      fiscalYear:               raw.fiscalYear!,
      irppBrackets:             raw.irppBrackets!,
      convergenceTolerance:     raw.convergenceTolerance!,
      maxConvergenceIterations: raw.maxConvergenceIterations!,
      calibrationThresholdPct:  raw.calibrationThresholdPct!,
      changeRationale:          raw.changeRationale!,
      socialChargeRates:        raw.socialChargeRates as any,
      benefits:                 [],
    } as Partial<ParameterSetDto>).subscribe({
      next: ps => {
        const n = ps.socialChargeRates?.length ?? 0;
        this.notification.success(
          n
            ? this.t('PAYROLL.ADMIN.CREATED_WITH_CHARGES', { version: ps.version, count: n })
            : this.t('PAYROLL.ADMIN.CREATED', { version: ps.version }),
        );
        this.savingNewSet.set(false);
        this.newSetForm.reset({
          paysId: null, fiscalYear: new Date().getFullYear(), irppBrackets: '[]',
          convergenceTolerance: 0.01, maxConvergenceIterations: 50, calibrationThresholdPct: 1.00,
        });
        while (this.newSetRates.length) this.newSetRates.removeAt(0);

        // Bascule vers l'onglet liste, filtrée sur le pays du jeu qu'on vient de créer —
        // même confort que l'ancien panneau, qui l'ajoutait directement à la liste affichée.
        this.filterForm.get('paysId')!.setValue(ps.paysId);
        this.activeTab.set('list');
        this.load();
      },
      error: err => {
        this.notification.error(err?.error?.message ?? this.t('PAYROLL.ADMIN.ERROR'));
        this.savingNewSet.set(false);
      },
    });
  }

  // ── Data loading ──────────────────────────────────────────────────────────
  load(): void {
    const paysId = this.filterForm.get('paysId')?.value;
    if (!paysId) return;
    this.loading.set(true);
    this.api.listParameterSets(paysId).subscribe({
      next: ps => {
        this.paramSets.set(ps);
        this.loading.set(false);
        // Auto-select the first (usually only) parameter set so the detail
        // panel — including Rubriques — is visible without an extra click.
        if (ps.length > 0 && !this.selected()) this.selected.set(ps[0]);
      },
      error: err => {
        this.notification.error(err?.error?.message ?? this.t('PAYROLL.PARAMETER_SETS.ERROR_GENERIC'));
        this.loading.set(false);
      },
    });
  }

  select(ps: ParameterSetDto): void {
    const same = this.selected()?.id === ps.id;
    this.selected.set(same ? null : ps);
    if (same) { this.closeChargesEditor(); this.closeRubriquesEditor(); }
  }

  /** `daf-accordion-card` (openChange) for a parameter-set row — one open at a time,
   *  same semantics as the old `select()` toggle. */
  onAccordionToggle(ps: ParameterSetDto, open: boolean): void {
    if (open) {
      this.selected.set(ps);
    } else {
      this.selected.set(null);
      this.closeChargesEditor();
      this.closeRubriquesEditor();
    }
  }

  itemTitle(ps: ParameterSetDto): string {
    return `v${ps.version} — ${ps.fiscalYear}`;
  }

  /** `daf-accordion-card` `state` for a parameter set — mirrors `statusVariant()`'s
   *  colour so the accent stripe and the status pill never disagree. */
  accordionState(ps: ParameterSetDto): AccordionState {
    switch (ps.status) {
      case 'ACTIVE':          return 'done';
      case 'PENDING_FINANCE': return 'active';
      case 'ARCHIVED':        return 'locked';
      default:                return 'pending'; // DRAFT
    }
  }

  // ── Charges sociales ──────────────────────────────────────────────────────
  openChargesEditor(ps: ParameterSetDto): void {
    if (this.editingChargesId() === ps.id) { this.closeChargesEditor(); return; }
    this.closeRubriquesEditor();
    while (this.editRates.length) this.editRates.removeAt(0);
    ps.socialChargeRates.forEach(r => this.editRates.push(this.fb.group({
      contractType:    [r.contractType],
      chargeCode:      [r.chargeCode,    Validators.required],
      chargeLabel:     [r.chargeLabel,   Validators.required],
      employeeRate:    [r.employeeRate],
      employerRate:    [r.employerRate],
      baseCalculation: [r.baseCalculation ?? 'GROSS'],
      capAmount:       [r.capAmount],
      formulaEe:       [r.formulaEe ?? ''],
      formulaEr:       [r.formulaEr ?? ''],
      evalOrder:       [r.evalOrder ?? 0],
    })));
    this.editingChargesId.set(ps.id);
  }

  private closeChargesEditor(): void {
    this.editingChargesId.set(null);
    while (this.editRates.length) this.editRates.removeAt(0);
  }

  addEditRate(): void {
    this.editRates.push(this.fb.group({
      contractType:    ['CDI'],
      chargeCode:      ['', Validators.required],
      chargeLabel:     ['', Validators.required],
      employeeRate:    [0],
      employerRate:    [0],
      baseCalculation: ['GROSS'],
      capAmount:       [null],
      formulaEe:       [''],
      formulaEr:       [''],
      evalOrder:       [0],
    }));
  }

  removeEditRate(i: number): void { this.editRates.removeAt(i); }

  saveCharges(psId: number): void {
    this.savingCharges.set(true);
    const rates = this.chargesForm.getRawValue().rates as SocialChargeRateDto[];
    this.api.updateSocialChargeRates(psId, rates).subscribe({
      next: updated => {
        this.paramSets.update(ps => ps.map(p => p.id === updated.id ? updated : p));
        this.selected.update(s => s?.id === updated.id ? updated : s);
        this.closeChargesEditor();
        this.savingCharges.set(false);
      },
      error: err => {
        this.notification.error(err?.error?.message ?? this.t('PAYROLL.PARAMETER_SETS.ERROR_SAVE_CHARGES'));
        this.savingCharges.set(false);
      },
    });
  }

  // ── Rubriques de paie ──────────────────────────────────────────────────────
  openRubriquesEditor(ps: ParameterSetDto): void {
    if (this.editingRubriquesId() === ps.id) { this.closeRubriquesEditor(); return; }
    this.closeChargesEditor();
    while (this.editRubriques.length) this.editRubriques.removeAt(0);
    (ps.rubriques ?? []).forEach(r => this.editRubriques.push(this.makeRubriqueGroup(r)));
    // Auto-expand the first card so the form is immediately visible.
    this.expandedRubriques.set(new Set([0]));
    this.editingRubriquesId.set(ps.id);
  }

  private makeRubriqueGroup(r: Partial<PayrollRubriqueDto>): FormGroup {
    return this.fb.group({
      code:                     [r.code     ?? '',           Validators.required],
      labelFr:                  [r.labelFr  ?? '',           Validators.required],
      labelEn:                  [r.labelEn  ?? ''],
      nature:                   [r.nature   ?? 'AVANTAGE'],
      calcMode:                 [r.calcMode ?? 'FIXE_MENSUEL'],
      amount:                   [r.amount   ?? null],
      ratePercent:              [r.rate != null ? +(r.rate * 100).toFixed(4) : null],
      capAmount:                [r.capAmount ?? null],
      formulaExpression:        [r.formulaExpression ?? ''],
      employerSharePct:         [r.employerSharePct  ?? 0],
      employeeSharePct:         [r.employeeSharePct  ?? 0],
      isSubjectToSocialCharges: [r.isSubjectToSocialCharges ?? false],
      isSubjectToIrpp:          [r.isSubjectToIrpp   ?? true],
      ctAll:                    [!r.contractTypes],
      ctCDI:                    [r.contractTypes?.includes('CDI')   ?? false],
      ctCDD:                    [r.contractTypes?.includes('CDD')   ?? false],
      ctSTAGE:                  [r.contractTypes?.includes('STAGE') ?? false],
      ctCIVP:                   [r.contractTypes?.includes('CIVP')  ?? false],
      isActive:                 [r.isActive  ?? true],
    });
  }

  private closeRubriquesEditor(): void {
    this.editingRubriquesId.set(null);
    this.expandedRubriques.set(new Set());
    while (this.editRubriques.length) this.editRubriques.removeAt(0);
  }

  addEditRubrique(): void {
    this.editRubriques.push(this.makeRubriqueGroup({}));
    const newIndex = this.editRubriques.length - 1;
    const s = new Set(this.expandedRubriques());
    s.add(newIndex);
    this.expandedRubriques.set(s);
  }

  removeEditRubrique(i: number): void {
    this.editRubriques.removeAt(i);
    const updated = new Set<number>();
    this.expandedRubriques().forEach(idx => {
      if (idx < i) updated.add(idx);
      else if (idx > i) updated.add(idx - 1);
    });
    this.expandedRubriques.set(updated);
  }

  saveRubriques(psId: number): void {
    this.savingRubriques.set(true);
    const raw = this.rubriquesForm.getRawValue().items as any[];
    const payload: SavePayrollRubriqueRequest[] = raw.map((r, idx) => ({
      code:                     r.code,
      labelFr:                  r.labelFr,
      labelEn:                  r.labelEn?.trim() || null,
      nature:                   r.nature,
      calcMode:                 r.calcMode,
      amount:                   r.amount,
      rate:                     r.ratePercent != null ? r.ratePercent / 100 : null,
      capAmount:                r.capAmount,
      formulaExpression:        r.calcMode === 'FORMULE' ? (r.formulaExpression?.trim() || null) : null,
      displayOrder:             idx,
      employerSharePct:         r.employerSharePct ?? 0,
      employeeSharePct:         r.employeeSharePct ?? 0,
      isSubjectToSocialCharges: r.isSubjectToSocialCharges,
      isSubjectToIrpp:          r.isSubjectToIrpp,
      direction:                r.nature === 'RETENUE' ? 'DEBIT' : 'CREDIT',
      contractTypes:            r.ctAll ? null :
        (['CDI', 'CDD', 'STAGE', 'CIVP'] as const)
          .filter((t: string) => r['ct' + t] === true)
          .join(',') || null,
      isActive:                 r.isActive,
    }));
    this.api.updateRubriques(psId, payload).subscribe({
      next: updated => {
        this.paramSets.update(ps => ps.map(p => p.id === updated.id ? updated : p));
        this.selected.update(s => s?.id === updated.id ? updated : s);
        this.closeRubriquesEditor();
        this.savingRubriques.set(false);
      },
      error: err => {
        this.notification.error(err?.error?.message ?? this.t('PAYROLL.PARAMETER_SETS.ERROR_SAVE_RUBRIQUES'));
        this.savingRubriques.set(false);
      },
    });
  }

  // ── Workflow ───────────────────────────────────────────────────────────────
  submit(id: number): void {
    this.api.submitParameterSet(id).subscribe({
      next: updated => this.paramSets.update(ps => ps.map(p => p.id === updated.id ? updated : p)),
    });
  }

  approveHr(id: number): void {
    this.api.approveHr(id).subscribe({
      next: updated => this.paramSets.update(ps => ps.map(p => p.id === updated.id ? updated : p)),
    });
  }

  approveFinance(id: number): void {
    this.api.approveFinance(id).subscribe({
      next: updated => this.paramSets.update(ps => ps.map(p => p.id === updated.id ? updated : p)),
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  statusLabel(ps: ParameterSetDto): string {
    switch (ps.status) {
      case 'DRAFT':    return this.t('PAYROLL.PARAMETER_SETS.STATUS.DRAFT');
      case 'ACTIVE':   return this.t('PAYROLL.PARAMETER_SETS.STATUS.ACTIVE');
      case 'ARCHIVED': return this.t('PAYROLL.PARAMETER_SETS.STATUS.ARCHIVED');
      case 'PENDING_FINANCE': {
        const dirOk  = ps.approvedByHr      != null;
        const dafOk  = ps.approvedByFinance != null;
        if (dirOk && !dafOk)  return this.t('PAYROLL.PARAMETER_SETS.STATUS_HR_OK_WAITING_DAF');
        if (!dirOk && dafOk)  return this.t('PAYROLL.PARAMETER_SETS.STATUS_DAF_OK_WAITING_HR');
        return this.t('PAYROLL.PARAMETER_SETS.STATUS_SUBMITTED_WAITING');
      }
      default: return ps.status;
    }
  }

  statusClass(ps: ParameterSetDto): string {
    switch (ps.status) {
      case 'DRAFT':           return 'badge badge--draft';
      case 'PENDING_FINANCE': return 'badge badge--pending';
      case 'ACTIVE':          return 'badge badge--active';
      case 'ARCHIVED':        return 'badge badge--archived';
      default:                return 'badge';
    }
  }

  natureClass(nature: string): string {
    switch (nature) {
      case 'AVANTAGE':  return 'badge badge--avantage';
      case 'INDEMNITE': return 'badge badge--indemnite';
      case 'PRIME':     return 'badge badge--prime';
      case 'RETENUE':   return 'badge badge--retenue';
      default:          return 'badge';
    }
  }

  directionClass(direction: string): string {
    return direction === 'CREDIT' ? 'badge badge--credit' : 'badge badge--debit';
  }

  formatCalcMode(calcMode: string): string {
    const key = `PAYROLL.PARAMETER_SETS.CALC_MODE_SHORT.${calcMode}`;
    const label = this.t(key);
    return label === key ? calcMode : label;
  }

  // ── daf-badge / daf-select / daf-radio-group option mappers ────────────────
  statusVariant(ps: ParameterSetDto): BadgeVariant {
    switch (ps.status) {
      case 'ACTIVE':          return 'success';
      case 'ARCHIVED':        return 'neutral';
      case 'PENDING_FINANCE': return 'warning';
      default:                return 'neutral'; // DRAFT
    }
  }

  natureVariant(nature: string): BadgeVariant {
    switch (nature) {
      case 'PRIME':     return 'success';
      case 'AVANTAGE':  return 'info';
      case 'INDEMNITE': return 'warning';
      case 'RETENUE':   return 'danger';
      default:          return 'neutral';
    }
  }

  directionVariant(direction: string): BadgeVariant {
    return direction === 'CREDIT' ? 'success' : 'danger';
  }

  readonly contractTypeOptions = computed<SelectOption[]>(() =>
    this.contractTypes.map(ct => ({ value: ct, label: ct })));

  readonly natureRadioOptions = computed<RadioOption[]>(() =>
    this.natureOptions().map(o => ({ value: o.value, label: o.label, hint: o.description })));

  readonly calcModeRadioOptions = computed<RadioOption[]>(() =>
    this.calcModeOptions().map(o => ({ value: o.value, label: o.label, hint: o.description })));

  // ── daf-data-table columns/rows — charges (read-only) ───────────────────────
  readonly chargesColumns = computed<TableColumn[]>(() => [
    { key: 'contractType', label: this.t('PAYROLL.PARAMETER_SETS.COL_TYPE'), type: 'badge' },
    { key: 'chargeCode',   label: this.t('PAYROLL.PARAMETER_SETS.COL_CODE') },
    { key: 'chargeLabel',  label: this.t('PAYROLL.PARAMETER_SETS.COL_LABEL') },
    { key: 'employeeShare', label: this.t('PAYROLL.PARAMETER_SETS.COL_EMPLOYEE_SHARE'), align: 'right' },
    { key: 'employerShare', label: this.t('PAYROLL.PARAMETER_SETS.COL_EMPLOYER_SHARE'), align: 'right' },
    { key: 'baseCalculation', label: this.t('PAYROLL.PARAMETER_SETS.COL_BASE') },
  ]);

  chargesRows(ps: ParameterSetDto): TableRow[] {
    return (ps.socialChargeRates ?? []).map(r => ({
      id:              r.chargeCode,
      contractType:    { label: r.contractType, options: { variant: 'neutral' as BadgeVariant, size: 'sm' as const } },
      chargeCode:      r.chargeCode,
      chargeLabel:     r.chargeLabel,
      employeeShare:   r.baseCalculation === 'FORMULE' ? (r.formulaEe || '—') : `${(r.employeeRate * 100).toFixed(2)}%`,
      employerShare:   r.baseCalculation === 'FORMULE' ? (r.formulaEr || '—') : `${(r.employerRate * 100).toFixed(2)}%`,
      baseCalculation: r.baseCalculation,
    }));
  }

  /**
   * KPI de synthèse affichées au-dessus du tableau des cotisations : somme des taux
   * salariaux/patronaux (hors lignes FORMULE, dont le taux n'est pas un nombre fixe) et
   * coin fiscal global = les deux additionnés. Purement une lecture visuelle des mêmes
   * données déjà dans le tableau — aucun champ ni logique métier ajoutée.
   */
  chargeTotals(ps: ParameterSetDto): { employeeTotal: number; employerTotal: number; wedge: number } {
    const rates = (ps.socialChargeRates ?? []).filter(r => r.baseCalculation !== 'FORMULE');
    const employeeTotal = rates.reduce((sum, r) => sum + (r.employeeRate ?? 0), 0) * 100;
    const employerTotal = rates.reduce((sum, r) => sum + (r.employerRate ?? 0), 0) * 100;
    return { employeeTotal, employerTotal, wedge: employeeTotal + employerTotal };
  }

  // ── Éditeur JSON du barème IRPP (onglet "Nouveau jeu") ──────────────────────
  isJsonValid(raw: string | null | undefined): boolean {
    if (!raw) return false;
    try { JSON.parse(raw); return true; } catch { return false; }
  }

  /** Reformate le JSON du barème IRPP avec une indentation de 2 espaces. Ne fait rien
   *  si le JSON est invalide — le badge de validation le signale déjà. */
  formatIrppJson(): void {
    const ctrl = this.newSetForm.get('irppBrackets')!;
    try {
      const parsed = JSON.parse(ctrl.value ?? '[]');
      ctrl.setValue(JSON.stringify(parsed, null, 2));
    } catch {
      // JSON invalide : rien à reformater, le badge "Invalide" reste affiché.
    }
  }

  // ── daf-data-table columns/rows — benefits (read-only, legacy) ──────────────
  readonly benefitsColumns = computed<TableColumn[]>(() => [
    { key: 'benefitCode',   label: this.t('PAYROLL.PARAMETER_SETS.COL_CODE') },
    { key: 'benefitLabelFr', label: this.t('PAYROLL.PARAMETER_SETS.COL_LABEL') },
    { key: 'monthlyValue',  label: this.t('PAYROLL.PARAMETER_SETS.COL_MONTHLY_VALUE'), type: 'number', align: 'right', format: { minimumFractionDigits: 0, maximumFractionDigits: 0 } },
    { key: 'taxable',       label: this.t('PAYROLL.PARAMETER_SETS.COL_TAXABLE') },
  ]);

  benefitsRows(ps: ParameterSetDto): TableRow[] {
    return (ps.benefits ?? []).map(b => ({
      id:             b.benefitCode,
      benefitCode:    b.benefitCode,
      benefitLabelFr: b.benefitLabelFr,
      monthlyValue:   b.monthlyValue,
      taxable:        this.t(b.isTaxable ? 'PAYROLL.PARAMETER_SETS.YES' : 'PAYROLL.PARAMETER_SETS.NO'),
    }));
  }

  // ── daf-data-table columns/rows — rubriques (read-only) ─────────────────────
  readonly rubriquesColumns = computed<TableColumn[]>(() => [
    { key: 'code',          label: this.t('PAYROLL.PARAMETER_SETS.COL_CODE') },
    { key: 'labelFr',       label: this.t('PAYROLL.PARAMETER_SETS.COL_LABEL') },
    { key: 'nature',        label: this.t('PAYROLL.PARAMETER_SETS.COL_NATURE'), type: 'badge' },
    { key: 'calcMode',      label: this.t('PAYROLL.PARAMETER_SETS.COL_CALC_MODE') },
    { key: 'valueRate',     label: this.t('PAYROLL.PARAMETER_SETS.COL_VALUE_RATE'), align: 'right' },
    { key: 'direction',     label: this.t('PAYROLL.PARAMETER_SETS.COL_DIRECTION'), type: 'badge' },
    { key: 'irpp',          label: this.t('PAYROLL.PARAMETER_SETS.COL_IRPP'), align: 'center' },
    { key: 'charges',       label: this.t('PAYROLL.PARAMETER_SETS.COL_CHARGES'), align: 'center' },
    { key: 'contractTypes', label: this.t('PAYROLL.PARAMETER_SETS.COL_CONTRACTS') },
    { key: 'active',        label: this.t('PAYROLL.PARAMETER_SETS.COL_ACTIVE'), align: 'center' },
  ]);

  rubriquesRows(ps: ParameterSetDto): TableRow[] {
    return (ps.rubriques ?? []).map(r => ({
      id:            r.code,
      code:          r.code,
      labelFr:       r.labelFr,
      nature:        { label: this.natureLabel(r.nature), options: { variant: this.natureVariant(r.nature), size: 'sm' as const } },
      calcMode:      this.formatCalcMode(r.calcMode),
      valueRate:     this.rubriqueValue(r),
      direction:     { label: r.direction, options: { variant: this.directionVariant(r.direction), size: 'sm' as const } },
      irpp:          r.isSubjectToIrpp ? '✓' : '—',
      charges:       r.isSubjectToSocialCharges ? '✓' : '—',
      contractTypes: r.contractTypes || this.t('PAYROLL.PARAMETER_SETS.CONTRACTS_ALL'),
      active:        r.isActive ? '✓' : '—',
    }));
  }

  private get numberLocale(): string {
    return this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR';
  }

  rubriqueValue(r: { calcMode: string; amount: number | null; rate: number | null; capAmount?: number | null; formulaExpression?: string | null }, devise: string = ''): string {
    if (r.calcMode === 'FORMULE') {
      return r.formulaExpression ? `= ${r.formulaExpression}` : this.t('PAYROLL.PARAMETER_SETS.FORMULA_EMPTY');
    }
    if (r.calcMode === 'FIXE_MENSUEL' || r.calcMode === 'FIXE_JOURNALIER') {
      return r.amount != null
        ? `${r.amount.toLocaleString(this.numberLocale)}${r.calcMode === 'FIXE_JOURNALIER' ? this.t('PAYROLL.PARAMETER_SETS.PER_DAY_SUFFIX') : ''}`
        : '—';
    }
    if (r.rate != null) {
      const pct = `${(r.rate * 100).toFixed(2)} %`;
      return (r.calcMode === 'POURCENTAGE_PLAFONNE' && r.capAmount != null)
        ? `${pct} ${this.t('PAYROLL.PARAMETER_SETS.CAP_SUFFIX', { cap: r.capAmount.toLocaleString(this.numberLocale) })}`
        : pct;
    }
    return '—';
  }

  // ── Formula mode helpers ───────────────────────────────────────────────────

  /**
   * Returns the set of formula variable chips for the selected parameter set:
   * BRUT, CHARGES_EE/ER, and one _EE/_ER pair per distinct charge code.
   */
  formulaVariableHints(): { name: string; desc: string }[] {
    const ps = this.selected();
    const hints: { name: string; desc: string }[] = [
      { name: 'BRUT',       desc: this.t('PAYROLL.PARAMETER_SETS.VAR_GROSS_DESC') },
      { name: 'CHARGES_EE', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_CHARGES_EE_DESC') },
      { name: 'CHARGES_ER', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_CHARGES_ER_DESC') },
    ];
    const seen = new Set<string>();
    (ps?.socialChargeRates ?? []).forEach(r => {
      const key = r.chargeCode.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({ name: key + '_EE', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_EE_DESC', { label: r.chargeLabel }) });
        hints.push({ name: key + '_ER', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_ER_DESC', { label: r.chargeLabel }) });
      }
    });
    return hints;
  }

  /**
   * Returns variable chips for rubriques that appear before position `currentIndex`
   * in the list (lower display_order → referenceable by later FORMULE rubriques).
   */
  priorRubriqueVars(currentIndex: number): { name: string; desc: string }[] {
    return this.editRubriques.controls
      .slice(0, currentIndex)
      .map((ctrl, i) => {
        const g = ctrl as FormGroup;
        const code  = (g.get('code')!.value as string  || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
        const label =  g.get('labelFr')!.value as string || this.t('PAYROLL.PARAMETER_SETS.RUBRIQUE_FALLBACK_LABEL', { n: i + 1 });
        return code ? { name: code, desc: label } : null;
      })
      .filter((v): v is { name: string; desc: string } => v !== null);
  }

  /** Appends a variable name into the formulaExpression field of card i. */
  insertFormulaVar(i: number, varName: string): void {
    const ctrl = this.editRubriqueGroup(i).get('formulaExpression')!;
    const current: string = ctrl.value ?? '';
    ctrl.setValue(current ? `${current} + ${varName}` : varName);
    ctrl.markAsDirty();
  }

  // ── Charge formula helpers ─────────────────────────────────────────────────

  /**
   * Returns variable chips available to the formula of charge at position `i`.
   * A charge can reference BRUT and the results of charges that appear BEFORE it
   * in the list (i.e. have a lower eval_order / earlier position).
   */
  chargeVariableHints(currentIndex: number): { name: string; desc: string }[] {
    const hints: { name: string; desc: string }[] = [
      { name: 'BRUT', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_GROSS_DESC') },
    ];
    this.editRates.controls.slice(0, currentIndex).forEach(ctrl => {
      const g = ctrl as FormGroup;
      const code  = ((g.get('chargeCode')!.value as string) || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const label =   g.get('chargeLabel')!.value as string || '';
      if (code) {
        hints.push({ name: code + '_EE', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_EE_DESC', { label }) });
        hints.push({ name: code + '_ER', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_ER_DESC', { label }) });
      }
    });
    return hints;
  }

  /** Appends a variable name into the formulaEe or formulaEr field of charge row i. */
  insertChargeFormulaVar(i: number, side: 'formulaEe' | 'formulaEr', varName: string): void {
    const ctrl = this.editRateGroup(i).get(side)!;
    const current: string = ctrl.value ?? '';
    ctrl.setValue(current ? `${current} + ${varName}` : varName);
    ctrl.markAsDirty();
  }

  toggleRubriqueCard(i: number): void {
    const s = new Set(this.expandedRubriques());
    if (s.has(i)) { s.delete(i); } else { s.add(i); }
    this.expandedRubriques.set(s);
  }

  isRubriqueExpanded(i: number): boolean {
    return this.expandedRubriques().has(i);
  }

  natureLabel(value: string): string {
    return this.natureOptions().find(o => o.value === value)?.label ?? value;
  }

  /** `daf-accordion-card` `icon` for a rubrique card, by nature. */
  rubriqueIcon(nature: string): string {
    switch (nature) {
      case 'PRIME':     return 'star';
      case 'INDEMNITE': return 'payments';
      case 'RETENUE':   return 'remove_circle';
      default:          return 'redeem'; // AVANTAGE
    }
  }

  /** `daf-accordion-card` `state` for a rubrique card — mirrors `natureVariant()`'s
   *  colour, dimmed to `locked` when the rubrique is inactive. */
  rubriqueAccordionState(nature: string, isActive: boolean): AccordionState {
    if (!isActive) return 'locked';
    switch (nature) {
      case 'PRIME':     return 'done';
      case 'INDEMNITE': return 'active';
      case 'RETENUE':   return 'blocked';
      default:          return 'pending'; // AVANTAGE
    }
  }

  calcModeLabel(value: string): string {
    return this.calcModeOptions().find(o => o.value === value)?.label ?? value;
  }

  previewAmount(i: number): string {
    const g = this.editRubriqueGroup(i).getRawValue();
    const gross = this.testGross();
    let amount = 0;
    switch (g['calcMode']) {
      case 'FIXE_MENSUEL':
      case 'FIXE_JOURNALIER':
        amount = g['amount'] ?? 0;
        break;
      case 'POURCENTAGE_BRUT':
      case 'POURCENTAGE_CHARGES':
        amount = gross * (g['ratePercent'] ?? 0) / 100;
        break;
      case 'POURCENTAGE_PLAFONNE': {
        const cap: number = g['capAmount'] ?? gross;
        amount = Math.min(gross, cap) * (g['ratePercent'] ?? 0) / 100;
        break;
      }
      case 'FORMULE':
        // Cannot evaluate formula without charge context — simulation shows the real value
        return '—';
    }
    return amount.toLocaleString(this.numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
