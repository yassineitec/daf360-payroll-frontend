import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { PayrollEngineService, RunPayrollResponse } from '../../core/payroll-engine.service';
import { CandidateSimulationService, CandidateSimulationSummaryDto, CandidateCostApprovalDto } from '../../core/candidate-simulation.service';
import { EmployeeSelectComponent } from '../../shared/employee-select/employee-select.component';

type Tab = 'employees' | 'candidates';
const STATUS_LABEL: Record<string, string> = { PENDING: 'En attente', APPROVED: 'Approuvé', REJECTED: 'Refusé' };
const STATUS_CLASS: Record<string, string> = { PENDING: 'badge--warn', APPROVED: 'badge--active', REJECTED: 'badge--error' };

@Component({
  selector: 'app-engine-results',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, EmployeeSelectComponent],
  template: `
    <div class="page-header">
      <h1 class="page-title">Historique de paie & simulations</h1>
      <p class="page-subtitle">Résultats des calculs par employé et historique des simulations candidats</p>
    </div>

    <!-- ── Tab bar ─────────────────────────────────────────────────────────── -->
    <div class="tabs">
      <button class="tab-btn" [class.tab-btn--active]="activeTab() === 'employees'"
              (click)="switchTab('employees')">
        Historique de paie
      </button>
      <button class="tab-btn" [class.tab-btn--active]="activeTab() === 'candidates'"
              (click)="switchTab('candidates')">
        Simulations candidats
        @if (candidateList().length > 0) {
          <span class="tab-count">{{ candidateList().length }}</span>
        }
      </button>
    </div>

    <!-- ══════════════════════ TAB 1 — EMPLOYEES ══════════════════════════ -->
    @if (activeTab() === 'employees') {
      <div class="card">
        <form [formGroup]="form" (ngSubmit)="loadEmployeeResults()" class="filter-row">
          <div class="form-field">
            <label>Employé</label>
            <app-employee-select formControlName="employeeId" [paysId]="null" />
          </div>
          <button type="submit" class="btn btn--primary" [disabled]="form.invalid || empLoading()">
            {{ empLoading() ? 'Chargement...' : 'Rechercher' }}
          </button>
        </form>
        @if (empError()) {
          <div class="alert alert--error">{{ empError() }}</div>
        }
      </div>

      @if (results().length > 0) {
        <div class="card">
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ID</th><th>Période</th><th>Brut</th><th>Net imposable</th>
                  <th>Net à payer</th><th>IRPP</th><th>Coût chargé</th>
                  <th>Convergence</th><th>Calculé le</th><th></th>
                </tr>
              </thead>
              <tbody>
                @for (r of results(); track r.resultId) {
                  <tr>
                    <td>{{ r.resultId }}</td>
                    <td>{{ r.periodMonth }}/{{ r.periodYear }}</td>
                    <td class="amount">{{ r.aggregateGross   | number:'1.2-2' }}</td>
                    <td class="amount">{{ r.strate4          | number:'1.2-2' }}</td>
                    <td class="amount">{{ r.strate5          | number:'1.2-2' }}</td>
                    <td class="amount">{{ r.aggregateIrpp    | number:'1.2-2' }}</td>
                    <td class="amount">{{ r.loadedCost       | number:'1.2-2' }}</td>
                    <td>
                      <span class="badge" [class.badge--active]="r.convergenceOk" [class.badge--error]="!r.convergenceOk">
                        {{ r.convergenceOk ? 'OK' : 'Échec' }}
                      </span>
                    </td>
                    <td>{{ r.calculatedAt | date:'dd/MM/yyyy HH:mm' }}</td>
                    <td>
                      <button class="btn btn--sm" (click)="toggleDetail(r.resultId)">
                        {{ expandedResult() === r.resultId ? '▲' : '▼' }}
                      </button>
                    </td>
                  </tr>
                  @if (expandedResult() === r.resultId) {
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
                                <td class="amount">{{ d.amount   | number:'1.2-2' }}</td>
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
      } @else if (!empLoading() && empSearched()) {
        <div class="card empty-state">Aucun résultat trouvé pour cet employé.</div>
      }
    }

    <!-- ══════════════════════ TAB 2 — CANDIDATES ════════════════════════ -->
    @if (activeTab() === 'candidates') {

      <!-- pays filter -->
      <div class="card filter-row">
        <div class="form-field">
          <label>Pays (ID)</label>
          <input class="input" type="number" [value]="candidatePaysId()"
                 (change)="candidatePaysId.set(+getVal($event))" placeholder="ex: 179" />
        </div>
        <button class="btn btn--primary" [disabled]="candLoading()" (click)="loadCandidates()">
          {{ candLoading() ? 'Chargement...' : 'Rechercher' }}
        </button>
        @if (selectedCandidate()) {
          <button class="btn btn--sm" (click)="selectedCandidate.set(null)">
            ← Retour à la liste
          </button>
        }
      </div>

      @if (candError()) {
        <div class="card alert alert--error">{{ candError() }}</div>
      }

      <!-- ── Level 1 : candidate list ──────────────────────────────────── -->
      @if (!selectedCandidate() && candidateList().length > 0) {
        <div class="card">
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Candidat</th>
                  <th>Poste</th>
                  <th>Entité</th>
                  <th>Simulations</th>
                  <th>Dernière</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (c of candidateList(); track c.candidateId) {
                  <tr class="cand-row" (click)="openCandidate(c)">
                    <td class="cand-name">{{ c.firstName }} {{ c.lastName }}</td>
                    <td>{{ c.appliedPosition || '—' }}</td>
                    <td>{{ c.candidateLocation || '—' }}</td>
                    <td class="center">
                      <span class="sim-count">{{ c.simulationCount }}</span>
                    </td>
                    <td>{{ c.latestSubmittedAt | date:'dd/MM/yyyy' }}</td>
                    <td>
                      <span class="badge" [ngClass]="statusClass(c.latestStatus)">
                        {{ statusLabel(c.latestStatus) }}
                      </span>
                    </td>
                    <td>
                      <button class="btn btn--sm" (click)="openCandidate(c); $event.stopPropagation()">
                        Détail →
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      @if (!selectedCandidate() && !candLoading() && candSearched() && candidateList().length === 0) {
        <div class="card empty-state">Aucun candidat avec simulation trouvé.</div>
      }

      <!-- ── Level 2 : simulation history for selected candidate ────────── -->
      @if (selectedCandidate()) {
        <div class="cand-header">
          <div class="cand-header__avatar">
            {{ initials(selectedCandidate()!) }}
          </div>
          <div>
            <h2 class="cand-header__name">
              {{ selectedCandidate()!.firstName }} {{ selectedCandidate()!.lastName }}
            </h2>
            <p class="cand-header__meta">
              {{ selectedCandidate()!.appliedPosition || 'Poste non renseigné' }}
              @if (selectedCandidate()!.candidateLocation) {
                · {{ selectedCandidate()!.candidateLocation }}
              }
            </p>
          </div>
        </div>

        @if (histLoading()) {
          <div class="card empty-state">Chargement de l'historique…</div>
        }

        @if (!histLoading() && history().length > 0) {
          <div class="timeline">
            @for (sim of history(); track sim.id; let idx = $index) {
              <div class="timeline__item">
                <div class="timeline__dot" [ngClass]="statusClass(sim.status)"></div>
                <div class="timeline__body card">

                  <div class="sim-head">
                    <div>
                      <span class="sim-ref">#{{ sim.id }} · {{ sim.contractTypeCode }} · {{ sim.fiscalYear }}</span>
                      <span class="badge" [ngClass]="statusClass(sim.status)" style="margin-left:.5rem">
                        {{ statusLabel(sim.status) }}
                      </span>
                    </div>
                    <span class="sim-date">{{ sim.submittedAt | date:'dd/MM/yyyy HH:mm' }}</span>
                  </div>

                  <div class="sim-grid">
                    <div class="sim-kpi">
                      <span class="sim-kpi__label">Net RH soumis</span>
                      <span class="sim-kpi__val">{{ sim.salaireNetRh | number:'1.0-0' }}</span>
                    </div>
                    @if (sim.salaireNetCandidat) {
                      <div class="sim-kpi">
                        <span class="sim-kpi__label">Net candidat</span>
                        <span class="sim-kpi__val">{{ sim.salaireNetCandidat | number:'1.0-0' }}</span>
                      </div>
                    }
                    @if (snap(sim).gross) {
                      <div class="sim-kpi">
                        <span class="sim-kpi__label">Brut estimé</span>
                        <span class="sim-kpi__val">{{ snap(sim).gross | number:'1.0-0' }}</span>
                      </div>
                    }
                    @if (snap(sim).loadedCost) {
                      <div class="sim-kpi">
                        <span class="sim-kpi__label">Coût chargé / mois</span>
                        <span class="sim-kpi__val">{{ snap(sim).loadedCost | number:'1.0-0' }}</span>
                      </div>
                    }
                    @if (snap(sim).loadedCost) {
                      <div class="sim-kpi sim-kpi--accent">
                        <span class="sim-kpi__label">Coût annuel</span>
                        <span class="sim-kpi__val">{{ snap(sim).loadedCost! * 12 | number:'1.0-0' }}</span>
                      </div>
                    }
                  </div>

                  @if (sim.status === 'REJECTED') {
                    <div class="sim-rejection">
                      @if (sim.contrePropSalaire) {
                        <span class="rejection-label">Contre-proposition DAF :</span>
                        <strong>{{ sim.contrePropSalaire | number:'1.0-0' }} {{ snap(sim).localCurrency ?? '' }}</strong>
                      }
                      @if (sim.approvalNotes) {
                        <p class="rejection-note">"{{ sim.approvalNotes }}"</p>
                      }
                    </div>
                  }

                  @if (sim.status === 'APPROVED' && sim.approvalNotes) {
                    <p class="approval-note">"{{ sim.approvalNotes }}"</p>
                  }

                </div>
              </div>
            }
          </div>
        }

        @if (!histLoading() && history().length === 0) {
          <div class="card empty-state">Aucune simulation enregistrée pour ce candidat.</div>
        }
      }
    }
  `,
  styles: [`
    /* ── shared ─────────────────────────────────────────────── */
    .page-header   { margin-bottom: 1.5rem; }
    .page-title    { font-size: 1.5rem; font-weight: 600; margin: 0 0 .25rem; }
    .page-subtitle { color: var(--color-text-muted, #6b7280); margin: 0; }
    .card          { background: var(--color-surface, #fff); border-radius: 8px; padding: 1.5rem;
                     border: 1px solid var(--color-border, #e5e7eb); margin-bottom: 1.5rem; }
    .filter-row    { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
    .form-field    { display: flex; flex-direction: column; gap: .375rem; }
    .form-field label { font-size: .875rem; font-weight: 500; }
    .input         { padding: .4rem .75rem; border: 1px solid var(--color-border, #e5e7eb);
                     border-radius: 6px; font-size: .875rem; width: 120px; }
    .btn           { padding: .5rem 1.25rem; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; }
    .btn--primary  { background: var(--color-primary, #3b82f6); color: #fff; }
    .btn--sm       { padding: .25rem .6rem; font-size: .8rem; background: var(--color-surface-alt, #f3f4f6); cursor: pointer; border: none; border-radius: 4px; }
    .btn:disabled  { opacity: .5; cursor: not-allowed; }
    .alert--error  { background: #fee2e2; color: #991b1b; padding: .75rem 1rem; border-radius: 6px; margin-top: 1rem; font-size: .875rem; }
    .table-wrapper { overflow-x: auto; }
    .data-table    { width: 100%; border-collapse: collapse; font-size: .875rem; }
    .data-table th { background: var(--color-surface-alt, #f9fafb); padding: .625rem .75rem;
                     text-align: left; font-weight: 500; border-bottom: 1px solid var(--color-border, #e5e7eb); }
    .data-table td { padding: .625rem .75rem; border-bottom: 1px solid var(--color-border, #e5e7eb); vertical-align: middle; }
    .badge         { font-size: .7rem; padding: .2rem .5rem; border-radius: 9999px; background: var(--color-surface-alt, #f3f4f6); }
    .badge--active { color: #065f46; background: #d1fae5; }
    .badge--error  { color: #991b1b; background: #fee2e2; }
    .badge--warn   { color: #92400e; background: #fef3c7; }
    .amount        { text-align: right; font-variant-numeric: tabular-nums; }
    .center        { text-align: center; }
    .detail-row    { background: var(--color-surface-alt, #fafafa); }
    .inner-table   { margin: .5rem 0; }
    .empty-state   { text-align: center; color: var(--color-text-muted, #6b7280); }
    code           { font-size: .8rem; background: var(--color-surface-alt, #f3f4f6); padding: .1rem .3rem; border-radius: 4px; }

    /* ── tabs ───────────────────────────────────────────────── */
    .tabs          { display: flex; gap: .5rem; margin-bottom: 1.5rem; border-bottom: 2px solid var(--color-border, #e5e7eb); }
    .tab-btn       { padding: .6rem 1.25rem; border: none; background: none; cursor: pointer;
                     font-size: .9rem; font-weight: 500; color: var(--color-text-muted, #6b7280);
                     border-bottom: 2px solid transparent; margin-bottom: -2px; }
    .tab-btn--active { color: var(--color-primary, #3b82f6); border-bottom-color: var(--color-primary, #3b82f6); }
    .tab-count     { display: inline-flex; align-items: center; justify-content: center;
                     background: var(--color-primary, #3b82f6); color: #fff;
                     border-radius: 9999px; font-size: .7rem; width: 1.25rem; height: 1.25rem;
                     margin-left: .4rem; }

    /* ── candidate list ─────────────────────────────────────── */
    .cand-row      { cursor: pointer; }
    .cand-row:hover td { background: var(--color-surface-alt, #f9fafb); }
    .cand-name     { font-weight: 500; }
    .sim-count     { display: inline-flex; align-items: center; justify-content: center;
                     background: var(--color-surface-alt, #e5e7eb); border-radius: 9999px;
                     width: 1.75rem; height: 1.75rem; font-weight: 600; font-size: .8rem; }

    /* ── candidate header ───────────────────────────────────── */
    .cand-header   { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
    .cand-header__avatar { width: 3rem; height: 3rem; border-radius: 50%;
                           background: var(--color-primary, #3b82f6); color: #fff;
                           display: flex; align-items: center; justify-content: center;
                           font-weight: 700; font-size: 1.1rem; flex-shrink: 0; }
    .cand-header__name { font-size: 1.25rem; font-weight: 600; margin: 0 0 .2rem; }
    .cand-header__meta { color: var(--color-text-muted, #6b7280); margin: 0; font-size: .875rem; }

    /* ── timeline ───────────────────────────────────────────── */
    .timeline      { position: relative; padding-left: 1.5rem; }
    .timeline::before { content: ''; position: absolute; left: .6rem; top: .75rem; bottom: 0;
                         width: 2px; background: var(--color-border, #e5e7eb); }
    .timeline__item { position: relative; margin-bottom: 1.25rem; }
    .timeline__dot  { position: absolute; left: -1.5rem; top: 1.1rem; width: .75rem; height: .75rem;
                      border-radius: 50%; border: 2px solid #fff; }
    .timeline__dot.badge--active { background: #10b981; }
    .timeline__dot.badge--error  { background: #ef4444; }
    .timeline__dot.badge--warn   { background: #f59e0b; }
    .timeline__body { margin-left: .25rem; }

    /* ── simulation card internals ──────────────────────────── */
    .sim-head      { display: flex; justify-content: space-between; align-items: center;
                     margin-bottom: 1rem; flex-wrap: wrap; gap: .5rem; }
    .sim-ref       { font-weight: 600; font-size: .875rem; }
    .sim-date      { font-size: .8rem; color: var(--color-text-muted, #6b7280); }
    .sim-grid      { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: .75rem; }
    .sim-kpi       { background: var(--color-surface-alt, #f9fafb); border-radius: 6px;
                     padding: .625rem .75rem; }
    .sim-kpi--accent { background: #eff6ff; }
    .sim-kpi__label { display: block; font-size: .75rem; color: var(--color-text-muted, #6b7280); margin-bottom: .2rem; }
    .sim-kpi__val   { font-size: 1rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .sim-rejection  { margin-top: .875rem; padding: .625rem .75rem;
                      background: #fef2f2; border-left: 3px solid #ef4444; border-radius: 0 6px 6px 0;
                      font-size: .875rem; display: flex; flex-wrap: wrap; gap: .5rem; align-items: baseline; }
    .rejection-label { color: #991b1b; font-weight: 500; }
    .rejection-note  { margin: .375rem 0 0; color: #7f1d1d; font-style: italic; width: 100%; }
    .approval-note   { margin-top: .75rem; font-style: italic; color: var(--color-text-muted, #6b7280);
                       font-size: .875rem; }
  `],
})
export class EngineResultsComponent {
  private readonly engineApi  = inject(PayrollEngineService);
  private readonly candSvc    = inject(CandidateSimulationService);
  private readonly fb         = inject(FormBuilder);

