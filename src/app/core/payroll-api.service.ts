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
  calcMode: string;          // FIXE_MENSUEL | FIXE_JOURNALIER | POURCENTAGE_BRUT | POURCENTAGE_CHARGES | POURCENTAGE_PLAFONNE | FORMULE
  amount: number | null;
  rate: number | null;       // decimal, e.g. 0.05 = 5%
  capAmount: number | null;  // used by POURCENTAGE_PLAFONNE: min(gross, capAmount) × rate
  employerSharePct: number;  // decimal, e.g. 0.60 = 60%
  employeeSharePct: number;
  isSubjectToSocialCharges: boolean;
  isSubjectToIrpp: boolean;
  direction: string;         // CREDIT | DEBIT
  contractTypes: string | null;  // null = all; "CDI,CDD" = specific
  isActive: boolean;
  formulaExpression?: string | null;  // arithmetic expression for FORMULE mode, e.g. "BRUT * 0.02 + CNSS_EE * 0.5"
  displayOrder?: number;              // evaluation order; lower = computed first
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
  capAmount?: number | null;
  employerSharePct?: number;
  employeeSharePct?: number;
  isSubjectToSocialCharges?: boolean;
  isSubjectToIrpp?: boolean;
  direction?: string;
  contractTypes?: string | null;
  isActive?: boolean;
  formulaExpression?: string | null;
  displayOrder?: number;
}

