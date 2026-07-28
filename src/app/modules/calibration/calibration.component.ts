import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { PayrollApiService, CalibrationCycleDto } from '../../core/payroll-api.service';
import { PaysSelectComponent } from '../../shared/pays-select/pays-select.component';

@Component({
  selector: 'app-calibration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, PaysSelectComponent],
  templateUrl: './calibration.component.html',
  styleUrl: './calibration.component.scss',
})
export class CalibrationComponent {
  private readonly api = inject(PayrollApiService);
  private readonly fb  = inject(FormBuilder);

  readonly loading = signal(false);
  readonly error   = signal<string | null>(null);
  readonly cycles  = signal<CalibrationCycleDto[]>([]);

  readonly openForm = this.fb.group({
    paysId: [null as number | null, Validators.required],
    period: ['', [Validators.required, Validators.pattern(/^\d{4}-\d{2}$/)]],
  });

  uploadCycleId = signal<number | null>(null);
  uploadFile    = signal<File | null>(null);

  loadCycles(): void {
    const paysId = this.openForm.get('paysId')?.value;
    if (!paysId) return;
    this.api.listCalibrationCycles(paysId).subscribe({
      next: c => this.cycles.set(c),
      error: () => {},
    });
  }

  openCycle(): void {
    if (this.openForm.invalid) return;
    const { paysId, period } = this.openForm.getRawValue();
    this.loading.set(true);
    this.api.openCalibrationCycle(paysId!, period!).subscribe({
      next: c => { this.cycles.update(cs => [c, ...cs]); this.loading.set(false); },
      error: err => { this.error.set(err?.error?.message ?? 'Erreur ouverture cycle'); this.loading.set(false); },
    });
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadFile.set(input.files?.[0] ?? null);
  }

  uploadActuals(): void {
    const cycleId = this.uploadCycleId();
    const file    = this.uploadFile();
    if (!cycleId || !file) return;
    this.loading.set(true);
    this.api.uploadActuals(cycleId, file).subscribe({
      next: updated => {
        this.cycles.update(cs => cs.map(c => c.id === updated.id ? updated : c));
        this.loading.set(false);
      },
      error: err => { this.error.set(err?.error?.message ?? 'Erreur import CSV'); this.loading.set(false); },
    });
  }

  statusClass(status: string): string {
    switch (status) {
      case 'OPEN':             return 'badge badge--info';
      case 'CLOSED':           return 'badge badge--success';
      case 'REQUIRES_UPDATE':  return 'badge badge--warn';
      default:                 return 'badge';
    }
  }
}
