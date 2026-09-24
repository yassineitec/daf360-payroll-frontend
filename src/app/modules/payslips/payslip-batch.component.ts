import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';

import {
  ButtonComponent,
  CardComponent,
  DafCellDirective,
  DataTableComponent,
  FileUploadComponent,
  FilterComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  SelectComponent,
  StatusBadgeComponent,
  type BadgeVariant,
  type BreadcrumbItem,
  type FilterField,
  type FilterResult,
  type SelectOption,
  type TableColumn,
  type TableRow,
  type UploadedFile,
} from '@khalilrebhiitec/daf360';
import { NotificationService } from '../../core/notification.service';
import { PayrollApiService, PaysDto } from '../../core/payroll-api.service';
import { PayslipBatchResult, PayslipBatchService, PayslipPageStatus } from '../../core/payslip-batch.service';

const MONTH_KEYS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

/** localStorage key of the recent-imports log — see {@link PayslipBatchComponent.history}. */
const HISTORY_KEY = 'daf360.payroll.payslips.history';
const HISTORY_MAX = 20;
const MAX_SIZE_MB = 50;

/** One processed batch, as kept in the recent-imports log. */
interface PayslipHistoryEntry {
  id: string;
  processedAt: string;   // ISO
  paysId: number;
  paysLabel: string;
  paysIso: string;
  periodYear: number;
  periodMonth: number;
  fileName: string;
  result: PayslipBatchResult;
}

type HistoryStatusFilter = 'ALL' | 'SUCCESS' | 'PARTIAL';

/**
 * `/payroll/payslips` — upload the monthly multi-page payslip PDF (one employee per page,
 * from the external payroll system) and get back a per-page report: which pages matched an
 * employee by "Matricule" and were filed to SharePoint, and which need manual attention
 * (UNIDENTIFIED = no matricule found on the page, ERROR = matricule not in our data,
 * DUPLICATE = matricule seen twice in this same file).
 *
 * Layout: one full-width import card (period row → file → action bar), then the report of
 * the batch just processed, then the recent-imports log.
 *
 * The processing itself runs entirely on daf360-rh-service (see PayslipBatchService). That
 * service keeps no batch history, so the recent-imports log is kept client-side (this
 * browser only, last {@link HISTORY_MAX} batches) — enough to reopen a report after a
 * reload, not an audit trail.
 *
 * Built entirely from the `@khalilrebhiitec/daf360` library.
 */
@Component({
  selector: 'app-payslip-batch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    ButtonComponent, CardComponent, DafCellDirective, DataTableComponent, FileUploadComponent,
    MetricCardComponent, PageComponent, PageHeaderComponent,
    FilterComponent, SelectComponent, StatusBadgeComponent,
  ],
  templateUrl: './payslip-batch.component.html',
  styleUrl: './payslip-batch.component.scss',
})
export class PayslipBatchComponent implements OnInit {
  private readonly svc          = inject(PayslipBatchService);
  private readonly payrollApi   = inject(PayrollApiService);
  private readonly notification = inject(NotificationService);
  protected readonly translate  = inject(TranslateService);

