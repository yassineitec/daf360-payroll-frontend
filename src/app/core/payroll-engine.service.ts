import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// DTOs
export interface EngineParamSetDto {
  id: number;
  countryId: number;
  versionNumber: number;
  status: string; // DRAFT|SUBMITTED|APPROVED_HR|APPROVED_FINANCE|ACTIVE|ARCHIVED
  effectiveDate: string;
  parameters: string; // JSON
  submittedBy: string | null;
  submittedAt: string | null;
  approvedByHr: string | null;
  approvedAtHr: string | null;
  approvedByFinance: string | null;
  approvedAtFinance: string | null;
  activatedAt: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface EngineRubriqueDefDto {
  id: number;
  countryId: number;
  code: string;
  labelFr: string;
  labelEn: string | null;
  strate: number;
  nature: string;
  modeCalcul: string;
  assietteCode: string | null;
  paramKeyTaux: string | null;
  paramKeyPlafond: string | null;
  paramKeyBareme: string | null;
  formulaExpression: string | null;
  contractTypeFilter: string | null;
  periodicite: string;
  prorataApplicable: boolean;
  displayOrder: number;
  active: boolean;
}

export interface RunPayrollRequest {
  employeeId: number;
  paysId: number;
  periodYear: number;
  periodMonth: number;
  contractTypeCode: string;
  joursOuvresMois: number;
  triggeredBy?: string | null;
}

export interface RubriqueResultItem {
  rubriqueCode: string;
  labelFr: string;
  nature: string;
  strate: number;
  assiette: number | null;
  amount: number;
  modeCalcul: string;
  prorataApplied: boolean;
}

export interface RunPayrollResponse {
  resultId: number;
  employeeId: number;
  periodYear: number;
  periodMonth: number;
  parameterSetId: number;
  strate1: number | null;
  strate2: number | null;
  strate3: number | null;
  strate4: number | null;
  strate5: number | null;
  aggregateGross: number | null;
  aggregateEmployerCharges: number | null;
  aggregateNet: number | null;
  aggregateIrpp: number | null;
  loadedCost: number | null;
  convergenceOk: boolean;
  iterationsUsed: number | null;
  calculatedAt: string;
  rubriqueDetails: RubriqueResultItem[];
}

export interface EngineCalibrationDto {
  id: number;
  paysId: number;
  period: string;
  parameterSetId: number | null;
  status: string;
  createdAt: string;
}

export interface EngineCalibrationLineDto {
  id: number;
  calibrationImportId: number;
  rubriqueCode: string;
  predictedAmount: number | null;
  actualAmount: number | null;
  variancePct: number | null;
  status: string;
}

export interface KpiHistoryDto {
  id: number;
  paysId: number;
  period: string;
  meanAbsoluteErrorPct: number | null;
  maxErrorPct: number | null;
  belowThreshold: boolean;
  computedAt: string;
}

@Injectable({ providedIn: 'root' })
export class PayrollEngineService {
  private readonly base = environment.payrollApiUrl + '/api/payroll/engine';

  constructor(private http: HttpClient) {}

  // ── Parameter sets ────────────────────────────────────────────────────────
  listParamSets(paysId: number): Observable<EngineParamSetDto[]> {
    return this.http.get<EngineParamSetDto[]>(`${this.base}/param-sets`,
      { params: new HttpParams().set('paysId', paysId) });
  }

  submitParamSet(id: number, submittedBy?: string): Observable<EngineParamSetDto> {
    let params = new HttpParams();
    if (submittedBy) params = params.set('submittedBy', submittedBy);
    return this.http.post<EngineParamSetDto>(`${this.base}/param-sets/${id}/submit`, null, { params });
  }

  approveHrParamSet(id: number, approvedBy?: string): Observable<EngineParamSetDto> {
    let params = new HttpParams();
    if (approvedBy) params = params.set('approvedBy', approvedBy);
    return this.http.post<EngineParamSetDto>(`${this.base}/param-sets/${id}/approve-hr`, null, { params });
  }

  approveFinanceParamSet(id: number, approvedBy?: string): Observable<EngineParamSetDto> {
    let params = new HttpParams();
    if (approvedBy) params = params.set('approvedBy', approvedBy);
    return this.http.post<EngineParamSetDto>(`${this.base}/param-sets/${id}/approve-finance`, null, { params });
  }

  activateParamSet(id: number, activatedBy?: string): Observable<EngineParamSetDto> {
    let params = new HttpParams();
    if (activatedBy) params = params.set('activatedBy', activatedBy);
    return this.http.post<EngineParamSetDto>(`${this.base}/param-sets/${id}/activate`, null, { params });
  }

  // ── Rubrique definitions ──────────────────────────────────────────────────
  listRubriques(paysId: number): Observable<EngineRubriqueDefDto[]> {
    return this.http.get<EngineRubriqueDefDto[]>(`${this.base}/rubriques`,
      { params: new HttpParams().set('paysId', paysId) });
  }

  // ── Engine run ────────────────────────────────────────────────────────────
  runPayroll(req: RunPayrollRequest): Observable<RunPayrollResponse> {
    return this.http.post<RunPayrollResponse>(`${this.base}/run`, req);
  }

  getResults(employeeId: number): Observable<RunPayrollResponse[]> {
    return this.http.get<RunPayrollResponse[]>(`${this.base}/results/${employeeId}`);
  }

  // ── Calibration ───────────────────────────────────────────────────────────
  openEngineCalibration(paysId: number, period: string, paramSetId?: number): Observable<EngineCalibrationDto> {
    let params = new HttpParams().set('paysId', paysId).set('period', period);
    if (paramSetId != null) params = params.set('paramSetId', paramSetId);
    return this.http.post<EngineCalibrationDto>(`${this.base}/calibration/open`, null, { params });
  }

  listEngineCalibrations(paysId: number): Observable<EngineCalibrationDto[]> {
    return this.http.get<EngineCalibrationDto[]>(`${this.base}/calibration`,
      { params: new HttpParams().set('paysId', paysId) });
  }

  getCalibrationLines(importId: number): Observable<EngineCalibrationLineDto[]> {
    return this.http.get<EngineCalibrationLineDto[]>(`${this.base}/calibration/${importId}/lines`);
  }

  getKpiHistory(paysId: number): Observable<KpiHistoryDto[]> {
    return this.http.get<KpiHistoryDto[]>(`${this.base}/calibration/kpi`,
      { params: new HttpParams().set('paysId', paysId) });
  }
}
