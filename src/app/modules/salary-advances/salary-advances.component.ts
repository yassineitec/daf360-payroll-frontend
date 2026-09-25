import {
  ChangeDetectionStrategy, Component, OnInit, TemplateRef, ViewChild, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { catchError, of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  BadgeCell, DafCellDirective, DataTableComponent, FormFieldComponent, MetricCardComponent, MetricCardOptions,
  ModalRef, ModalService, PageComponent, PageHeaderComponent, SearchToolbarComponent, SelectComponent,
  TabItem, TabsComponent, TableColumn, TableConfig, TableRow, tabParam, ButtonComponent,
} from '@khalilrebhiitec/daf360';
import type { BadgeVariant, SelectOption } from '@khalilrebhiitec/daf360';

import { PayrollApiService, PaysDto } from '../../core/payroll-api.service';
import {
  ADVANCE_STATUSES, AdvancePolicy, AdvanceStatus, DISBURSEMENT_METHODS, DeductionRow, DisbursementMethod,
  InstallmentStatus, SalaryAdvance, SalaryAdvancesService,
} from './salary-advances.service';

type TabKey = 'payout' | 'deductions' | 'followup' | 'rules';

const ADVANCE_VARIANT: Record<AdvanceStatus, BadgeVariant> = {
  PENDING_FINANCE: 'warning', APPROVED: 'info', REPAYING: 'success',
  REPAID: 'neutral', REJECTED: 'danger', CANCELLED: 'neutral',
};
const INSTALLMENT_VARIANT: Record<InstallmentStatus, BadgeVariant> = {
  PLANNED: 'warning', DEDUCTED: 'success', SKIPPED: 'neutral', WAIVED: 'info',
};
const CURRENCIES = ['TND', 'EGP', 'EUR', 'USD'];

/**
 * `/payroll/salary-advances` — payroll owns the salary advances: they exist to be deducted
 * from the next salaries. Finance only approves or declines them (its cost approval queue);
 * the employee asks from self-service. Four tabs:
 *
 *  - **À verser**  — approved by finance: record the payout, which creates the schedule;
 *  - **Retenues**  — one payroll month: export the list for the payroll software, then mark
 *                    each line deducted once the payslip carries it (or postpone / settle it);
 *  - **Suivi**     — every advance, by status, with its schedule;
 *  - **Règles**    — per country: maximum repayment period, minimum seniority, open or closed.
 *                    No ceiling on the amount — finance judges it.
 */
@Component({
  selector: 'app-salary-advances',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageComponent, PageHeaderComponent, MetricCardComponent, TabsComponent, SearchToolbarComponent,
    SelectComponent, DataTableComponent, DafCellDirective, FormFieldComponent, ButtonComponent, TranslatePipe,
  ],
  templateUrl: './salary-advances.component.html',
})
export class SalaryAdvancesComponent implements OnInit {
  private readonly svc = inject(SalaryAdvancesService);
  private readonly payrollApi = inject(PayrollApiService);
  private readonly modal = inject(ModalService);
  private readonly translate = inject(TranslateService);

  @ViewChild('payoutTpl') private payoutTpl!: TemplateRef<unknown>;
  @ViewChild('noteTpl')   private noteTpl!:   TemplateRef<unknown>;
  @ViewChild('policyTpl') private policyTpl!: TemplateRef<unknown>;
  @ViewChild('detailTpl') private detailTpl!: TemplateRef<unknown>;
  private modalRef: ModalRef | null = null;

  // ── Data ─────────────────────────────────────────────────────────────────
  readonly toPay      = signal<SalaryAdvance[]>([]);
  readonly all        = signal<SalaryAdvance[]>([]);
  readonly deductions = signal<DeductionRow[]>([]);
  readonly policies   = signal<AdvancePolicy[]>([]);
  readonly pays       = signal<PaysDto[]>([]);

  readonly firstLoad          = signal(true);
  readonly loading            = signal(false);
  readonly deductionsLoading  = signal(false);
  readonly error              = signal<string | null>(null);

