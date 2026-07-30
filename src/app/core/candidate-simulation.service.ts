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
}

export interface CandidateCostApprovalDto {
  id: number;
  candidateId: number;
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
  simulationSnapshot: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedBy: number;
  submittedAt: string;
  approvedBy?: number;
  approvedAt?: string;
  approvalNotes?: string;
}

export interface SimSnapshot {
  inputNet?: number;
  gross?: number;
  loadedCost?: number;
  employeeCharges?: number;
  employerCharges?: number;
  irppAmount?: number;
  localCurrency?: string;
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
