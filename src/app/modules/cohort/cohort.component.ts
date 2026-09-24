import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  CohortAggregateResponse,
  PayrollApiService,
  PaysDto,
} from '../../core/payroll-api.service';
import {
  ButtonComponent,
  CardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  FormFieldComponent,
  SelectComponent,
  type SelectOption,
  type MetricDelta,
  type BreadcrumbItem,
} from '@khalilrebhiitec/daf360';

@Component({
  selector: 'app-cohort',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule, TranslatePipe,
    ButtonComponent, CardComponent, MetricCardComponent,
    PageComponent, PageHeaderComponent, FormFieldComponent, SelectComponent,
  ],
  templateUrl: './cohort.component.html',
  styleUrl: './cohort.component.scss',
})
export class CohortComponent implements OnInit {
  private readonly api       = inject(PayrollApiService);
  private readonly translate = inject(TranslateService);

  /** Même pattern que `simulator`/`admin`/`calibration`. */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.COHORT.BREADCRUMB') },
  ]);

  readonly loading  = signal(false);
  readonly error    = signal<string | null>(null);
  readonly result   = signal<CohortAggregateResponse | null>(null);

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

  // Signal-based form state — cleaner with OnPush + daf360 components
  readonly grade         = signal('');
  readonly discipline    = signal('');
  readonly contractType  = signal('');
  readonly entite        = signal('');
  readonly modifierType  = signal('PCT');
  readonly modifierValue = signal(0);

  readonly contractTypeOptions = computed<SelectOption[]>(() => [
    { value: '',    label: this.t('PAYROLL.COHORT.CONTRACT_ALL') },
    { value: 'CDI', label: 'CDI' },
    { value: 'CDD', label: 'CDD' },
  ]);

  readonly modifierTypeOptions = computed<SelectOption[]>(() => [
    { value: 'PCT',    label: this.t('PAYROLL.COHORT.MODIFIER_PCT') },
    { value: 'ABSOLU', label: this.t('PAYROLL.COHORT.MODIFIER_ABSOLUTE') },
  ]);

  submit(): void {
    const paysId = this.paysId();
    if (!paysId) return;

    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);

    this.api.runCohortAggregate({
      paysId,
      grade:        this.grade()        || null,
      discipline:   this.discipline()   || null,
      contractType: this.contractType() || null,
      entite:       this.entite()       || null,
      modifierType: this.modifierType(),
      modifierValue:this.modifierValue(),
    }).subscribe({
      next:  res => { this.result.set(res);  this.loading.set(false); },
      error: err => {
        this.error.set(err?.error?.message ?? this.t('PAYROLL.COHORT.ERROR'));
        this.loading.set(false);
      },
    });
  }

  fmt(v: number | null | undefined, dec = 2): string {
    if (v == null) return '—';
    const locale = this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR';
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    }).format(v);
  }

  deltaMetric(r: CohortAggregateResponse, monthly = true): MetricDelta {
    const v = monthly ? r.deltaMonthly : r.deltaAnnual;
    const prefix = v > 0 ? '+' : '';
    const direction: 'up' | 'down' | 'neutral' = v > 0 ? 'up' : v < 0 ? 'down' : 'neutral';
    return { value: `${prefix}${this.fmt(v)} ${r.localCurrency ?? ''}`, direction };
  }
}