  // ── View state ───────────────────────────────────────────────────────────
  readonly activeTab    = tabParam<TabKey>(['payout', 'deductions', 'followup', 'rules'], 'payout');
  readonly search       = signal('');
  readonly statusFilter = signal<AdvanceStatus | ''>('');
  readonly month        = signal(currentYearMonth());
  readonly exporting    = signal(false);
  readonly bulkBusy     = signal(false);

  // ── Modals ───────────────────────────────────────────────────────────────
  readonly selected    = signal<SalaryAdvance | null>(null);
  readonly method      = signal<DisbursementMethod>('VIREMENT');
  readonly reference   = signal('');
  readonly paidOn      = signal(todayIso());
  readonly note        = signal('');
  readonly noteRow     = signal<DeductionRow | null>(null);
  readonly noteKind    = signal<'skip' | 'waive'>('skip');
  readonly policyForm  = signal<AdvancePolicy>(blankPolicy(0));
  readonly policyIsNew = signal(false);
  readonly modalError  = signal<string | null>(null);

  readonly kpiPayout: MetricCardOptions      = { icon: 'account_balance', iconColor: 'text-warning', iconBg: 'bg-warning/10' };
  readonly kpiRepaying: MetricCardOptions    = { icon: 'autorenew', iconColor: 'text-primary', iconBg: 'bg-primary/10' };
  readonly kpiDue: MetricCardOptions         = { icon: 'receipt_long', iconColor: 'text-tertiary', iconBg: 'bg-tertiary/10' };
  readonly kpiOutstanding: MetricCardOptions = { icon: 'account_balance_wallet', iconColor: 'text-teal', iconBg: 'bg-teal/10' };

