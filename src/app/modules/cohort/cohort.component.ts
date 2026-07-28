import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { PayrollApiService, SimulationResultDto } from '../../core/payroll-api.service';
import { PaysSelectComponent } from '../../shared/pays-select/pays-select.component';

@Component({
  selector: 'app-cohort',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, PaysSelectComponent],
  templateUrl: './cohort.component.html',
  styleUrl: './cohort.component.scss',
})
export class CohortComponent {
  private readonly api = inject(PayrollApiService);
  private readonly fb  = inject(FormBuilder);

  readonly loading  = signal(false);
  readonly error    = signal<string | null>(null);
  readonly results  = signal<SimulationResultDto[]>([]);

  readonly form = this.fb.group({
    paysId:     [null as number | null, Validators.required],
    fiscalYear: [new Date().getFullYear(), Validators.required],
    cohortName: [''],
    csvText:    ['', Validators.required],
  });

  get totalLoadedCost(): number {
    return this.results().reduce((s, r) => s + r.loadedCost, 0);
  }

  get totalLoadedCostEur(): number | null {
    const arr = this.results().filter(r => r.loadedCostEur != null);
    return arr.length ? arr.reduce((s, r) => s + r.loadedCostEur!, 0) : null;
  }

  get totalLoadedCostUsd(): number | null {
    const arr = this.results().filter(r => r.loadedCostUsd != null);
    return arr.length ? arr.reduce((s, r) => s + r.loadedCostUsd!, 0) : null;
  }

  submit(): void {
    if (this.form.invalid) return;
    const { paysId, fiscalYear, cohortName, csvText } = this.form.getRawValue();

    const employees = (csvText ?? '').split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map(line => {
        const [net, ct] = line.split(',').map(p => p.trim());
        return { inputNet: parseFloat(net), contractType: ct || 'CDI' };
      })
      .filter(e => !isNaN(e.inputNet));

    if (!employees.length) {
      this.error.set('Aucun employé valide dans la liste');
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.results.set([]);

    this.api.runCohortSimulation({
      paysId: paysId!,
      fiscalYear: fiscalYear!,
      cohortName: cohortName || undefined,
      employees,
    }).subscribe({
      next: res => { this.results.set(res); this.loading.set(false); },
      error: err => {
        this.error.set(err?.error?.message ?? 'Erreur lors de la simulation cohorte');
        this.loading.set(false);
      },
    });
  }
}
