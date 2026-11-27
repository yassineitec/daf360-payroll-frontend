import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { flagEntity, injectHeaderPays } from '../../core/header-pays';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { contractTypeLabel, EmployeeListItem, HrContractType, HrProfileService } from '../../core/hr-profile.service';
import { HrRefApiService, RefDataItemDto } from '../../core/hr-ref-api.service';
import {
  CohortAggregateResponse,
  CohortMessage,
  EmployeeWhatIfResponse,
  EmployeeWhatIfRow,
  PayrollApiService,
  PaysDto,
  WhatIfFigures,
} from '../../core/payroll-api.service';
import { UserStore } from '../../core/user.store';
import { tableTools } from '../../shared/table-tools';
import {
  ButtonComponent,
  CardComponent,
  CheckboxComponent,
  DataTableComponent,
  FormFieldComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  RadioGroupComponent,
  SelectComponent,
  type BreadcrumbItem,
  type MetricDelta,
  type RadioOption,
  type SelectOption,
  type TableColumn,
  type TableConfig,
  type TableRow,
} from '@khalilrebhiitec/daf360';

type ScopeMode = 'GROUP' | 'EMPLOYEE';
type ChangeType = 'PERCENT' | 'AMOUNT';
type SalaryBase = 'NET' | 'GROSS';

/** One line of the single-employee comparison: a stratum or a charge, current → new. */
interface StratumLine { key: string; label: string; current: number; projected: number; }

/**
 * `/payroll/cohort` — salary what-if on a group of employees or on one employee (B3).
 *
 * Who sees what is decided by the server (DEC1): `visibility = AGGREGATE` responses carry
 * totals only, and no amount below the minimum group size (`suppressed`). The per-employee
 * table and the "one employee" mode are only offered to PAYROLL_VIEW_INDIVIDUAL holders —
 * the server refuses them to anyone else anyway (403).
 *
 * All amounts come unrounded from the API and are rounded here for display (DEC14).
 */
@Component({
  selector: 'app-cohort',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    ButtonComponent, CardComponent, CheckboxComponent, DataTableComponent, FormFieldComponent, MetricCardComponent,
    PageComponent, PageHeaderComponent, RadioGroupComponent, SelectComponent,
  ],
  templateUrl: './cohort.component.html',
  styleUrl: './cohort.component.scss',
})
export class CohortComponent implements OnInit {
  private readonly api       = inject(PayrollApiService);
  private readonly hrRef     = inject(HrRefApiService);
  private readonly hrProfile = inject(HrProfileService);
  private readonly userStore = inject(UserStore);
  private readonly translate = inject(TranslateService);

