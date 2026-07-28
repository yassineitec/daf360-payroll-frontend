import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ParameterSetDto {
  id: number;
  paysId: number;
  version: number;
  fiscalYear: number;
  status: string;
  irppBrackets: string;
  convergenceTolerance: number;
  maxConvergenceIterations: number;
  calibrationThresholdPct: number;
  approvedByHr: number | null;
  approvedByFinance: number | null;
  approvedAt: string | null;
  activatedAt: string | null;
  changeRationale: string | null;
  createdAt: string;
  socialChargeRates: SocialChargeRateDto[];
  benefits: BenefitCatalogueDto[];
  rubriques: PayrollRubriqueDto[];
}

export interface PayrollRubriqueDto {
  id?: number;
  code: string;
  labelFr: string;
  labelEn: string | null;
  nature: string;            // AVANTAGE | INDEMNITE | PRIME | RETENUE
  calcMode: string;          // FIXE_MENSUEL | FIXE_JOURNALIER | POURCENTAGE_BRUT | POURCENTAGE_CHARGES
  amount: number | null;
  rate: number | null;       // decimal, e.g. 0.05 = 5%
  employerSharePct: number;  // decimal, e.g. 0.60 = 60%
  employeeSharePct: number;
  isSubjectToSocialCharges: boolean;
  isSubjectToIrpp: boolean;
  direction: string;         // CREDIT | DEBIT
  contractTypes: string | null;  // null = all; "CDI,CDD" = specific
  isActive: boolean;
  createdAt?: string;
}

export interface SavePayrollRubriqueRequest {
  code: string;
  labelFr: string;
  labelEn?: string | null;
  nature: string;
  calcMode: string;
  amount?: number | null;
  rate?: number | null;
  employerSharePct?: number;
  employeeSharePct?: number;
  isSubjectToSocialCharges?: boolean;
  isSubjectToIrpp?: boolean;
  direction?: string;
  contractTypes?: string | null;
  isActive?: boolean;
}

export interface SocialChargeRateDto {
  id?: number;
  contractType: string;
  chargeCode: string;
  chargeLabel: string;
  employeeRate: number;
  employerRate: number;
  baseCalculation: string;
  capAmount: number | null;
}

export interface BenefitCatalogueDto {
  id?: number;
  benefitCode: string;
  benefitLabelFr: string;
  benefitLabelEn: string | null;
  valuationMethod: string;
  monthlyValue: number;
  employeeShare: number;
  employerShare: number;
  isTaxable: boolean;
}

export interface SimulationRequest {
  paysId: number;
  inputNet: number;
  profileUserId?: number | null;
  contractType?: string;
  joursTravailes?: number;   // working days for FIXE_JOURNALIER rubriques (default 22)
}

export interface SimulationResultDto {
  id: number;
  paysId: number;
  profileUserId: number | null;
  parameterSetId: number;
  simulationType: string;
  contractType: string;
  inputNet: number;
  netTaxable: number;
  taxableBase: number;
  gross: number;
  loadedCost: number;
  loadedCostEur: number | null;
  loadedCostUsd: number | null;
  fxRateEur: number | null;
  fxRateUsd: number | null;
  localCurrency: string | null;
  irppAmount: number;
  employeeCharges: number;
  employerCharges: number;
  benefitsApplied: string;
  iterationsUsed: number;
  convergenceOk: boolean;
  cohortId: number | null;
  simulatedAt: string;
}

export interface CohortSimulationRequest {
  paysId: number;
  fiscalYear: number;
  cohortName?: string;
  employees: Array<{
    profileUserId?: number;
    inputNet: number;
    contractType?: string;
  }>;
}

export interface PaysDto {
  id: number;
  isoCode: string;
  frenchLabel: string;
  devise: string;
}