  /** Même pattern que les autres pages : traduction synchrone pour ce qui ne passe pas
   *  par le pipe `| translate` du template. */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.PAYSLIPS.BREADCRUMB') },
  ]);

  // ── Pays : `daf-select`, liste chargée une fois.
  private readonly paysList = signal<PaysDto[]>([]);
  readonly paysId = signal<number | null>(null);
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})` })),
  );

  // First-load gate for `daf-page [loading]` — the pays dropdown is unusable until this
  // resolves. Kept separate from `processing`, which must never swap the whole page for
  // the skeleton.
  readonly loading = signal(false);

  ngOnInit(): void {
    this.history.set(this.readHistory());
    this.loading.set(true);
    this.payrollApi.listPays().subscribe({
      next: list => { this.paysList.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  readonly periodYear  = signal(new Date().getFullYear());
  readonly periodMonth = signal(new Date().getMonth() + 1);

  readonly monthOptions = computed<SelectOption[]>(() => {
    this.translate.currentLang();
    return MONTH_KEYS.map((key, i) => ({
      value: String(i + 1),
      label: this.t(`PAYROLL.PAYSLIPS.MONTHS.${key}`),
    }));
  });

  /** A handful of recent years covers the payroll batches this page actually processes
   *  (current + catch-up filing). */
  readonly yearOptions = computed<SelectOption[]>(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => current - i)
      .map(y => ({ value: String(y), label: String(y) }));
  });

  // ── Fichier ──────────────────────────────────────────────────────────────
  readonly uploadedFiles = signal<UploadedFile[]>([]);
  readonly processing    = signal(false);
  readonly result        = signal<PayslipBatchResult | null>(null);
  /** Which batch `result` belongs to — the file card and the report header both name it. */
  readonly resultFileName = signal<string | null>(null);

  readonly maxSizeMb = MAX_SIZE_MB;
  readonly selectedFile = computed(() => this.uploadedFiles()[0] ?? null);

  /** Page count read from the PDF itself before upload, `null` when it can't be read
   *  (compressed object streams hide the page objects from a plain text scan). Only a
   *  preview for the file card and the submit label — the server's count is the truth. */
  readonly detectedPages = signal<number | null>(null);

  onFilesChange(files: UploadedFile[]): void {
    this.uploadedFiles.set(files);
    this.detectedPages.set(null);
    const f = files[0];
    if (!f || f.error) return;
    f.file.text()
      .then(text => {
        if (this.uploadedFiles()[0] !== f) return;   // replaced meanwhile
        const count = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
        this.detectedPages.set(count > 0 ? count : null);
      })
      .catch(() => { /* preview only */ });
  }

  /** « Remplacer le fichier » — the hidden picker behind that button. Same shape and
   *  size check as `daf-file-upload`, so the rest of the page can't tell them apart. */
  onReplacePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.onFilesChange([{
      name: file.name, size: file.size, type: file.type, file,
      error: file.size > MAX_SIZE_MB * 1024 * 1024 ? `Dépasse ${MAX_SIZE_MB} Mo` : undefined,
    }]);
  }

  clearFile(): void {
    this.onFilesChange([]);
  }

  /** « Charger un autre lot » — back to an empty form, the period is kept. */
  startNewBatch(): void {
    this.clearFile();
    this.result.set(null);
    this.resultFileName.set(null);
  }

  formatSize(bytes: number): string {
    if (bytes < 1024)        return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  readonly canSubmit = computed(() => {
    const f = this.selectedFile();
    return !this.processing() && !!this.paysId() && !!f && !f.error;
  });

  readonly submitLabel = computed(() => {
    if (this.processing()) return this.t('PAYROLL.PAYSLIPS.FORM.PROCESSING');
    const n = this.detectedPages();
    return n
      ? this.t('PAYROLL.PAYSLIPS.FORM.SUBMIT_COUNT', { count: n })
      : this.t('PAYROLL.PAYSLIPS.FORM.SUBMIT');
  });

  readonly needsAttention = computed(() => {
    const r = this.result();
    return !!r && (r.errorCount > 0 || r.unidentifiedCount > 0);
  });

  submit(): void {
    if (!this.canSubmit()) return;
    const file = this.selectedFile()!.file;
    const paysId = this.paysId()!;
    const year = this.periodYear();
    const month = this.periodMonth();

    this.processing.set(true);
    this.result.set(null);

    this.svc.processBatch(file, paysId, year, month).pipe(
      catchError(err => {
        this.notification.error(this.extractErrorMessage(err));
        return of(null);
      }),
    ).subscribe(result => {
      this.processing.set(false);
      if (!result) return;
      this.result.set(result);
      this.resultFileName.set(file.name);
      this.clearFile();
      this.addToHistory(paysId, year, month, file.name, result);
      this.notification.success(this.t('PAYROLL.PAYSLIPS.NOTIFY.DONE', {
        success: result.successCount, total: result.totalPages,
      }));
    });
  }

  // ── Rapport du lot ───────────────────────────────────────────────────────
  private statusVariant(status: PayslipPageStatus): BadgeVariant {
    switch (status) {
      case 'SUCCESS':      return 'success';
      case 'ERROR':        return 'danger';
      case 'UNIDENTIFIED': return 'warning';
      case 'DUPLICATE':    return 'info';
    }
  }

  readonly detailColumns = computed<TableColumn[]>(() => [
    { key: 'pageNumber',     label: this.t('PAYROLL.PAYSLIPS.TABLE.PAGE'), width: '80px' },
    { key: 'matricule',      label: this.t('PAYROLL.PAYSLIPS.TABLE.MATRICULE') },
    { key: 'employee',       label: this.t('PAYROLL.PAYSLIPS.TABLE.EMPLOYEE') },
    { key: 'status',         label: this.t('PAYROLL.PAYSLIPS.TABLE.STATUS'), type: 'badge' },
    { key: 'sharePointUrl',  label: this.t('PAYROLL.PAYSLIPS.TABLE.SHAREPOINT_URL'), type: 'custom' },
    { key: 'errorMessage',   label: this.t('PAYROLL.PAYSLIPS.TABLE.ERROR_MESSAGE') },
  ]);

  readonly detailRows = computed<TableRow[]>(() =>
    (this.result()?.details ?? []).map(d => ({
      id:            d.pageNumber,
      pageNumber:    d.pageNumber,
      matricule:     d.matricule ?? '—',
      employee:      d.employeeFullName ?? '—',
      status:        { label: this.t(`PAYROLL.PAYSLIPS.STATUS.${d.status}`), options: { variant: this.statusVariant(d.status), size: 'sm' as const } },
      sharePointUrl: d.sharePointUrl,
      errorMessage:  d.errorMessage ?? '—',
    })),
  );

  // ── Historique des importations ──────────────────────────────────────────
  readonly history = signal<PayslipHistoryEntry[]>([]);
  readonly historyFilter = signal<HistoryStatusFilter>('ALL');

  // `daf-filter` : champ vide = tous les statuts ('ALL').
  readonly historyFilterFields = computed<FilterField[]>(() => [{
    name: 'status',
    label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_STATUS'),
    type: 'select',
    placeholder: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_ALL'),
    options: [
      { value: 'SUCCESS', label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_SUCCESS') },
      { value: 'PARTIAL', label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_PARTIAL') },
    ],
  }]);

  applyHistoryFilter(result: FilterResult): void {
    this.historyFilter.set(((result['status'] as string | null) || 'ALL') as HistoryStatusFilter);
  }

  private isFullSuccess(r: PayslipBatchResult): boolean {
    return r.totalPages > 0 && r.successCount === r.totalPages;
  }

  readonly historyColumns = computed<TableColumn[]>(() => [
    { key: 'processedAt', label: this.t('PAYROLL.PAYSLIPS.HISTORY.DATE'), type: 'date', sortable: true,
      format: { dateStyle: 'short', timeStyle: 'short' } },
    { key: 'pays',        label: this.t('PAYROLL.PAYSLIPS.HISTORY.PAYS'), type: 'badge' },
    { key: 'period',      label: this.t('PAYROLL.PAYSLIPS.HISTORY.PERIOD') },
    { key: 'fileName',    label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILE'), type: 'custom' },
    { key: 'count',       label: this.t('PAYROLL.PAYSLIPS.HISTORY.COUNT') },
    { key: 'status',      label: this.t('PAYROLL.PAYSLIPS.HISTORY.STATUS'), type: 'badge' },
  ]);

  readonly historyRows = computed<TableRow[]>(() => {
    const filter = this.historyFilter();
    return this.history()
      .filter(h => filter === 'ALL' || (filter === 'SUCCESS') === this.isFullSuccess(h.result))
      .map(h => {
        const ok = this.isFullSuccess(h.result);
        return {
          id:          h.id,
          processedAt: h.processedAt,
          pays:        { label: h.paysIso || h.paysLabel, options: { variant: 'neutral' as const, size: 'sm' as const } },
          period:      `${this.t(`PAYROLL.PAYSLIPS.MONTHS.${MONTH_KEYS[h.periodMonth - 1]}`)} ${h.periodYear}`,
          fileName:    h.fileName,
          count:       this.t('PAYROLL.PAYSLIPS.HISTORY.COUNT_VALUE', { count: h.result.totalPages }),
          status: {
            label: this.t(ok ? 'PAYROLL.PAYSLIPS.HISTORY.STATUS_SUCCESS' : 'PAYROLL.PAYSLIPS.HISTORY.STATUS_PARTIAL', {
              success: h.result.successCount, total: h.result.totalPages,
            }),
            options: { variant: (ok ? 'success' : 'warning') as BadgeVariant, size: 'sm' as const, dot: true },
          },
        };
      });
  });

  readonly historyConfig = computed(() => ({
    emptyMessage: this.t('PAYROLL.PAYSLIPS.HISTORY.EMPTY'),
    defaultSort: { key: 'processedAt', dir: 'desc' as const },
    actions: [{
      id: 'view',
      icon: 'visibility',
      tooltip: this.t('PAYROLL.PAYSLIPS.HISTORY.VIEW'),
      onClick: (row: TableRow) => this.openHistoryEntry(String(row['id'])),
    }],
  }));

  private openHistoryEntry(id: string): void {
    const entry = this.history().find(h => h.id === id);
    if (!entry) return;
    this.result.set(entry.result);
    this.resultFileName.set(entry.fileName);
    document.getElementById('payslip-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private addToHistory(paysId: number, year: number, month: number, fileName: string, result: PayslipBatchResult): void {
    const pays = this.paysList().find(p => p.id === paysId);
    const entry: PayslipHistoryEntry = {
      id:          `${Date.now()}`,
      processedAt: new Date().toISOString(),
      paysId,
      paysLabel:   pays?.frenchLabel ?? String(paysId),
      paysIso:     pays?.isoCode ?? '',
      periodYear:  year,
      periodMonth: month,
      fileName,
      result,
    };
    const next = [entry, ...this.history()].slice(0, HISTORY_MAX);
    this.history.set(next);
    this.writeHistory(next);
  }

  private readHistory(): PayslipHistoryEntry[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeHistory(entries: PayslipHistoryEntry[]): void {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch { /* quota / private mode */ }
  }

  private extractErrorMessage(err: unknown): string {
    const httpErr = err as { error?: { message?: string } };
    return httpErr?.error?.message ?? this.t('PAYROLL.PAYSLIPS.NOTIFY.ERROR');
  }
}
