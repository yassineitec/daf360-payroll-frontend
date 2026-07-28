import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { PayrollApiService, ParameterSetDto } from '../../core/payroll-api.service';
import { PaysSelectComponent } from '../../shared/pays-select/pays-select.component';

@Component({
  selector: 'app-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, PaysSelectComponent],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent {
  private readonly api = inject(PayrollApiService);
  private readonly fb  = inject(FormBuilder);

  readonly loading = signal(false);
  readonly error   = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  readonly contractTypes   = ['CDI', 'CDD', 'STAGE', 'CIVP'];
  readonly baseCalcOptions = [
    { value: 'GROSS',        label: 'Brut' },
    { value: 'CAPPED_GROSS', label: 'Brut plafonné' },
    { value: 'FIXED',        label: 'Fixe' },
  ];

  readonly form = this.fb.group({
    paysId:                   [null as number | null, Validators.required],
    fiscalYear:               [new Date().getFullYear(), Validators.required],
    irppBrackets:             ['[]', Validators.required],
    convergenceTolerance:     [0.01],
    maxConvergenceIterations: [50],
    calibrationThresholdPct:  [1.00],
    changeRationale:          [''],
    socialChargeRates:        this.fb.array([]),
  });

  get rates(): FormArray { return this.form.get('socialChargeRates') as FormArray; }
  rateGroup(i: number): FormGroup { return this.rates.at(i) as FormGroup; }

  addRate(): void {
    this.rates.push(this.fb.group({
      contractType:    ['CDI'],
      chargeCode:      ['', Validators.required],
      chargeLabel:     ['', Validators.required],
      employeeRate:    [0, [Validators.required, Validators.min(0), Validators.max(1)]],
      employerRate:    [0, [Validators.required, Validators.min(0), Validators.max(1)]],
      baseCalculation: ['GROSS'],
      capAmount:       [null],
    }));
  }

  removeRate(i: number): void { this.rates.removeAt(i); }

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.success.set(null);

    const raw = this.form.getRawValue();

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
        this.success.set(
          `Jeu de paramètres v${ps.version} créé (DRAFT)${n ? ` avec ${n} charge(s) sociale(s)` : ''}. Soumettez-le pour le workflow d'approbation.`
        );
        this.loading.set(false);
        this.form.reset({
          fiscalYear:               new Date().getFullYear(),
          irppBrackets:             '[]',
          convergenceTolerance:     0.01,
          maxConvergenceIterations: 50,
          calibrationThresholdPct:  1.00,
        });
        while (this.rates.length) this.rates.removeAt(0);
      },
      error: err => {
        this.error.set(err?.error?.message ?? 'Erreur création');
        this.loading.set(false);
      },
    });
  }
}
