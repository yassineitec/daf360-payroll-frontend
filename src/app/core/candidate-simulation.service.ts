import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CandidateSimulationSummaryDto {
  candidateId: number;
  firstName: string;
  lastName: string;
  appliedPosition?: string;
  candidateLocation?: string;
  paysId: number;
  simulationCount: number;
  latestSubmittedAt: string;
  latestStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** Net évalué par la RH, tel qu'il figure sur la fiche candidat. */
  salaireNetRh?: number | null;
  /** Net demandé par le candidat. */
  salaireNetCandidat?: number | null;
}

export interface CandidateCostApprovalDto {
  id: number;
  candidateId: number;
  /** Round d'offre que cette décision conditionne ; null = pré-validation budgétaire. */
  jobOfferId?: number | null;
  /** Salaire proposé sur ce round — null sur une pré-validation. */
  proposedSalary?: number | null;
  candidateFirstName?: string;
  candidateLastName?: string;
  appliedPosition?: string;
  candidateLocation?: string;
  paysId: number;
  fiscalYear: number;
  salaireNetRh: number;
  salaireNetCandidat?: number;
  contrePropSalaire?: number;
  contractTypeCode: string;
  contractTypeLabel?: string | null;
  simulationSnapshot: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedBy: number;
  submittedAt: string;
  approvedBy?: number;
  approvedAt?: string;
  approvalNotes?: string;
}

/** Le `PayrollSimulationResult` complet que RH a sérialisé à la soumission. */
export interface SimSnapshot {
  /** Id de la simulation payroll d'origine — ouvrable sur `/payroll/simulator/:id`. */
  id?: number;
  parameterSetId?: number;
  inputNet?: number;
  netTaxable?: number;
  gross?: number;
  loadedCost?: number;
  loadedCostEur?: number;
  loadedCostUsd?: number;
  employeeCharges?: number;
  employerCharges?: number;
  irppAmount?: number;
  localCurrency?: string;
  /** JSON : `[{ code, … }]`. */
  benefitsApplied?: string;
  /** JSON : `RubriqueAppliedItem[]`. */
  rubriquesApplied?: string;
  iterationsUsed?: number;
  convergenceOk?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CandidateSimulationService {
  private readonly http   = inject(HttpClient);
  private readonly base   = `${environment.hrApiUrl}/api/hr/cost-approvals`;

  getCandidatesWithHistory(paysId: number): Observable<CandidateSimulationSummaryDto[]> {
    return this.http.get<CandidateSimulationSummaryDto[]>(
      `${this.base}/candidates-with-history`,
      { params: { paysId: paysId.toString() } }
    );
  }

  getCandidateHistory(candidateId: number): Observable<CandidateCostApprovalDto[]> {
    return this.http.get<CandidateCostApprovalDto[]>(
      `${this.base}/candidate/${candidateId}`
    );
  }

  parseSnapshot(json: string): SimSnapshot {
    try { return JSON.parse(json); } catch { return {}; }
  }
}