  // ── tab ───────────────────────────────────────────────────────────────
  readonly activeTab = signal<Tab>('employees');

  switchTab(tab: Tab): void { this.activeTab.set(tab); }

  // ── employee tab ───────────────────────────────────────────────────────
  readonly form = this.fb.group({ employeeId: [null as number | null, Validators.required] });
  readonly empLoading  = signal(false);
  readonly empError    = signal<string | null>(null);
  readonly empSearched = signal(false);
  readonly results     = signal<RunPayrollResponse[]>([]);
  readonly expandedResult = signal<number | null>(null);

  loadEmployeeResults(): void {
    if (this.form.invalid) return;
    this.empLoading.set(true);
    this.empError.set(null);
    this.empSearched.set(false);
    this.engineApi.getResults(this.form.getRawValue().employeeId!).subscribe({
      next: r  => { this.results.set(r); this.empLoading.set(false); this.empSearched.set(true); },
      error: e => { this.empError.set(e?.error?.message ?? 'Erreur'); this.empLoading.set(false); },
    });
  }

  toggleDetail(id: number): void {
    this.expandedResult.set(this.expandedResult() === id ? null : id);
  }

  // ── candidates tab ─────────────────────────────────────────────────────
  readonly candidatePaysId   = signal<number>(179);
  readonly candLoading       = signal(false);
  readonly candError         = signal<string | null>(null);
  readonly candSearched      = signal(false);
  readonly candidateList     = signal<CandidateSimulationSummaryDto[]>([]);
  readonly selectedCandidate = signal<CandidateSimulationSummaryDto | null>(null);
  readonly histLoading       = signal(false);
  readonly history           = signal<CandidateCostApprovalDto[]>([]);

