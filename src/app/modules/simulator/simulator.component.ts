import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { PayrollApiService, SimulationResultDto } from '../../core/payroll-api.service';
import { UserStore } from '../../core/user.store';
import { PaysSelectComponent } from '../../shared/pays-select/pays-select.component';

@Component({
  selector: 'app-simulator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, PaysSelectComponent],
  templateUrl: './simulator.component.html',
  styleUrl: './simulator.component.scss',
})
export class SimulatorComponent {
  private readonly api       = inject(PayrollApiService);
  private readonly fb        = inject(FormBuilder);
  readonly userStore         = inject(UserStore);

  readonly loading   = signal(false);
  readonly error     = signal<string | null>(null);
  readonly result    = signal<SimulationResultDto | null>(null);

  readonly contractTypes = ['CDI', 'CDD', 'STAGE', 'CIVP'];

  readonly form = this.fb.group({
    paysId:       [null as number | null, [Validators.required]],
    inputNet:     [null as number | null, [Validators.required, Validators.min(1)]],
    contractType: ['CDI'],
  });

  readonly convergenceWarning = computed(() => {
    const r = this.result();
    return r && !r.convergenceOk;
  });

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);

    const { paysId, inputNet, contractType } = this.form.getRawValue();

    this.api.runIndividualSimulation({
      paysId: paysId!,
      inputNet: inputNet!,
      contractType: contractType ?? 'CDI',
    }).subscribe({
      next: res => {
        this.result.set(res);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err?.error?.message ?? 'Erreur lors de la simulation');
        this.loading.set(false);
      },
    });
  }

  reset(): void {
    this.form.reset({ contractType: 'CDI' });
    this.result.set(null);
    this.error.set(null);
  }
}
