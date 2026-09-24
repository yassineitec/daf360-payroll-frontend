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
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  SectionTitleComponent,
  SelectComponent,
  StatusBadgeComponent,
  type BadgeVariant,
  type BreadcrumbItem,
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

/**
 * `/payroll/payslips` — upload the monthly multi-page payslip PDF (one employee per page,
 * from the external payroll system) and get back a per-page report: which pages matched an
 * employee by "Matricule" and were filed to SharePoint, and which need manual attention
 * (UNIDENTIFIED = no matricule found on the page, ERROR = matricule not in our data,
 * DUPLICATE = matricule seen twice in this same file).
 *
 * Lives in the Payroll app — the processing itself still runs entirely on
 * daf360-rh-service (see PayslipBatchService), same cross-app call shape as the
 * candidate-simulation / hr-profile services already used here.
 *
 * Built entirely from the `@khalilrebhiitec/daf360` library — same pattern as
 * `engine-run`/`engine-results` — instead of the hand-rolled form/table markup this page
 * used to carry.
 */
@Component({
  selector: 'app-payslip-batch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    ButtonComponent, CardComponent, DafCellDirective, DataTableComponent, FileUploadComponent,
    MetricCardComponent, PageComponent, PageHeaderComponent,
    SectionTitleComponent, SelectComponent, StatusBadgeComponent,
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

  // ── Pays : `daf-select`, même besoin déjà couvert par la bibliothèque dans
  //    engine-run/engine-results — liste chargée une fois.
  private readonly paysList = signal<PaysDto[]>([]);
  readonly paysId = signal<number | null>(null);
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})` })),
  );

  // First-load gate for `daf-page [loading]` — the pays dropdown is unusable until this
  // resolves. Kept separate from `processing` below: that one drives the submit button
  // only, and must never swap the whole page (including the form the user is mid-upload
  // on) for the skeleton.
  readonly loading = signal(false);

  ngOnInit(): void {
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

  /** `daf-select`, not `daf-form-field` — Année sits right next to Mois in the sidebar's
   *  two-column row, and a number input's label/height don't match a select's, which read
   *  as visually inconsistent side by side. A handful of recent years covers the payroll
   *  batches this page actually processes (current + catch-up filing). */
  readonly yearOptions = computed<SelectOption[]>(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => current - i)
      .map(y => ({ value: String(y), label: String(y) }));
  });

  readonly uploadedFiles = signal<UploadedFile[]>([]);
  readonly processing    = signal(false);
  readonly result        = signal<PayslipBatchResult | null>(null);

  readonly canSubmit = computed(() => {
    const files = this.uploadedFiles();
    return !this.processing() && !!this.paysId() &&
      files.length === 1 && !files[0].error;
  });

  readonly readyBadge = computed(() => this.canSubmit()
    ? { label: this.t('PAYROLL.PAYSLIPS.STATUS_READY'), variant: 'success' as BadgeVariant }
    : { label: this.t('PAYROLL.PAYSLIPS.STATUS_NOT_READY'), variant: 'neutral' as BadgeVariant });

  readonly needsAttention = computed(() => {
    const r = this.result();
    return !!r && (r.errorCount > 0 || r.unidentifiedCount > 0);
  });

  submit(): void {
    if (!this.canSubmit()) return;
    const file = this.uploadedFiles()[0].file;

    this.processing.set(true);
    this.result.set(null);

    this.svc.processBatch(file, this.paysId()!, this.periodYear(), this.periodMonth()).pipe(
      catchError(err => {
        this.notification.error(this.extractErrorMessage(err));
        return of(null);
      }),
    ).subscribe(result => {
      this.processing.set(false);
      if (!result) return;
      this.result.set(result);
      this.notification.success(this.t('PAYROLL.PAYSLIPS.NOTIFY.DONE', {
        success: result.successCount, total: result.totalPages,
      }));
    });
  }

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

  private extractErrorMessage(err: unknown): string {
    const httpErr = err as { error?: { message?: string } };
    return httpErr?.error?.message ?? this.t('PAYROLL.PAYSLIPS.NOTIFY.ERROR');
  }
}