  loadCandidates(): void {
    this.candLoading.set(true);
    this.candError.set(null);
    this.candSearched.set(false);
    this.selectedCandidate.set(null);
    this.candSvc.getCandidatesWithHistory(this.candidatePaysId()).subscribe({
      next: list => { this.candidateList.set(list); this.candLoading.set(false); this.candSearched.set(true); },
      error: e   => {
        this.candError.set(e?.error?.message ?? 'Impossible de charger les candidats.');
        this.candLoading.set(false);
      },
    });
  }

  openCandidate(c: CandidateSimulationSummaryDto): void {
    this.selectedCandidate.set(c);
    this.history.set([]);
    this.histLoading.set(true);
    this.candSvc.getCandidateHistory(c.candidateId).subscribe({
      next: h  => { this.history.set(h); this.histLoading.set(false); },
      error: () => this.histLoading.set(false),
    });
  }

  snap(sim: CandidateCostApprovalDto) {
    return this.candSvc.parseSnapshot(sim.simulationSnapshot);
  }

  statusLabel(s: string): string { return STATUS_LABEL[s] ?? s; }
  statusClass(s: string): string { return STATUS_CLASS[s] ?? ''; }
  initials(c: CandidateSimulationSummaryDto): string {
    return ((c.firstName?.[0] ?? '') + (c.lastName?.[0] ?? '')).toUpperCase() || '?';
  }

  getVal(e: Event): string { return (e.target as HTMLInputElement).value; }
}