export interface SocialChargeRateDto {
  id?: number;
  contractType: string;
  chargeCode: string;
  chargeLabel: string;
  employeeRate: number;
  employerRate: number;
  /** GROSS | CAPPED_GROSS | FIXED | FORMULE */
  baseCalculation: string;
  capAmount: number | null;
  /** Formula override for the employee-side amount; null = use employeeRate × base. */
  formulaEe?: string | null;
  /** Formula override for the employer-side amount; null = use employerRate × base. */
  formulaEr?: string | null;
  /** Evaluation order within the parameter set; lower = evaluated first. */
  evalOrder?: number;
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

export type SimulationMode = 'NET_TO_BRUT' | 'BRUT_TO_NET';

export interface SimulationRequest {
  paysId: number;
  /** NET_TO_BRUT: required. BRUT_TO_NET: ignored. */
  inputNet?: number;
  /** BRUT_TO_NET: required. NET_TO_BRUT: ignored. */
  inputGross?: number;
  /** Defaults to NET_TO_BRUT when omitted (backward-compatible). */
  mode?: SimulationMode;
  profileUserId?: number | null;
  contractType?: string;
  joursTravailes?: number;            // working days for FIXE_JOURNALIER rubriques (default 22)
  selectedBenefitCodes?: string[];    // null = apply all; empty = none
  candidateLabel?: string;            // free-text for PDF
  poste?: string;
  grade?: string;
  discipline?: string;
}

/** One evaluated rubrique line returned inside {@link SimulationResultDto.rubriquesApplied}. */
export interface RubriqueAppliedItem {
  code:      string;
  nature:    string | null;
  calcMode:  string;
  direction: 'CREDIT' | 'DEBIT';
  amount:    number;
}

/** Parse the JSON blob stored in {@link SimulationResultDto.rubriquesApplied}. */
export function parseRubriquesApplied(json: string | null | undefined): RubriqueAppliedItem[] {
  if (!json) return [];
  try { return JSON.parse(json) as RubriqueAppliedItem[]; } catch { return []; }
}

/**
 * 5-strata mapping:
 *   S1 = inputNet            (net versé)
 *   S2 = netTaxable          (net imposable = IRPP base)
 *   S3 = gross               (brut base taxable)
 *   S4 = grossWithBenefits   (brut total = S3 + avantages exonérés)
 *   S5 = loadedCost          (coût chargé total)
 */
export interface SimulationResultDto {
  id: number;
  paysId: number;
  profileUserId: number | null;
  parameterSetId: number;
  simulationType: string;
  contractType: string;
  // 5 strates
  inputNet: number;            // S1
  netTaxable: number;          // S2
  taxableBase: number;         // S2 alias
  gross: number;               // S3
  grossWithBenefits: number | null;  // S4
  loadedCost: number;          // S5
  // multi-currency (S5 in EUR / USD / CHF)
  loadedCostEur: number | null;
  loadedCostUsd: number | null;
  loadedCostChf: number | null;
  fxRateEur: number | null;
  fxRateUsd: number | null;
  fxRateChf: number | null;
  localCurrency: string | null;
  costNetRatio: number | null; // S5 / S1
  // detail
  irppAmount: number;
  employeeCharges: number;
  employerCharges: number;
  benefitsApplied: string;
  rubriquesApplied: string;
  iterationsUsed: number;
  convergenceOk: boolean;
  cohortId: number | null;
  // candidate metadata
  candidateLabel: string | null;
  poste: string | null;
  grade: string | null;
  discipline: string | null;
  /** NET_TO_BRUT | BRUT_TO_NET — null for legacy rows without a mode column. */
  mode: SimulationMode | null;
  simulatedAt: string;
}

export interface CohortSimulationRequest {
  paysId: number;
  fiscalYear: number;
  cohortName?: string;
  /** Global direction toggle — all entries use the same mode. Defaults to NET_TO_BRUT. */
  mode?: SimulationMode;
  employees: Array<{
    profileUserId?: number;
    /** NET_TO_BRUT: required. */
    inputNet?: number;
    contractType?: string;
    /** BRUT_TO_NET: required. */
    inputGross?: number;
  }>;
}

export interface CohortFilterRequest {
  paysId: number;
  grade?: string | null;
  discipline?: string | null;
  contractType?: string | null;
  entite?: string | null;
  /** "PCT" or "ABSOLU" */
  modifierType?: string;
  modifierValue?: number;
}

export interface CohortAggregateResponse {
  headcount: number;
  currentMonthlyCost: number;
  projectedMonthlyCost: number;
  deltaMonthly: number;
  deltaAnnual: number;
  currentMonthlyCostEur: number | null;
  projectedMonthlyCostEur: number | null;
  currentMonthlyCostChf: number | null;
  projectedMonthlyCostChf: number | null;
  localCurrency: string | null;
  modifierType: string;
  modifierValue: number;
  appliedFilters: CohortFilterRequest;
}

export interface PayrollBudgetLineDto {
  id: number;
  parameterSetId: number;
  paysId: number;
  period: string;
  lineType: 'EMPLOYEE_NET' | 'EMPLOYER_LOADED';
  monthlyAmount: number;
  monthlyEur: number | null;
  monthlyChf: number | null;
  headcount: number | null;
  localCurrency: string | null;
  createdAt: string;
}

export interface PayrollForecastOutputDto {
  id: number;
  parameterSetId: number;
  paysId: number;
  period: string;
  forecastType: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  forecastAmount: number;
  forecastEur: number | null;
  forecastChf: number | null;
  localCurrency: string | null;
  headcount: number | null;
  createdAt: string;
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

  downloadSimulationPdf(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/simulations/${id}/export-pdf`, { responseType: 'blob' });
  }

  runCohortSimulation(req: CohortSimulationRequest): Observable<SimulationResultDto[]> {
    return this.http.post<SimulationResultDto[]>(`${this.base}/simulations/cohort`, req);
  }

  runCohortAggregate(req: CohortFilterRequest): Observable<CohortAggregateResponse> {
    return this.http.post<CohortAggregateResponse>(`${this.base}/simulations/cohort/aggregate`, req);
  }

  getCohortResults(cohortId: number): Observable<SimulationResultDto[]> {
    return this.http.get<SimulationResultDto[]>(`${this.base}/simulations/cohort/${cohortId}`);
  }

  // ── Calibration ───────────────────────────────────────────────────────────

  getBudgetLines(paysId: number): Observable<PayrollBudgetLineDto[]> {
    const params = new HttpParams().set('paysId', paysId);
    return this.http.get<PayrollBudgetLineDto[]>(`${this.base}/calibration/budget-lines`, { params });
  }

  getForecastOutputs(paysId: number): Observable<PayrollForecastOutputDto[]> {
    const params = new HttpParams().set('paysId', paysId);
    return this.http.get<PayrollForecastOutputDto[]>(`${this.base}/calibration/forecast-outputs`, { params });
  }

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
