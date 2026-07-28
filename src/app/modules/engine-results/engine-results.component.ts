import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { PayrollEngineService, RunPayrollResponse } from '../../core/payroll-engine.service';
import { EmployeeSelectComponent } from '../../shared/employee-select/employee-select.component';

@Component({
  selector: 'app-engine-results',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, EmployeeSelectComponent],
  template: `
    <div class="page-header">
      <h1 class="page-title">Historique de paie</h1>
      <p class="page-subtitle">Résultats des calculs de paie par employé</p>
    </div>

    <div class="card">
      <form [formGroup]="form" (ngSubmit)="load()" class="filter-row">
        <div class="form-field">
          <label>Employé</label>
          <app-employee-select formControlName="employeeId" [paysId]="null" />
        </div>
        <button type="submit" class="btn btn--primary" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Chargement...' : 'Rechercher' }}
        </button>
      </form>
      @if (error()) {
        <div class="alert alert--error">{{ error() }}</div>
      }
    </div>

    @if (results().length > 0) {
      <div class="card">
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Période</th>
                <th>Brut</th>
                <th>Net imposable</th>
                <th>Net à payer</th>
                <th>IRPP</th>
                <th>Coût chargé</th>
                <th>Convergence</th>
                <th>Calculé le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (r of results(); track r.resultId) {
                <tr>
                  <td>{{ r.resultId }}</td>
                  <td>{{ r.periodMonth }}/{{ r.periodYear }}</td>
                  <td class="amount">{{ r.aggregateGross | number:'1.2-2' }}</td>
                  <td class="amount">{{ r.strate4 | number:'1.2-2' }}</td>
                  <td class="amount">{{ r.strate5 | number:'1.2-2' }}</td>
                  <td class="amount">{{ r.aggregateIrpp | number:'1.2-2' }}</td>
                  <td class="amount">{{ r.loadedCost | number:'1.2-2' }}</td>
                  <td>
                    <span class="badge" [class.badge--active]="r.convergenceOk" [class.badge--error]="!r.convergenceOk">
                      {{ r.convergenceOk ? 'OK' : 'Échec' }}
                    </span>
                  </td>
                  <td>{{ r.calculatedAt | date:'dd/MM/yyyy HH:mm' }}</td>
                  <td>
                    <button class="btn btn--sm" (click)="toggleDetail(r.resultId)">
                      {{ expanded() === r.resultId ? '▲' : '▼' }}
                    </button>
                  </td>
                </tr>
                @if (expanded() === r.resultId) {
                  <tr class="detail-row">
                    <td colspan="10">
                      <table class="data-table inner-table">
                        <thead>
                          <tr>
                            <th>Code</th><th>Libellé</th><th>Strate</th>
                            <th>Nature</th><th>Assiette</th><th>Montant</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (d of r.rubriqueDetails; track d.rubriqueCode) {
                            <tr>
                              <td><code>{{ d.rubriqueCode }}</code></td>
                              <td>{{ d.labelFr }}</td>
                              <td><span class="badge">S{{ d.strate }}</span></td>
                              <td>{{ d.nature }}</td>
                              <td class="amount">{{ d.assiette | number:'1.2-2' }}</td>
                              <td class="amount">{{ d.amount | number:'1.2-2' }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>
    } @else if (!loading() && searched()) {
      <div class="card empty-state">Aucun résultat trouvé pour cet employé.</div>
    }
  `,
  styles: [`
    .page-header  { margin-bottom: 1.5rem; }
    .page-title   { font-size: 1.5rem; font-weight: 600; margin: 0 0 .25rem; }
    .page-subtitle { color: var(--color-text-muted, #6b7280); margin: 0; }
    .card         { background: var(--color-surface, #fff); border-radius: 8px; padding: 1.5rem;
                    border: 1px solid var(--color-border, #e5e7eb); margin-bottom: 1.5rem; }
    .filter-row   { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
    .form-field   { display: flex; flex-direction: column; gap: .375rem; }
    .form-field label { font-size: .875rem; font-weight: 500; }
    .btn          { padding: .5rem 1.25rem; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; }
    .btn--primary { background: var(--color-primary, #3b82f6); color: #fff; }
    .btn--sm      { padding: .25rem .5rem; font-size: .8rem; background: var(--color-surface-alt, #f3f4f6); }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .alert--error { background: #fee2e2; color: #991b1b; padding: .75rem 1rem; border-radius: 6px; margin-top: 1rem; font-size: .875rem; }
    .table-wrapper { overflow-x: auto; }
    .data-table   { width: 100%; border-collapse: collapse; font-size: .875rem; }
    .data-table th { background: var(--color-surface-alt, #f9fafb); padding: .625rem .75rem;
                     text-align: left; font-weight: 500; border-bottom: 1px solid var(--color-border, #e5e7eb); }
    .data-table td { padding: .625rem .75rem; border-bottom: 1px solid var(--color-border, #e5e7eb); }
    .badge        { font-size: .7rem; padding: .2rem .5rem; border-radius: 9999px; background: var(--color-surface-alt, #f3f4f6); }
    .badge--active { color: #065f46; background: #d1fae5; }
    .badge--error  { color: #991b1b; background: #fee2e2; }
    .amount       { text-align: right; font-variant-numeric: tabular-nums; }
    .detail-row   { background: var(--color-surface-alt, #fafafa); }
    .inner-table  { margin: .5rem 0; }
    .empty-state  { text-align: center; color: var(--color-text-muted, #6b7280); }
    code          { font-size: .8rem; background: var(--color-surface-alt, #f3f4f6);
                    padding: .1rem .3rem; border-radius: 4px; }
  `],
})
export class EngineResultsComponent {
  private readonly api = inject(PayrollEngineService);
  private readonly fb  = inject(FormBuilder);

  readonly loading  = signal(false);
  readonly error    = signal<string | null>(null);
  readonly results  = signal<RunPayrollResponse[]>([]);
  readonly expanded = signal<number | null>(null);
  readonly searched = signal(false);

  readonly form = this.fb.group({
    employeeId: [null as number | null, Validators.required],
  });

  load(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.searched.set(false);
    this.api.getResults(this.form.getRawValue().employeeId!).subscribe({
      next: r  => { this.results.set(r); this.loading.set(false); this.searched.set(true); },
      error: e => { this.error.set(e?.error?.message ?? 'Erreur'); this.loading.set(false); },
    });
  }

  toggleDetail(id: number): void {
    this.expanded.set(this.expanded() === id ? null : id);
  }
}