  private readonly locale = computed(() => (this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR'));

  constructor() {
    effect(() => {
      const m = this.month();
      untracked(() => this.loadDeductions(m));
    });
  }

  ngOnInit(): void {
    this.load();
    this.payrollApi.listPays().pipe(catchError(() => of([] as PaysDto[]))).subscribe(p => this.pays.set(p));
  }

  load(): void {
    if (!this.firstLoad()) this.loading.set(true);
    this.error.set(null);
    this.svc.toDisburse().subscribe({
      next: list => { this.toPay.set(list); this.loading.set(false); this.firstLoad.set(false); },
      error: err => { this.error.set(this.message(err)); this.loading.set(false); this.firstLoad.set(false); },
    });
    this.svc.list().pipe(catchError(() => of([] as SalaryAdvance[]))).subscribe(list => this.all.set(list));
    this.svc.policies().pipe(catchError(() => of([] as AdvancePolicy[]))).subscribe(list => this.policies.set(list));
  }

  private loadDeductions(month: string): void {
    this.deductionsLoading.set(true);
    this.svc.deductions(month).subscribe({
      next: rows => { this.deductions.set(rows); this.deductionsLoading.set(false); },
      error: err => { this.deductions.set([]); this.deductionsLoading.set(false); this.error.set(this.message(err)); },
    });
  }

  // ── Projections ──────────────────────────────────────────────────────────
  readonly planned = computed(() => this.deductions().filter(r => r.status === 'PLANNED'));

  readonly stats = computed(() => {
    const repaying = this.all().filter(a => a.status === 'REPAYING');
    return {
      toPay: this.toPay().length,
      repaying: repaying.length,
      due: this.planned().length,
      outstanding: sumByCurrency(repaying.map(a => ({ amount: a.outstandingAmount ?? 0, currency: a.currency })), this.locale()),
    };
  });

  readonly tabs = computed<TabItem[]>(() => {
    this.translate.currentLang();
    const t = (k: string) => this.translate.instant(k);
    return [
      { id: 'payout',     label: t('PAYROLL.SALARY_ADVANCES.TAB.PAYOUT'),     icon: 'account_balance', count: this.toPay().length || null },
      { id: 'deductions', label: t('PAYROLL.SALARY_ADVANCES.TAB.DEDUCTIONS'), icon: 'receipt_long',    count: this.planned().length || null },
      { id: 'followup',   label: t('PAYROLL.SALARY_ADVANCES.TAB.FOLLOWUP'),   icon: 'list_alt' },
      { id: 'rules',      label: t('PAYROLL.SALARY_ADVANCES.TAB.RULES'),      icon: 'tune' },
    ];
  });

  readonly monthOptions = computed<SelectOption[]>(() => {
    const loc = this.locale();
    const now = currentYearMonth();
    return Array.from({ length: 10 }, (_, i) => addMonths(now, 3 - i)).map(m => ({ value: m, label: monthLabel(m, loc) }));
  });

  readonly statusOptions = computed<SelectOption[]>(() => {
    this.translate.currentLang();
    return ADVANCE_STATUSES.map(s => ({ value: s, label: this.translate.instant(`PAYROLL.SALARY_ADVANCES.STATUS.${s}`) }));
  });

  readonly methodOptions = computed<SelectOption[]>(() => {
    this.translate.currentLang();
    return DISBURSEMENT_METHODS.map(m => ({ value: m, label: this.translate.instant(`PAYROLL.SALARY_ADVANCES.METHOD.${m}`) }));
  });

  readonly currencyOptions: SelectOption[] = CURRENCIES.map(c => ({ value: c, label: c }));

  readonly paysOptions = computed<SelectOption[]>(() => {
    const taken = new Set(this.policies().map(p => p.paysId));
    return this.pays().filter(p => !taken.has(p.id)).map(p => ({ value: String(p.id), label: p.frenchLabel }));
  });

  private paysName(id: number): string {
    return this.pays().find(p => p.id === id)?.frenchLabel ?? `#${id}`;
  }

  private matches(name: string | null): boolean {
    const q = this.search().trim().toLowerCase();
    return !q || (name ?? '').toLowerCase().includes(q);
  }

  // ── Tables ───────────────────────────────────────────────────────────────
  private advanceColumns(): TableColumn[] {
    const t = (k: string) => this.translate.instant(k);
    return [
      { key: 'employee', label: t('PAYROLL.SALARY_ADVANCES.COL.EMPLOYEE'), type: 'avatar' },
      { key: 'terms',    label: t('PAYROLL.SALARY_ADVANCES.COL.TERMS') },
      { key: 'status',   label: t('PAYROLL.SALARY_ADVANCES.COL.STATUS'), type: 'badge' },
      { key: 'amount',   label: t('PAYROLL.SALARY_ADVANCES.COL.AMOUNT'), align: 'right' },
      { key: '_actions', label: '', align: 'right', width: '1%' },
    ];
  }

  private advanceRow(a: SalaryAdvance): TableRow {
    const t = (k: string, p?: object) => this.translate.instant(k, p);
    return {
      employee: { name: a.employeeName ?? '—', initials: initials(a.employeeName), subtitle: this.paysName(a.paysId) },
      terms: t('PAYROLL.SALARY_ADVANCES.TERMS', {
        monthly: this.money(a.monthlyAmount, a.currency), count: a.installments, month: monthLabel(a.firstDeductionMonth, this.locale()) }),
      status: {
        label: t(`PAYROLL.SALARY_ADVANCES.STATUS.${a.status}`),
        options: { variant: ADVANCE_VARIANT[a.status] ?? 'neutral', size: 'sm', dot: true },
      } satisfies BadgeCell,
      amount: a.status === 'REPAYING' && a.outstandingAmount !== null
        ? `${this.money(a.amount, a.currency)} · ${t('PAYROLL.SALARY_ADVANCES.LEFT', { amount: this.money(a.outstandingAmount, a.currency) })}`
        : this.money(a.amount, a.currency),
      _source: a,
    };
  }

  readonly payoutColumns = computed<TableColumn[]>(() => { this.translate.currentLang(); return this.advanceColumns(); });
  readonly payoutRows = computed<TableRow[]>(() => {
    this.translate.currentLang();
    return this.toPay().filter(a => this.matches(a.employeeName)).map(a => this.advanceRow(a));
  });

  readonly followupRows = computed<TableRow[]>(() => {
    this.translate.currentLang();
    const s = this.statusFilter();
    return this.all().filter(a => this.matches(a.employeeName) && (!s || a.status === s)).map(a => this.advanceRow(a));
  });

  readonly deductionColumns = computed<TableColumn[]>(() => {
    this.translate.currentLang();
    const t = (k: string) => this.translate.instant(k);
    return [
      { key: 'employee',    label: t('PAYROLL.SALARY_ADVANCES.COL.EMPLOYEE'), type: 'avatar' },
      { key: 'position',    label: t('PAYROLL.SALARY_ADVANCES.COL.POSITION') },
      { key: 'outstanding', label: t('PAYROLL.SALARY_ADVANCES.COL.OUTSTANDING') },
      { key: 'status',      label: t('PAYROLL.SALARY_ADVANCES.COL.STATUS'), type: 'badge' },
      { key: 'amount',      label: t('PAYROLL.SALARY_ADVANCES.COL.AMOUNT'), align: 'right' },
      { key: '_actions',    label: '', align: 'right', width: '1%' },
    ];
  });

  readonly deductionRows = computed<TableRow[]>(() => {
    this.translate.currentLang();
    const t = (k: string, p?: object) => this.translate.instant(k, p);
    const q = this.search().trim().toLowerCase();
    return this.deductions()
      .filter(r => !q || (r.employeeName ?? '').toLowerCase().includes(q) || (r.payrollMatricule ?? '').toLowerCase().includes(q))
      .map(r => ({
        employee: {
          name: r.employeeName ?? '—', initials: initials(r.employeeName),
          // The key the payroll software matches on.
          subtitle: r.payrollMatricule
            ? t('PAYROLL.SALARY_ADVANCES.MATRICULE', { value: r.payrollMatricule })
            : t('PAYROLL.SALARY_ADVANCES.NO_MATRICULE'),
        },
        position: `${r.seq}/${r.installmentsTotal}`,
        outstanding: this.money(r.outstandingAmount, r.currency),
        status: {
          label: t(`PAYROLL.SALARY_ADVANCES.INSTALLMENT.${r.status}`),
          options: { variant: INSTALLMENT_VARIANT[r.status] ?? 'neutral', size: 'sm', dot: true },
        } satisfies BadgeCell,
        amount: this.money(r.amount, r.currency),
        _source: r,
      }));
  });

  readonly ruleColumns = computed<TableColumn[]>(() => {
    this.translate.currentLang();
    const t = (k: string) => this.translate.instant(k);
    return [
      { key: 'pays',      label: t('PAYROLL.SALARY_ADVANCES.RULES.PAYS') },
      { key: 'months',    label: t('PAYROLL.SALARY_ADVANCES.RULES.MAX_MONTHS') },
      { key: 'seniority', label: t('PAYROLL.SALARY_ADVANCES.RULES.SENIORITY') },
      { key: 'state',     label: t('PAYROLL.SALARY_ADVANCES.RULES.STATE'), type: 'badge' },
      { key: '_actions',  label: '', align: 'right', width: '1%' },
    ];
  });

  readonly ruleRows = computed<TableRow[]>(() => {
    this.translate.currentLang();
    const t = (k: string, p?: object) => this.translate.instant(k, p);
    return this.policies().map(p => ({
      pays: `${this.paysName(p.paysId)} · ${p.currency}`,
      months: t('PAYROLL.SALARY_ADVANCES.N_MONTHS', { count: p.maxInstallments }),
      seniority: p.minSeniorityMonths ? t('PAYROLL.SALARY_ADVANCES.N_MONTHS', { count: p.minSeniorityMonths }) : t('PAYROLL.SALARY_ADVANCES.RULES.NONE'),
      state: {
        label: t(p.isActive ? 'PAYROLL.SALARY_ADVANCES.RULES.OPEN' : 'PAYROLL.SALARY_ADVANCES.RULES.CLOSED'),
        options: { variant: p.isActive ? 'success' : 'neutral', size: 'sm', dot: true },
      } satisfies BadgeCell,
      _source: p,
    }));
  });

  private config(loading: boolean, emptyKey: string, header = false): TableConfig {
    this.translate.currentLang();
    return { showHeader: header, hoverable: false, loading, skeletonRows: 6, emptyMessage: this.translate.instant(emptyKey) };
  }

  readonly payoutConfig    = computed(() => this.config(this.loading(), 'PAYROLL.SALARY_ADVANCES.EMPTY.PAYOUT'));
  readonly followupConfig  = computed(() => this.config(this.loading(), 'PAYROLL.SALARY_ADVANCES.EMPTY.FOLLOWUP'));
  readonly deductionConfig = computed(() => this.config(this.deductionsLoading(), 'PAYROLL.SALARY_ADVANCES.EMPTY.DEDUCTIONS', true));
  readonly ruleConfig      = computed(() => this.config(this.loading(), 'PAYROLL.SALARY_ADVANCES.EMPTY.RULES', true));

  // ── Actions ──────────────────────────────────────────────────────────────
  openDetail(a: SalaryAdvance): void {
    this.svc.get(a.id).pipe(catchError(() => of(a))).subscribe(full => {
      this.selected.set(full);
      this.modal.open({
        title: full.employeeName ?? `AVS-${full.id}`,
        subtitle: `AVS-${full.id} · ${this.money(full.amount, full.currency)}`,
        icon: 'payments',
        body: this.detailTpl,
        size: 'md',
        buttons: [{ label: this.translate.instant('PAYROLL.SALARY_ADVANCES.CLOSE'), variant: 'secondary', action: r => r.close() }],
      });
    });
  }

  openPayout(a: SalaryAdvance): void {
    this.selected.set(a);
    this.method.set('VIREMENT');
    this.reference.set('');
    this.paidOn.set(todayIso());
    this.note.set('');
    this.modalError.set(null);
    const t = (k: string) => this.translate.instant(k);
    this.modalRef = this.modal.open({
      title: t('PAYROLL.SALARY_ADVANCES.PAYOUT.TITLE'),
      icon: 'account_balance',
      body: this.payoutTpl,
      size: 'md',
      closeOnBackdrop: false,
      buttons: [
        { label: t('PAYROLL.SALARY_ADVANCES.CANCEL'), variant: 'secondary', action: r => r.close() },
        { label: t('PAYROLL.SALARY_ADVANCES.PAYOUT.CONFIRM'), variant: 'primary', action: () => this.submitPayout() },
      ],
    });
  }

  /** Guarded here too: a ModalButton has no reactive `disabled`. */
  private submitPayout(): void {
    const a = this.selected();
    if (!a) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.paidOn())) {
      this.modalError.set(this.translate.instant('PAYROLL.SALARY_ADVANCES.PAYOUT.DATE_REQUIRED'));
      return;
    }
    this.svc.disburse(a.id, {
      method: this.method(), reference: this.reference().trim() || null,
      disbursedOn: this.paidOn(), notes: this.note().trim() || null,
    }).subscribe({
      next: () => { this.modalRef?.close(); this.load(); this.loadDeductions(this.month()); },
      error: err => this.modalError.set(this.message(err)),
    });
  }

