import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { PayrollEngineService, RunPayrollResponse, RubriqueResultItem } from '../../core/payroll-engine.service';
import { PaysSelectComponent } from '../../shared/pays-select/pays-select.component';
import { EmployeeSelectComponent } from '../../shared/employee-select/employee-select.component';

@Component({
  selector: 'app-engine-run',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, PaysSelectComponent, EmployeeSelectComponent],
  template: `
    <div class="page-header">
      <h1 class="page-title">Calcul de paie</h1>
      <p class="page-subtitle">Exécuter le moteur de paie pour un employé</p>
    </div>

    <div class="card form-card">
      <form [formGroup]="form" (ngSubmit)="run()">
        <div class="form-grid">
          <div class="form-field">
            <label>Pays</label>
            <app-pays-select formControlName="paysId" />
          </div>
          <div class="form-field">
            <label>Employé</label>
            <app-employee-select formControlName="employeeId" [paysId]="selectedPaysId()" />
          </div>
          <div class="form-field">
            <label>Année</label>
            <input type="number" formControlName="periodYear" placeholder="2026" />
          </div>
          <div class="form-field">
            <label>Mois</label>
            <input type="number" formControlName="periodMonth" min="1" max="12" placeholder="1-12" />
          </div>
          <div class="form-field">
            <label>Type de contrat</label>
            <select formControlName="contractTypeCode">
              <option value="CDI">CDI</option>
              <option value="CDD">CDD</option>
              <option value="STAGE">Stage</option>
              <option value="CIVP">CIVP</option>
            </select>
          </div>
          <div class="form-field">
            <label>Jours ouvrés du mois</label>
            <input type="number" formControlName="joursOuvresMois" placeholder="22" />
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn--primary" [disabled]="form.invalid || running()">
            {{ running() ? 'Calcul en cours...' : 'Lancer le calcul' }}
          </button>
        </div>
        @if (error()) {
          <div class="alert alert--error">{{ error() }}</div>
        }
      </form>
    </div>

    @if (result()) {
      <div class="card result-card">
        <h2 class="card-title">
          Résultat — Employé {{ result()!.employeeId }} —
          {{ result()!.periodMonth }}/{{ result()!.periodYear }}
        </h2>
        <div class="strate-grid">
          <div class="strate-item">
            <span class="strate-label">Salaire brut</span>
            <span class="strate-value">{{ result()!.strate1 | number:'1.2-2' }}</span>
          </div>
          <div class="strate-item">
            <span class="strate-label">Avantages</span>
            <span class="strate-value">{{ result()!.strate2 | number:'1.2-2' }}</span>
          </div>
          <div class="strate-item">
            <span class="strate-label">Charges salariales</span>
            <span class="strate-value">{{ result()!.strate3 | number:'1.2-2' }}</span>
          </div>
          <div class="strate-item">
            <span class="strate-label">Net imposable</span>
            <span class="strate-value">{{ result()!.strate4 | number:'1.2-2' }}</span>
          </div>
          <div class="strate-item strate-item--highlight">
            <span class="strate-label">Net à payer</span>
            <span class="strate-value">{{ result()!.strate5 | number:'1.2-2' }}</span>
          </div>
          <div class="strate-item">
            <span class="strate-label">Coût chargé</span>
            <span class="strate-value">{{ result()!.loadedCost | number:'1.2-2' }}</span>
          </div>
          <div class="strate-item">
            <span class="strate-label">IRPP</span>
            <span class="strate-value">{{ result()!.aggregateIrpp | number:'1.2-2' }}</span>
          </div>
          <div class="strate-item">
            <span class="strate-label">Convergence</span>
            <span class="strate-value" [class.badge--active]="result()!.convergenceOk" [class.badge--error]="!result()!.convergenceOk">
              {{ result()!.convergenceOk ? 'OK' : 'Échec' }}
              @if (result()!.iterationsUsed) { ({{ result()!.iterationsUsed }} it.) }
            </span>
          </div>
        </div>

        <h3 class="section-title">Détail par rubrique</h3>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Libellé</th>
                <th>Strate</th>
                <th>Nature</th>
                <th>Assiette</th>
                <th>Montant</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              @for (r of result()!.rubriqueDetails; track r.rubriqueCode) {
                <tr>
                  <td><code>{{ r.rubriqueCode }}</code></td>
                  <td>{{ r.labelFr }}</td>
                  <td><span class="badge">S{{ r.strate }}</span></td>
                  <td><span class="badge" [class]="natureClass(r.nature)">{{ r.nature }}</span></td>
                  <td>{{ r.assiette | number:'1.2-2' }}</td>
                  <td class="amount">{{ r.amount | number:'1.2-2' }}</td>
                  <td>{{ r.modeCalcul }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
  styles: [`
    .page-header { margin-bottom: 1.5rem; }
    .page-title  { font-size: 1.5rem; font-weight: 600; margin: 0 0 .25rem; }
    .page-subtitle { color: var(--color-text-muted, #6b7280); margin: 0; }
    .card        { background: var(--color-surface, #fff); border-radius: 8px; padding: 1.5rem;
                   border: 1px solid var(--color-border, #e5e7eb); margin-bottom: 1.5rem; }
    .form-grid   { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .form-field  { display: flex; flex-direction: column; gap: .375rem; }
    .form-field label { font-size: .875rem; font-weight: 500; }
    .form-field input, .form-field select {
      padding: .5rem .75rem; border: 1px solid var(--color-border, #d1d5db);
      border-radius: 6px; font-size: .875rem; }
    .form-actions { display: flex; gap: .75rem; margin-top: 1rem; }
    .btn         { padding: .5rem 1.25rem; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; }
    .btn--primary { background: var(--color-primary, #3b82f6); color: #fff; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .alert--error { background: #fee2e2; color: #991b1b; padding: .75rem 1rem; border-radius: 6px; margin-top: 1rem; font-size: .875rem; }
    .strate-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .strate-item { padding: 1rem; border-radius: 8px; background: var(--color-surface-alt, #f9fafb);
                   border: 1px solid var(--color-border, #e5e7eb); display: flex; flex-direction: column; gap: .25rem; }
    .strate-item--highlight { border-color: var(--color-primary, #3b82f6); background: #eff6ff; }
    .strate-label { font-size: .75rem; color: var(--color-text-muted, #6b7280); text-transform: uppercase; letter-spacing: .05em; }
    .strate-value { font-size: 1.125rem; font-weight: 600; }
    .section-title { font-size: 1rem; font-weight: 600; margin: 0 0 1rem; }
    .table-wrapper { overflow-x: auto; }
    .data-table  { width: 100%; border-collapse: collapse; font-size: .875rem; }
    .data-table th { background: var(--color-surface-alt, #f9fafb); padding: .625rem .75rem;
                     text-align: left; font-weight: 500; border-bottom: 1px solid var(--color-border, #e5e7eb); }
    .data-table td { padding: .625rem .75rem; border-bottom: 1px solid var(--color-border, #e5e7eb); }
    .badge       { font-size: .7rem; padding: .2rem .5rem; border-radius: 9999px;
                   background: var(--color-surface-alt, #f3f4f6); }
    .badge--active { color: #065f46; background: #d1fae5; }
    .badge--error  { color: #991b1b; background: #fee2e2; }
    .amount      { text-align: right; font-variant-numeric: tabular-nums; }
    code         { font-size: .8rem; background: var(--color-surface-alt, #f3f4f6);
                   padding: .1rem .3rem; border-radius: 4px; }
  `],
})
export class EngineRunComponent {
  private readonly api = inject(PayrollEngineService);
  private readonly fb  = inject(FormBuilder);

  readonly running = signal(false);
  readonly error   = signal<string | null>(null);
  readonly result  = signal<RunPayrollResponse | null>(null);

  readonly form = this.fb.group({
    paysId:           [null as number | null, Validators.required],
    employeeId:       [null as number | null, Validators.required],
    periodYear:       [new Date().getFullYear(), Validators.required],
    periodMonth:      [new Date().getMonth() + 1, [Validators.required, Validators.min(1), Validators.max(12)]],
    contractTypeCode: ['CDI', Validators.required],
    joursOuvresMois:  [22, [Validators.required, Validators.min(1)]],
  });

  readonly selectedPaysId = toSignal(this.form.controls.paysId.valueChanges, { initialValue: null as number | null });

  run(): void {
    if (this.form.invalid) return;
    this.running.set(true);
    this.error.set(null);
    this.result.set(null);
    const v = this.form.getRawValue();
    this.api.runPayroll({
      employeeId:       v.employeeId!,
      paysId:           v.paysId!,
      periodYear:       v.periodYear!,
      periodMonth:      v.periodMonth!,
      contractTypeCode: v.contractTypeCode!,
      joursOuvresMois:  v.joursOuvresMois!,
    }).subscribe({
      next: r  => { this.result.set(r); this.running.set(false); },
      error: e => { this.error.set(e?.error?.message ?? 'Erreur lors du calcul'); this.running.set(false); },
    });
  }

  natureClass(nature: string): string {
    switch (nature) {
      case 'GAIN':      return 'badge badge--active';
      case 'RETENUE':   return 'badge badge--error';
      case 'AVANTAGE':  return 'badge badge--avantage';
      default:          return 'badge';
    }
  }
}
