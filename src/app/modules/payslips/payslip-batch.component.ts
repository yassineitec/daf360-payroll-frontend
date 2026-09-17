import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, map, of, startWith } from 'rxjs';

import { PaysSelectComponent } from '../../shared/pays-select/pays-select.component';
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
 */
@Component({
  selector: 'app-payslip-batch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, PaysSelectComponent, TranslatePipe],
  templateUrl: './payslip-batch.component.html',
  styleUrl: './payslip-batch.component.scss',
})
export class PayslipBatchComponent {
  private readonly svc      = inject(PayslipBatchService);
  private readonly fb       = inject(FormBuilder);
  protected readonly translate = inject(TranslateService);

  readonly form = this.fb.group({
    paysId:      [null as number | null, Validators.required],
    periodYear:  [new Date().getFullYear(), Validators.required],
    periodMonth: [new Date().getMonth() + 1, Validators.required],
  });

  readonly file        = signal<File | null>(null);
  readonly processing  = signal(false);
  readonly result      = signal<PayslipBatchResult | null>(null);
  readonly errorMessage   = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  /** `FormGroup.valid` is a plain getter, not a signal — reading it directly inside a
   * `computed()` would only re-check it on the rare occasions `file`/`processing` also
   * change, so picking a country (which touches none of those) could leave the "Traiter
   * le fichier" button stuck disabled even once the form was actually valid. Routed
   * through `statusChanges` + `toSignal` instead, so every field edit is tracked. */
  private readonly formValid = toSignal(
    this.form.statusChanges.pipe(map(() => this.form.valid), startWith(this.form.valid)),
    { initialValue: this.form.valid },
  );

  readonly monthOptions = computed(() => {
    this.translate.currentLang();
    return MONTH_KEYS.map((key, i) => ({
      value: i + 1,
      label: this.translate.instant(`PAYROLL.PAYSLIPS.MONTHS.${key}`),
    }));
  });

  readonly canSubmit = computed(() =>
    !this.processing() && this.formValid() && !!this.file());

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file.set(input.files?.[0] ?? null);
  }

  submit(): void {
    if (!this.canSubmit()) return;
    const { paysId, periodYear, periodMonth } = this.form.getRawValue();
    const file = this.file()!;

    this.processing.set(true);
    this.result.set(null);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.svc.processBatch(file, paysId!, periodYear!, periodMonth!).pipe(
      catchError(err => {
        this.errorMessage.set(this.extractErrorMessage(err));
        return of(null);
      }),
    ).subscribe(result => {
      this.processing.set(false);
      if (!result) return;
      this.result.set(result);
      this.successMessage.set(this.translate.instant('PAYROLL.PAYSLIPS.NOTIFY.DONE', {
        success: result.successCount, total: result.totalPages,
      }));
    });
  }

  statusLabel(status: PayslipPageStatus): string {
    return this.translate.instant(`PAYROLL.PAYSLIPS.STATUS.${status}`);
  }

  statusClass(status: PayslipPageStatus): string {
    switch (status) {
      case 'SUCCESS':      return 'badge badge--success';
      case 'ERROR':        return 'badge badge--error';
      case 'UNIDENTIFIED': return 'badge badge--warning';
      case 'DUPLICATE':    return 'badge badge--info';
    }
  }

  private extractErrorMessage(err: unknown): string {
    const httpErr = err as { error?: { message?: string } };
    return httpErr?.error?.message ?? this.translate.instant('PAYROLL.PAYSLIPS.NOTIFY.ERROR');
  }
}