  onMethodChange(values: string[]): void {
    const v = values[0] as DisbursementMethod | undefined;
    if (v && DISBURSEMENT_METHODS.includes(v)) this.method.set(v);
  }

  exportCsv(): void {
    this.exporting.set(true);
    const month = this.month();
    this.svc.exportDeductions(month).subscribe({
      next: blob => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `retenues-avances-${month}.csv`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: err => { this.exporting.set(false); this.error.set(this.message(err)); },
    });
  }

  markDeducted(ids: number[], bulk = false): void {
    if (!ids.length) return;
    if (bulk) this.bulkBusy.set(true);
    this.svc.markDeducted(ids).subscribe({
      next: () => { this.bulkBusy.set(false); this.loadDeductions(this.month()); this.load(); },
      error: err => { this.bulkBusy.set(false); this.error.set(this.message(err)); },
    });
  }

  markAllDeducted(): void {
    this.markDeducted(this.planned().map(r => r.installmentId), true);
  }

  openNote(row: DeductionRow, kind: 'skip' | 'waive'): void {
    this.noteRow.set(row);
    this.noteKind.set(kind);
    this.note.set('');
    this.modalError.set(null);
    const t = (k: string) => this.translate.instant(k);
    this.modalRef = this.modal.open({
      title: t(kind === 'skip' ? 'PAYROLL.SALARY_ADVANCES.ACTIONS.SKIP' : 'PAYROLL.SALARY_ADVANCES.ACTIONS.WAIVE'),
      body: this.noteTpl,
      size: 'md',
      closeOnBackdrop: false,
      buttons: [
        { label: t('PAYROLL.SALARY_ADVANCES.CANCEL'), variant: 'secondary', action: r => r.close() },
        { label: t('PAYROLL.SALARY_ADVANCES.CONFIRM'), variant: 'primary', action: () => this.submitNote() },
      ],
    });
  }

