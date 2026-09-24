import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  PayrollApiService,
  PaysDto,
  PayrollBudgetLineDto,
  PayrollForecastOutputDto,
} from '../../core/payroll-api.service';
import {
  ButtonComponent,
  CardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  SelectComponent,
  StatusBadgeComponent,
  type BreadcrumbItem,
  type SelectOption,
} from '@khalilrebhiitec/daf360';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-budget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule, TranslatePipe,
    ButtonComponent, CardComponent, MetricCardComponent,
    PageComponent, PageHeaderComponent, SelectComponent, StatusBadgeComponent,
  ],
  templateUrl: './budget.component.html',
  styleUrl: './budget.component.scss',
})
export class BudgetComponent implements OnInit {
  private readonly api       = inject(PayrollApiService);
  private readonly translate = inject(TranslateService);

  /** Même pattern que `simulator`/`admin`/`calibration`/`cohort`. */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.BUDGET.BREADCRUMB') },
  ]);

  readonly loading      = signal(false);
  readonly error        = signal<string | null>(null);
  readonly budgetLines  = signal<PayrollBudgetLineDto[]>([]);
  readonly forecasts    = signal<PayrollForecastOutputDto[]>([]);

  // ── Pays : `daf-select`, même besoin déjà couvert par la bibliothèque dans
  //    engine-run/engine-results — liste chargée une fois.
  private readonly paysList = signal<PaysDto[]>([]);
  readonly paysId = signal<number | null>(null);
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})` })),
  );

  ngOnInit(): void {
    this.api.listPays().subscribe(list => this.paysList.set(list));
  }

  /** Most recent period's budget lines (EMPLOYER_LOADED + EMPLOYEE_NET). */
  readonly latestLines = computed(() => {
    const all = this.budgetLines();
    if (!all.length) return [];
    const latest = all[0].period;
    return all.filter(l => l.period === latest);
  });

  /** Most recent period's forecast outputs (MONTHLY, QUARTERLY, ANNUAL). */
  readonly latestForecasts = computed(() => {
    const all = this.forecasts();
    if (!all.length) return [];
    const latest = all[0].period;
    return all.filter(f => f.period === latest);
  });

  readonly latestPeriod = computed(() => this.latestLines()[0]?.period ?? null);
  readonly headcount    = computed(() => this.latestLines()[0]?.headcount ?? null);
  readonly currency     = computed(() => this.latestLines()[0]?.localCurrency ?? '');

  readonly employerLine  = computed(() =>
    this.latestLines().find(l => l.lineType === 'EMPLOYER_LOADED') ?? null);
  readonly employeeLine  = computed(() =>
    this.latestLines().find(l => l.lineType === 'EMPLOYEE_NET') ?? null);

  readonly monthlyForecast   = computed(() =>
    this.latestForecasts().find(f => f.forecastType === 'MONTHLY') ?? null);
  readonly quarterlyForecast = computed(() =>
    this.latestForecasts().find(f => f.forecastType === 'QUARTERLY') ?? null);
  readonly annualForecast    = computed(() =>
    this.latestForecasts().find(f => f.forecastType === 'ANNUAL') ?? null);

  load(): void {
    const paysId = this.paysId();
    if (!paysId) return;

    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      lines:     this.api.getBudgetLines(paysId),
      forecasts: this.api.getForecastOutputs(paysId),
    }).subscribe({
      next: ({ lines, forecasts }) => {
        this.budgetLines.set(lines);
        this.forecasts.set(forecasts);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err?.error?.message ?? this.t('PAYROLL.BUDGET.ERROR'));
        this.loading.set(false);
      },
    });
  }

  fmt(v: number | null | undefined, dec = 0): string {
    if (v == null) return '—';
    const locale = this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR';
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    }).format(v);
  }

  lineTypeLabel(lineType: string): string {
    return lineType === 'EMPLOYER_LOADED'
      ? this.t('PAYROLL.BUDGET.LINE_TYPE_EMPLOYER')
      : this.t('PAYROLL.BUDGET.LINE_TYPE_EMPLOYEE');
  }

  /** Older periods grouped for the history table. */
  historyPeriods(): string[] {
    const latest = this.latestPeriod();
    return [...new Set(this.budgetLines().map(l => l.period))]
      .filter(p => p !== latest)
      .sort()
      .reverse();
  }

  linesForPeriod(period: string): PayrollBudgetLineDto[] {
    return this.budgetLines().filter(l => l.period === period);
  }
}