export interface CalibrationCycleDto {
  id: number;
  paysId: number;
  period: string;
  parameterSetId: number;
  status: string;
  predictedTotalLoadedCost: number | null;
  actualTotalLoadedCost: number | null;
  variancePct: number | null;
  headcount: number | null;
  closedAt: string | null;
  notes: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class PayrollApiService {
  private readonly base = environment.payrollApiUrl + '/api/payroll';

  constructor(private http: HttpClient) {}

  // ── Reference data ───────────────────────────────────────────────────────

  listPays(): Observable<PaysDto[]> {
    return this.http.get<PaysDto[]>(`${this.base}/ref/pays`);
  }

  // ── Parameter Sets ────────────────────────────────────────────────────────

  listParameterSets(paysId: number): Observable<ParameterSetDto[]> {
    const params = new HttpParams().set('paysId', paysId);
    return this.http.get<ParameterSetDto[]>(`${this.base}/parameter-sets`, { params });
  }

  getActiveParameterSet(paysId: number): Observable<ParameterSetDto> {
    const params = new HttpParams().set('paysId', paysId);
    return this.http.get<ParameterSetDto>(`${this.base}/parameter-sets/active`, { params });
  }

  createParameterSet(req: Partial<ParameterSetDto>): Observable<ParameterSetDto> {
    return this.http.post<ParameterSetDto>(`${this.base}/parameter-sets`, req);
  }

  submitParameterSet(id: number): Observable<ParameterSetDto> {
    return this.http.post<ParameterSetDto>(`${this.base}/parameter-sets/${id}/submit`, {});
  }

  approveHr(id: number): Observable<ParameterSetDto> {
    return this.http.post<ParameterSetDto>(`${this.base}/parameter-sets/${id}/approve/hr`, {});
  }

  approveFinance(id: number): Observable<ParameterSetDto> {
    return this.http.post<ParameterSetDto>(`${this.base}/parameter-sets/${id}/approve/finance`, {});
  }

  updateSocialChargeRates(id: number, rates: SocialChargeRateDto[]): Observable<ParameterSetDto> {
    return this.http.put<ParameterSetDto>(`${this.base}/parameter-sets/${id}/social-charge-rates`, rates);
  }

  updateRubriques(id: number, rubriques: SavePayrollRubriqueRequest[]): Observable<ParameterSetDto> {
    return this.http.put<ParameterSetDto>(`${this.base}/parameter-sets/${id}/rubriques`, rubriques);
  }

  // ── Simulations ───────────────────────────────────────────────────────────

  runIndividualSimulation(req: SimulationRequest): Observable<SimulationResultDto> {
    return this.http.post<SimulationResultDto>(`${this.base}/simulations/individual`, req);
  }

  getSimulationHistory(paysId: number): Observable<SimulationResultDto[]> {
    const params = new HttpParams().set('paysId', paysId);
    return this.http.get<SimulationResultDto[]>(`${this.base}/simulations/individual/history`, { params });
  }

  runCohortSimulation(req: CohortSimulationRequest): Observable<SimulationResultDto[]> {
    return this.http.post<SimulationResultDto[]>(`${this.base}/simulations/cohort`, req);
  }

  getCohortResults(cohortId: number): Observable<SimulationResultDto[]> {
    return this.http.get<SimulationResultDto[]>(`${this.base}/simulations/cohort/${cohortId}`);
  }

  // ── Calibration ───────────────────────────────────────────────────────────

  listCalibrationCycles(paysId: number): Observable<CalibrationCycleDto[]> {
    const params = new HttpParams().set('paysId', paysId);
    return this.http.get<CalibrationCycleDto[]>(`${this.base}/calibration`, { params });
  }

  openCalibrationCycle(paysId: number, period: string): Observable<CalibrationCycleDto> {
    const params = new HttpParams().set('paysId', paysId).set('period', period);
    return this.http.post<CalibrationCycleDto>(`${this.base}/calibration/open`, null, { params });
  }

  uploadActuals(cycleId: number, file: File): Observable<CalibrationCycleDto> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<CalibrationCycleDto>(`${this.base}/calibration/${cycleId}/upload-actuals`, formData);
  }
}
