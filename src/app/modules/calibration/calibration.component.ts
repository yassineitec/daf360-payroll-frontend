import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent,
  CardComponent,
  DataTableComponent,
  FileUploadComponent,
  FormFieldComponent,
  PageComponent,
  PageHeaderComponent,
  SectionTitleComponent,
  SelectComponent,
  type BadgeVariant,
  type BreadcrumbItem,
  type SelectOption,
  type TableColumn,
  type TableRow,
  type UploadedFile,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, CalibrationCycleDto, PaysDto } from '../../core/payroll-api.service';

/**
 * `/payroll/calibration` — même traitement que les autres pages du module : entièrement
 * construit sur `@khalilrebhiitec/daf360` plutôt que sur du HTML/CSS fait main.
 */
@Component({
  selector: 'app-calibration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    ButtonComponent, CardComponent, DataTableComponent, FileUploadComponent, FormFieldComponent,
    PageComponent, PageHeaderComponent, SectionTitleComponent, SelectComponent,
  ],
  templateUrl: './calibration.component.html',
  styleUrl: './calibration.component.scss',
})
export class CalibrationComponent implements OnInit {
  private readonly api       = inject(PayrollApiService);
  private readonly translate = inject(TranslateService);

  /** Même pattern que `simulator`/`admin` : traduction synchrone pour ce qui ne passe
   *  pas par le pipe `| translate` du template (messages construits en TS). */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.CALIBRATION.BREADCRUMB') },
  ]);

  readonly loading = signal(false);
  readonly error   = signal<string | null>(null);
  readonly cycles  = signal<CalibrationCycleDto[]>([]);

  // ── Pays : `daf-select`, même pattern que le reste du module.
  private readonly paysList = signal<PaysDto[]>([]);
  readonly paysId = signal<number | null>(null);
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})` })),
  );

  ngOnInit(): void {
    this.api.listPays().subscribe(list => this.paysList.set(list));
  }

  readonly period = signal('');
  readonly canOpenCycle = computed(() => !!this.paysId() && /^\d{4}-\d{2}$/.test(this.period()));

  loadCycles(): void {
    const paysId = this.paysId();
    if (!paysId) return;
    this.api.listCalibrationCycles(paysId).subscribe({
      next: c => this.cycles.set(c),
      error: () => {},
    });
  }

  openCycle(): void {
    if (!this.canOpenCycle()) return;
    this.loading.set(true);
    this.api.openCalibrationCycle(this.paysId()!, this.period()).subscribe({
      next: c => { this.cycles.update(cs => [c, ...cs]); this.loading.set(false); },
      error: err => { this.error.set(err?.error?.message ?? this.t('PAYROLL.CALIBRATION.ERROR_OPEN')); this.loading.set(false); },
    });
  }

  readonly uploadCycleId = signal<number | null>(null);
  readonly uploadedFiles = signal<UploadedFile[]>([]);
  readonly canUpload = computed(() => !!this.uploadCycleId() && this.uploadedFiles().length === 1 && !this.uploadedFiles()[0].error);

  uploadActuals(): void {
    const cycleId = this.uploadCycleId();
    const file    = this.uploadedFiles()[0]?.file;
    if (!cycleId || !file) return;
    this.loading.set(true);
    this.api.uploadActuals(cycleId, file).subscribe({
      next: updated => {
        this.cycles.update(cs => cs.map(c => c.id === updated.id ? updated : c));
        this.loading.set(false);
        this.uploadedFiles.set([]);
      },
      error: err => { this.error.set(err?.error?.message ?? this.t('PAYROLL.CALIBRATION.ERROR_UPLOAD')); this.loading.set(false); },
    });
  }

  private statusVariant(status: string): BadgeVariant {
    switch (status) {
      case 'OPEN':            return 'info';
      case 'CLOSED':          return 'success';
      case 'REQUIRES_UPDATE': return 'warning';
      default:                return 'neutral';
    }
  }

  readonly cycleColumns = computed<TableColumn[]>(() => [
    { key: 'id',         label: this.t('PAYROLL.CALIBRATION.COL_ID'), width: '70px' },
    { key: 'period',     label: this.t('PAYROLL.CALIBRATION.COL_PERIOD') },
    { key: 'status',     label: this.t('PAYROLL.CALIBRATION.COL_STATUS'), type: 'badge' },
    { key: 'predicted',  label: this.t('PAYROLL.CALIBRATION.COL_PREDICTED'), type: 'number', align: 'right', format: { maximumFractionDigits: 0 } },
    { key: 'actual',     label: this.t('PAYROLL.CALIBRATION.COL_ACTUAL'),    type: 'number', align: 'right', format: { maximumFractionDigits: 0 } },
    { key: 'variance',   label: this.t('PAYROLL.CALIBRATION.COL_VARIANCE'),  type: 'number', align: 'right', format: { minimumFractionDigits: 2, maximumFractionDigits: 2, suffix: ' %', signColor: true } },
    { key: 'headcount',  label: this.t('PAYROLL.CALIBRATION.COL_HEADCOUNT'), align: 'right' },
  ]);

  readonly cycleRows = computed<TableRow[]>(() =>
    this.cycles().map(c => ({
      id:         c.id,
      period:     c.period,
      status:     { label: this.t(`PAYROLL.CALIBRATION.STATUS.${c.status}`), options: { variant: this.statusVariant(c.status), size: 'sm' as const } },
      predicted:  c.predictedTotalLoadedCost,
      actual:     c.actualTotalLoadedCost,
      variance:   c.variancePct,
      headcount:  c.headcount ?? '—',
    })),
  );
}