  contractLabel(code: string): string {
    this.translate.currentLang();
    return contractTypeLabel(code, this.translate);
  }

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  private isEn(): boolean {
    return (this.translate.currentLang() ?? '').startsWith('en');
  }

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.COHORT.BREADCRUMB') },
  ]);

  /** PAYROLL_VIEW_INDIVIDUAL (or admin): per-employee table and "one employee" mode. */
  readonly canSeeIndividuals = computed(() => {
    this.userStore.permissions();
    return this.userStore.hasPermission('PAYROLL_VIEW_INDIVIDUAL');
  });

  readonly loading  = signal(false);
  readonly error    = signal<string | null>(null);
  readonly result   = signal<CohortAggregateResponse | null>(null);
  readonly employeeResult = signal<EmployeeWhatIfResponse | null>(null);

  // ── Coverage (pre-merge 2b): figures dimmed until acknowledged when coverage is low ──
  /** Client-side only: ticking it changes nothing in the totals, it only un-dims them. */
  readonly coverageAck = signal(false);
  readonly lowCoverage = computed(() => {
    const r = this.result();
    if (!r) return false;
    if ((r.messages ?? []).some(m => m.code === 'LOW_COVERAGE')) return true;
    return r.coverage != null && r.minCoverage != null && r.coverage < r.minCoverage;
  });
  readonly figuresDimmed = computed(() => this.lowCoverage() && !this.coverageAck());

  // ── Scope ─────────────────────────────────────────────────────────────────
  private readonly paysList = signal<PaysDto[]>([]);
  /**
   * Le pays de la page — UN seul, tiré des drapeaux de la barre (même règle que /rh/admin et
   * /payroll/simulator : un drapeau → ce pays ; aucun → le pays de l'utilisateur ; plusieurs →
   * le sien s'il est coché, sinon le premier coché). Le champ « Pays » l'affiche, grisé : pour
   * un autre pays, on change les drapeaux. null = pas encore connu.
   * Avant (2026-11-25) : une liste « Pays » propre à la page, vide au départ.
   */
  private readonly headerPays = injectHeaderPays();
  readonly paysId = computed<number | null>(() => flagEntity(
    this.headerPays(),
    this.userStore.currentUser()?.paysId ?? this.paysList()[0]?.id ?? null));
  /** Une seule option : le pays retenu (le champ est en lecture seule). */
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().filter(p => p.id === this.paysId())
      .map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})` })),
  );
  /**
   * Autre pays (drapeaux de la barre) → les filtres, l'employé et les résultats affichés
   * étaient ceux de l'ancien : on les efface et on recharge les référentiels du nouveau.
   * Remplace l'ancien `setPays()` de la liste « Pays » propre à la page.
   */
  private shownPays: number | null | undefined = undefined;
  private readonly followPays = effect(() => {
    const id = this.paysId();
    untracked(() => {
      if (id === this.shownPays) return;
      this.shownPays = id;
      this.grade.set(''); this.discipline.set(''); this.contractType.set(''); this.employeeId.set(null);
      this.result.set(null); this.employeeResult.set(null); this.error.set(null);
      this.loadReferences(id);
    });
  });

  readonly scopeMode = signal<ScopeMode>('GROUP');
  readonly scopeOptions = computed((): RadioOption[] => [
    { value: 'GROUP',    label: this.t('PAYROLL.COHORT.SCOPE_GROUP'),    hint: this.t('PAYROLL.COHORT.SCOPE_GROUP_HINT') },
    { value: 'EMPLOYEE', label: this.t('PAYROLL.COHORT.SCOPE_EMPLOYEE'), hint: this.t('PAYROLL.COHORT.SCOPE_EMPLOYEE_HINT') },
  ]);

  readonly grade         = signal('');
  readonly discipline    = signal('');
  readonly contractType  = signal('');
  readonly employeeId    = signal<number | null>(null);

  private readonly grades        = signal<RefDataItemDto[]>([]);
  private readonly disciplines   = signal<RefDataItemDto[]>([]);
  private readonly contractTypes = signal<HrContractType[]>([]);
  private readonly employees     = signal<EmployeeListItem[]>([]);
  readonly refsLoading = signal(false);

  private refLabel(i: RefDataItemDto): string {
    return (this.isEn() && i.labelEn) || i.labelFr || i.code;
  }

  readonly gradeOptions = computed<SelectOption[]>(() => [
    { value: '', label: this.t('PAYROLL.COHORT.ALL') },
    ...this.grades().map(g => ({ value: g.code, label: `${this.refLabel(g)} (${g.code})` })),
  ]);
  readonly disciplineOptions = computed<SelectOption[]>(() => [
    { value: '', label: this.t('PAYROLL.COHORT.ALL') },
    ...this.disciplines().map(d => ({ value: d.code, label: this.refLabel(d) })),
  ]);
  readonly contractTypeOptions = computed<SelectOption[]>(() => [
    { value: '', label: this.t('PAYROLL.COHORT.ALL') },
    ...this.contractTypes().map(c => ({
      value: c.code,
      label: (this.isEn() ? c.labelEn : c.labelFr) || this.contractLabel(c.code),
    })),
  ]);
  readonly employeeOptions = computed<SelectOption[]>(() =>
    this.employees().map(e => ({ value: String(e.userId), label: e.fullName })));
  private readonly employeeNames = computed(() =>
    new Map(this.employees().map(e => [e.userId, e.fullName])));

  // ── Change ────────────────────────────────────────────────────────────────
  readonly changeType = signal<ChangeType>('PERCENT');
  readonly changeValue = signal(0);
  readonly salaryBase = signal<SalaryBase>('NET');

  readonly changeTypeOptions = computed<SelectOption[]>(() => [
    { value: 'PERCENT', label: this.t('PAYROLL.COHORT.CHANGE_PERCENT') },
    { value: 'AMOUNT',  label: this.t('PAYROLL.COHORT.CHANGE_AMOUNT') },
  ]);
  readonly baseOptions = computed((): RadioOption[] => [
    { value: 'NET',   label: this.t('PAYROLL.COHORT.BASE_NET') },
    { value: 'GROSS', label: this.t('PAYROLL.COHORT.BASE_GROSS') },
  ]);

  /** Payroll currency, known once a result came back (pays_ref.devise is an accounting label,
   *  e.g. "EUR" for Tunisia whose payroll is in TND — not shown before the server says). */
  private readonly currency = computed(() =>
    this.result()?.localCurrency ?? this.employeeResult()?.localCurrency ?? this.t('PAYROLL.COHORT.PAYROLL_CURRENCY'));

  /** "+5 % du salaire net actuel" — states exactly what is applied to what. */
  readonly changeHint = computed(() => {
    const v = this.changeValue() ?? 0;
    const sign = v > 0 ? '+' : v < 0 ? '−' : '';
    const abs = Math.abs(v);
    const base = this.t(this.salaryBase() === 'NET' ? 'PAYROLL.COHORT.BASE_NET_OF' : 'PAYROLL.COHORT.BASE_GROSS_OF');
    const amount = this.changeType() === 'PERCENT'
      ? `${sign}${this.fmt(abs, 2)} %`
      : `${sign}${this.fmt(abs, 2)} ${this.currency()}`.trim();
    return this.t(this.changeType() === 'PERCENT' ? 'PAYROLL.COHORT.HINT_PERCENT' : 'PAYROLL.COHORT.HINT_AMOUNT',
      { amount, base });
  });

  /** DEC3 bounds, checked before sending (the server checks them too). */
  readonly valueError = computed(() => {
    const v = this.changeValue();
    if (v == null || Number.isNaN(v)) return this.t('PAYROLL.COHORT.ERR_VALUE');
    if (this.changeType() === 'PERCENT' && (v < -50 || v > 200)) return this.t('PAYROLL.COHORT.ERR_PCT_BOUNDS');
    return null;
  });

  readonly canSubmit = computed(() =>
    !!this.paysId() && !this.loading() && !this.valueError()
    && (this.scopeMode() === 'GROUP' || this.employeeId() != null));

  ngOnInit(): void {
    this.api.listPayrollPays().subscribe(list => this.paysList.set(list));
  }

  setScope(mode: string): void {
    this.scopeMode.set(mode === 'EMPLOYEE' && this.canSeeIndividuals() ? 'EMPLOYEE' : 'GROUP');
    this.result.set(null); this.employeeResult.set(null); this.error.set(null);
  }

  private refsSeq = 0;
  /** Grades / disciplines (HR reference tables), contract types of the country (CIVP included),
   *  and — for individual-view holders — the employees for the picker and the table names. */
  private loadReferences(paysId: number | null): void {
    const seq = ++this.refsSeq;
    this.grades.set([]); this.disciplines.set([]); this.contractTypes.set([]); this.employees.set([]);
    if (paysId == null) return;
    this.refsLoading.set(true);
    let pending = 3;
    const done = () => { if (--pending === 0 && seq === this.refsSeq) this.refsLoading.set(false); };
    this.hrRef.listGrades(paysId).pipe(catchError(() => of([] as RefDataItemDto[])))
      .subscribe(l => { if (seq === this.refsSeq) this.grades.set(active(l)); done(); });
    this.hrRef.listDisciplines(paysId).pipe(catchError(() => of([] as RefDataItemDto[])))
      .subscribe(l => { if (seq === this.refsSeq) this.disciplines.set(active(l)); done(); });
    this.hrProfile.getContractTypes(paysId)
      .subscribe(l => { if (seq === this.refsSeq) this.contractTypes.set(l); done(); });
    if (this.canSeeIndividuals()) {
      this.hrProfile.listEmployees({ paysId, page: 0, size: 1000, sort: 'fullName,asc' })
        .pipe(catchError(() => of(null)))
        .subscribe(p => { if (seq === this.refsSeq) this.employees.set(p?.content ?? []); });
    }
  }

  submit(): void {
    const paysId = this.paysId();
    if (!paysId || !this.canSubmit()) return;
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);
    this.employeeResult.set(null);
    const fail = (err: { error?: { detail?: string; message?: string; error?: string } }) => {
      this.error.set(err?.error?.detail ?? err?.error?.message ?? err?.error?.error ?? this.t('PAYROLL.COHORT.ERROR'));
      this.loading.set(false);
    };

    if (this.scopeMode() === 'EMPLOYEE') {
      this.api.runEmployeeWhatIf({
        paysId, profileUserId: this.employeeId()!,
        modifierType: this.changeType(), modifierValue: this.changeValue(), salaryBase: this.salaryBase(),
      }).subscribe({ next: r => { this.employeeResult.set(r); this.loading.set(false); }, error: fail });
      return;
    }

    this.api.runCohortAggregate({
      paysId,
      grade:        this.grade()        || null,
      discipline:   this.discipline()   || null,
      contractType: this.contractType() || null,
      modifierType: this.changeType(),
      modifierValue: this.changeValue(),
      salaryBase:   this.salaryBase(),
      includeEmployees: this.canSeeIndividuals(),
    }).subscribe({ next: r => { this.coverageAck.set(false); this.result.set(r); this.loading.set(false); }, error: fail });
  }

  // ── Display helpers (DEC14: the API is unrounded, the screen rounds) ─────
  fmt(v: number | null | undefined, dec = 2): string {
    if (v == null) return '—';
    const locale = this.isEn() ? 'en-US' : 'fr-FR';
    return new Intl.NumberFormat(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
  }

  money(v: number | null | undefined, cur?: string | null): string {
    return v == null ? '—' : `${this.fmt(v)} ${cur ?? ''}`.trim();
  }

  signed(v: number | null | undefined, cur?: string | null): string {
    if (v == null) return '—';
    return `${v > 0 ? '+' : ''}${this.money(v, cur)}`;
  }

  pct(v: number | null | undefined): string {
    if (v == null) return '—';
    return `${v > 0 ? '+' : ''}${this.fmt(v, 2)} %`;
  }

  deltaMetric(v: number | null, cur: string | null): MetricDelta | undefined {
    if (v == null) return undefined;
    const direction: 'up' | 'down' | 'neutral' = v > 0 ? 'up' : v < 0 ? 'down' : 'neutral';
    return { value: this.signed(v, cur), direction };
  }

  changeLabel(r: { changeType?: string; modifierType?: string; modifierValue: number; salaryBase?: string; localCurrency: string | null }): string {
    const type = r.changeType ?? (r.modifierType === 'ABSOLU' ? 'AMOUNT' : 'PERCENT');
    const v = r.modifierValue ?? 0;
    const amount = type === 'PERCENT' ? `${v > 0 ? '+' : ''}${this.fmt(v, 2)} %` : this.signed(v, r.localCurrency);
    const base = this.t(r.salaryBase === 'GROSS' ? 'PAYROLL.COHORT.BASE_GROSS_OF' : 'PAYROLL.COHORT.BASE_NET_OF');
    return `${amount} ${base}`;
  }

  /** Translated text of a server message (code → i18n key, server text as fallback). */
  messageText(m: CohortMessage, r: CohortAggregateResponse | EmployeeWhatIfResponse): string {
    const key = `PAYROLL.COHORT.MSG.${m.code}`;
    const params = 'headcount' in r ? {
      excluded: r.excludedNoSalary, failed: r.failed, nonConverged: r.nonConverged,
      assumed: r.benefitsAssumed, headcount: r.headcount, k: r.minGroupSize,
      noneSelected: r.benefitsNoneSelected, matched: r.matched,
      pct: r.coverage != null ? this.fmt(r.coverage * 100, 0) : '',
      min: r.minCoverage != null ? this.fmt(r.minCoverage * 100, 0) : '',
    } : {};
    if (!('headcount' in r)) {
      const one = this.t(`${key}_ONE`);
      if (one !== `${key}_ONE`) return one;
    }
    const txt = this.t(key, params);
    return txt === key ? m.text : txt;
  }

  // ── Group: per-employee table (individual view only) ─────────────────────
  readonly employeeColumns = computed((): TableColumn[] => [
    { key: 'name',      label: this.t('PAYROLL.COHORT.TABLE.EMPLOYEE'), sortable: true },
    { key: 'contract',  label: this.t('PAYROLL.COHORT.TABLE.CONTRACT'), sortable: true },
    { key: 'net',       label: this.t('PAYROLL.COHORT.TABLE.NET'), sortable: true, sortAccessor: r => r['_net'] as number },
    { key: 'gross',     label: this.t('PAYROLL.COHORT.TABLE.GROSS'), sortable: true, sortAccessor: r => r['_gross'] as number },
    { key: 'cost',      label: this.t('PAYROLL.COHORT.TABLE.COST'), sortable: true, sortAccessor: r => r['_cost'] as number },
    { key: 'delta',     label: this.t('PAYROLL.COHORT.TABLE.DELTA'), sortable: true, sortAccessor: r => r['_delta'] as number },
    { key: 'deltaPct',  label: this.t('PAYROLL.COHORT.TABLE.DELTA_PCT'), sortable: true, sortAccessor: r => (r['_deltaPct'] as number) ?? 0 },
    { key: 'flags',     label: this.t('PAYROLL.COHORT.TABLE.FLAGS') },
  ]);

  readonly employeeRows = computed((): TableRow[] => {
    const r = this.result();
    if (!r?.employees) return [];
    const names = this.employeeNames();
    const arrow = (a: number, b: number) => `${this.fmt(a)} → ${this.fmt(b)}`;
    return r.employees.map((e: EmployeeWhatIfRow) => ({
      id: e.profileUserId,
      name: names.get(e.profileUserId) ?? `#${e.profileUserId}`,
      contract: e.contractType ? this.contractLabel(e.contractType) : '—',
      net: arrow(e.current.netInHand, e.projected.netInHand),
      gross: arrow(e.current.gross, e.projected.gross),
      cost: arrow(e.current.loadedCost, e.projected.loadedCost),
      delta: this.signed(e.deltaLoadedCost),
      deltaPct: this.pct(e.deltaLoadedCostPct),
      flags: [
        e.nonConverged ? this.t('PAYROLL.COHORT.FLAG_NON_CONVERGED') : null,
        e.benefitsAssumed ? this.t('PAYROLL.COHORT.FLAG_BENEFITS_ASSUMED') : null,
        e.grossSource === 'CONFIG' ? this.t('PAYROLL.COHORT.FLAG_GROSS_CONFIG') : null,
      ].filter(Boolean).join(' · ') || '—',
      _net: e.projected.netInHand, _gross: e.projected.gross, _cost: e.projected.loadedCost,
      _delta: e.deltaLoadedCost, _deltaPct: e.deltaLoadedCostPct,
    }));
  });

  readonly employeeTableConfig = computed((): TableConfig => ({
    showHeader: false,
    hoverable: false,
    emptyMessage: this.t('PAYROLL.COHORT.TABLE.EMPTY'),
    ...tableTools(this.translate),
  }));

  // ── One employee: current vs new, five strata + charges ──────────────────
  readonly strataLines = computed((): StratumLine[] => {
    const r = this.employeeResult();
    if (!r) return [];
    const c = r.employee.current, p = r.employee.projected;
    const line = (key: string, f: (x: WhatIfFigures) => number): StratumLine =>
      ({ key, label: this.t(`PAYROLL.COHORT.STRATA.${key}`), current: f(c), projected: f(p) });
    return [
      line('S1_NET', x => x.netInHand),
      line('S2_NET_TAXABLE', x => x.netTaxable),
      line('S3_GROSS', x => x.gross),
      line('S4_GROSS_BENEFITS', x => x.grossWithBenefits),
      line('IRPP', x => x.irppAmount),
      line('EMPLOYEE_CHARGES', x => x.employeeCharges),
      line('EMPLOYER_CHARGES', x => x.employerCharges),
      line('S5_LOADED_COST', x => x.loadedCost),
    ];
  });

  employeeName(id: number): string {
    return this.employeeNames().get(id) ?? `#${id}`;
  }
}

function active(l: RefDataItemDto[] | null | undefined): RefDataItemDto[] {
  return (l ?? []).filter(i => i.isActive !== false).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
