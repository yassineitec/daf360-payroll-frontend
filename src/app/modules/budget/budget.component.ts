import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  PayrollApiService,
  PayrollBudgetLineDto,
  PayrollForecastOutputDto,
} from '../../core/payroll-api.service';
import { PaysSelectComponent } from '../../shared/pays-select/pays-select.component';
import {
  ButtonComponent,
  CardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
} from '@khalilrebhiitec/daf360';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-budget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule, PaysSelectComponent,
    ButtonComponent, CardComponent, MetricCardComponent,
    PageComponent, PageHeaderComponent,
  ],
  templateUrl: './budget.component.html',
  styleUrl: './budget.component.scss',
})
export class BudgetComponent {
  private readonly api = inject(PayrollApiService);

  readonly loading      = signal(false);
  readonly error        = signal<string | null>(null);
  readonly budgetLines  = signal<PayrollBudgetLineDto[]>([]);
  readonly forecasts    = signal<PayrollForecastOutputDto[]>([]);
  readonly paysIdCtrl   = new FormControl<number | null>(null);

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
    const paysId = this.paysIdCtrl.value;
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
        this.error.set(err?.error?.message ?? 'Erreur lors du chargement des données budgétaires');
        this.loading.set(false);
      },
    });
  }

  fmt(v: number | null | undefined, dec = 0): string {
    if (v == null) return '—';
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    }).format(v);
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