  private submitNote(): void {
    const row = this.noteRow();
    if (!row) return;
    const note = this.note().trim();
    if (!note) { this.modalError.set(this.translate.instant('PAYROLL.SALARY_ADVANCES.REASON_REQUIRED')); return; }
    const call$ = this.noteKind() === 'skip' ? this.svc.skip([row.installmentId], note) : this.svc.waive([row.installmentId], note);
    call$.subscribe({
      next: () => { this.modalRef?.close(); this.loadDeductions(this.month()); this.load(); },
      error: err => this.modalError.set(this.message(err)),
    });
  }

  openPolicy(p: AdvancePolicy | null): void {
    this.policyIsNew.set(!p);
    this.policyForm.set(p ? { ...p } : blankPolicy(0));
    this.modalError.set(null);
    const t = (k: string) => this.translate.instant(k);
    this.modalRef = this.modal.open({
      title: t(p ? 'PAYROLL.SALARY_ADVANCES.RULES.EDIT' : 'PAYROLL.SALARY_ADVANCES.RULES.ADD'),
      icon: 'tune',
      body: this.policyTpl,
      size: 'md',
      closeOnBackdrop: false,
      buttons: [
        { label: t('PAYROLL.SALARY_ADVANCES.CANCEL'), variant: 'secondary', action: r => r.close() },
        { label: t('PAYROLL.SALARY_ADVANCES.RULES.SAVE'), variant: 'primary', action: () => this.submitPolicy() },
      ],
    });
  }

