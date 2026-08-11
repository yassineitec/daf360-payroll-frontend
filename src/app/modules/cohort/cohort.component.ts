import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  CohortAggregateResponse,
  PayrollApiService,
} from '../../core/payroll-api.service';
import { PaysSelectComponent } from '../../shared/pays-select/pays-select.component';
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
} from '@khalilrebhiitec/daf360';

@Component({
  selector: 'app-cohort',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule, PaysSelectComponent,
    ButtonComponent, CardComponent, MetricCardComponent,
    PageComponent, PageHeaderComponent, FormFieldComponent, SelectComponent,
  ],
  templateUrl: './cohort.component.html',
  styleUrl: './cohort.component.scss',
})
export class CohortComponent {
  private readonly api = inject(PayrollApiService);

  readonly loading  = signal(false);
  readonly error    = signal<string | null>(null);
  readonly result   = signal<CohortAggregateResponse | null>(null);

  // Signal-based form state — cleaner with OnPush + daf360 components
  readonly paysIdCtrl    = new FormControl<number | null>(null);
  readonly grade         = signal('');
  readonly discipline    = signal('');
  readonly contractType  = signal('');
  readonly entite        = signal('');
  readonly modifierType  = signal('PCT');
  readonly modifierValue = signal(0);

  readonly contractTypeOptions: SelectOption[] = [
    { value: '',    label: 'Tous' },
    { value: 'CDI', label: 'CDI' },
    { value: 'CDD', label: 'CDD' },
  ];

  readonly modifierTypeOptions: SelectOption[] = [
    { value: 'PCT',    label: 'Pourcentage (%)' },
    { value: 'ABSOLU', label: 'Montant absolu (devise locale)' },
  ];

  submit(): void {
    const paysId = this.paysIdCtrl.value;
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
        this.error.set(err?.error?.message ?? 'Erreur lors de la simulation cohorte');
        this.loading.set(false);
      },
    });
  }

  fmt(v: number | null | undefined, dec = 2): string {
    if (v == null) return '—';
    return new Intl.NumberFormat('fr-FR', {
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