  patchPolicy(change: Partial<AdvancePolicy>): void {
    this.policyForm.update(f => ({ ...f, ...change }));
  }

  private submitPolicy(): void {
    const f = this.policyForm();
    const valid = f.paysId > 0 && f.currency.length === 3
      && Number.isInteger(f.maxInstallments) && f.maxInstallments >= 1 && f.maxInstallments <= 24
      && Number.isInteger(f.minSeniorityMonths) && f.minSeniorityMonths >= 0;
    if (!valid) { this.modalError.set(this.translate.instant('PAYROLL.SALARY_ADVANCES.RULES.INVALID')); return; }
    this.svc.savePolicy(f).subscribe({
      next: saved => {
        this.modalRef?.close();
        this.policies.update(list => [...list.filter(p => p.paysId !== saved.paysId), saved].sort((x, y) => x.paysId - y.paysId));
      },
      error: err => this.modalError.set(this.message(err)),
    });
  }

  onStatusFilter(values: string[]): void {
    this.statusFilter.set((values[0] as AdvanceStatus) ?? '');
  }

  // ── Display ──────────────────────────────────────────────────────────────
  money(value: number | null | undefined, currency: string | null): string {
    if (value === null || value === undefined) return '—';
    const formatted = new Intl.NumberFormat(this.locale(), { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(value);
    return currency ? `${formatted} ${currency}` : formatted;
  }

  monthName(ym: string | null): string {
    return monthLabel(ym, this.locale());
  }

  toNumber(value: unknown): number {
    const n = Number(value);
    return isNaN(n) ? 0 : n;
  }

  private message(err: unknown): string {
    const body = (err as { error?: { detail?: string; message?: string } } | null)?.error;
    return body?.detail || body?.message || this.translate.instant('PAYROLL.SALARY_ADVANCES.ERROR');
  }
}

function blankPolicy(paysId: number): AdvancePolicy {
  return { paysId, currency: 'TND', maxInstallments: 3, minSeniorityMonths: 3, isActive: true };
}

function currentYearMonth(today = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym: string | null, locale: string): string {
  if (!ym) return '—';
  const [y, m] = ym.slice(0, 7).split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/);
  const from = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  return from ? from.toUpperCase() : '—';
}

function sumByCurrency(items: { amount: number; currency: string }[], locale: string): string {
  if (!items.length) return '0';
  const totals = new Map<string, number>();
  items.forEach(i => totals.set(i.currency, (totals.get(i.currency) ?? 0) + i.amount));
  return [...totals.entries()]
    .map(([c, v]) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(v)} ${c}`)
    .join(' · ');
}
