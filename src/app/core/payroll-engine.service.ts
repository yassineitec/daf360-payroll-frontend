import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
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

/** Corps de création / modification d'une rubrique du moteur (`code` ignoré à la modification). */
export type SaveEngineRubriqueRequest = Omit<EngineRubriqueDefDto, 'id' | 'countryId'>;

/** Modes de calcul connus du moteur (un calculateur chacun côté serveur). */
export const ENGINE_CALC_MODES = [
  'TAUX_PCT', 'MONTANT_FIXE', 'BAREME_PROGRESSIF', 'ANNUALISE_BAREME', 'FORMULE', 'NEWTON_RAPHSON',
] as const;

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
  /** Absent des résultats calculés avant son ajout. */
  labelEn?: string | null;
  nature: string;
  strate: number;
  assiette: number | null;
  amount: number;
  modeCalcul: string;
  prorataApplied: boolean;
}

/** `rubriqueDetails` arrive en texte JSON depuis `GET /results/{employeeId}`. */
function parseRubriqueDetails(raw: unknown): RubriqueResultItem[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** `GET /engine/results/summary` — période/dates à `null` tant que le pays n'a aucun résultat. */
/**
 * Périmètre des KPI de `/payroll/engine-results` : `from`/`to` en `YYYY-MM-DD` (au mois près,
 * bornes incluses — sans eux, le dernier mois calculé) ; `employeeIds` restreint aux
 * collaborateurs choisis.
 */
export interface ResultsScope {
  from?: string | null;
  to?: string | null;
  employeeIds?: number[] | null;
}

function scopeParams(scope: ResultsScope): HttpParams {
  let params = new HttpParams();
  if (scope.from) params = params.set('from', scope.from);
  if (scope.to) params = params.set('to', scope.to);
  if (scope.employeeIds?.length) params = params.set('employeeIds', scope.employeeIds.join(','));
  return params;
}

export interface PayrollResultsSummaryDto {
  paysId: number;
  currencyCode: string | null;
  periodYear: number | null;
  periodMonth: number | null;
  employeeCount: number;
  totalGross: number;
  totalNet: number;
  totalLoadedCost: number;
  convergenceFailures: number;
  lastCalculatedAt: string | null;
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
  /** Pays du calcul — présent dans `GET /results/{employeeId}` (entité brute), absent de la
   *  réponse de `POST /run`. Sert à la devise de l'historique. */
  paysId?: number | null;
  /** Éléments variables du mois tels que le calcul les a utilisés (V41) ; null avant V41
   *  et pour « Calculer le net » de la configuration. */
  variableInputs?: PayrollVariableInputs | null;
}

/**
 * Éléments variables d'un mois de paie (backend `PayrollVariableInputs`) : heures sup. de
 * week-end lues dans la timesheet (approuvées, plafonnées par jour), absences (déduites ou
 * payées selon le type), entrée/sortie en cours de mois, autorisations hors quota, primes,
 * échéances d'avance, taux horaire/journalier, avertissements. Montants en devise de travail.
 */
export interface PayrollVariableInputs {
  periodYear: number;
  periodMonth: number;
  currency: string | null;
  /** Pay period of the country (V42, e.g. 21/10 → 20/11). Absent on snapshots saved before V42. */
  periodFrom?: string | null;
  periodTo?: string | null;
  workPaysId: number | null;
  weekendDays: string[];
  workingDaysInMonth: number;
  hireDate: string | null;
  exitDate: string | null;
  workingDaysEmployed: number;
  nonEmployedDays: number;
  monthlyGross: number;
  regimeCode: string | null;
  hoursPerWeek: number;
  monthlyHours: number;
  hourlyRate: number;
  dailyRate: number;
  overtime: {
    /** Since V43: hours-weighted average of the days' own majorations. */
    majorationPct: number | null;
    dailyCapHours: number;
    /** EMPLOYEE / ROLE / COUNTRY / DEFAULT — absent before V43. */
    capSource?: string | null;
    days: { date: string; dayOfWeek: string; workedHours: number; paidHours: number; capped: boolean;
            /** The day's own majoration and amount — absent before V43. */
            majorationPct?: number | null; amount?: number | null }[];
    paidHours: number;
    cappedOutHours: number;
    amount: number;
  };
  absences: {
    items: { typeCode: string; label: string; category: string; from: string; to: string;
             days: number; deductsSalary: boolean }[];
    unpaidDays: number;
    paidDays: number;
    amount: number;
  };
  autorisations: {
    approvedMinutes: number;
    monthlyQuotaMinutes: number | null;
    deductedMinutes: number;
    deductedHours: number;
    amount: number;
  };
  bonuses: { id: number; label: string; amount: number; currency: string | null; amountConverted: number }[];
  bonusesTotal: number;
  advances: { advanceId: number; seq: number; amount: number; currency: string | null;
              amountConverted: number; status: string }[];
  advancesTotal: number;
  /** Congé / maladie balances at the start and end of the period (information). Absent before V42. */
  balances?: { field: string; atPeriodStart: number | null; atPeriodEnd: number | null;
               takenInPeriod: number | null }[];
  hrRead: boolean;
  timesheetRead: boolean;
  warnings: string[];
}

/** `variable_inputs_json` arrive en texte depuis `GET /results/{employeeId}`. */
function parseVariableInputs(raw: unknown): PayrollVariableInputs | null {
  if (raw && typeof raw === 'object') return raw as PayrollVariableInputs;
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw) as PayrollVariableInputs;
  } catch {
    return null;
  }
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

/** Ligne de l'export Excel de la liste des collaborateurs (`exportEmployeesXlsx`). */
export interface EmployeeExportRow {
  /** userId RH = `employeeId` des résultats de paie : le serveur y ajoute les cumuls de paie. */
  userId: number;
  fullName: string;
  employeeId: string | null;
  department: string | null;
  contract: string | null;
  pays: string | null;
  status: string | null;
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

  // ── Administration (écritures) — `/admin/engine` ──────────────────────────
  private readonly adminBase = environment.payrollApiUrl + '/api/payroll/admin/engine';

  /** Nouvelle version en brouillon (copie de l'active) — 409 si un brouillon existe déjà. */
  createParamSetDraft(paysId: number): Observable<EngineParamSetDto> {
    return this.http.post<EngineParamSetDto>(`${this.adminBase}/param-sets`, null,
      { params: new HttpParams().set('paysId', paysId) });
  }

  /** Paramètres (JSON objet) et date d'effet d'une version en brouillon. */
  updateParamSetDraft(id: number, parameters: string, effectiveDate?: string | null): Observable<EngineParamSetDto> {
    return this.http.put<EngineParamSetDto>(`${this.adminBase}/param-sets/${id}`, { parameters, effectiveDate: effectiveDate ?? null });
  }

  /** Toutes les rubriques du pays, actives ET inactives (l'administration réactive). */
  listAllRubriques(paysId: number): Observable<EngineRubriqueDefDto[]> {
    return this.http.get<EngineRubriqueDefDto[]>(`${this.adminBase}/rubriques`,
      { params: new HttpParams().set('paysId', paysId) });
  }

  createRubrique(paysId: number, req: SaveEngineRubriqueRequest): Observable<EngineRubriqueDefDto> {
    return this.http.post<EngineRubriqueDefDto>(`${this.adminBase}/rubriques`, req,
      { params: new HttpParams().set('paysId', paysId) });
  }

  /** Modifie une rubrique (son code ne change pas). */
  updateRubrique(id: number, req: SaveEngineRubriqueRequest): Observable<EngineRubriqueDefDto> {
    return this.http.put<EngineRubriqueDefDto>(`${this.adminBase}/rubriques/${id}`, req);
  }

  // ── Engine run ────────────────────────────────────────────────────────────
  runPayroll(req: RunPayrollRequest): Observable<RunPayrollResponse> {
    return this.http.post<RunPayrollResponse>(`${this.base}/run`, req);
  }

  /** Même calcul que `runPayroll`, rien d'enregistré : aperçu de la pop-up « Calculer la paie »
   *  (éléments variables du mois + net estimé). `resultId` null. */
  previewRun(req: RunPayrollRequest): Observable<RunPayrollResponse> {
    return this.http.post<RunPayrollResponse>(`${this.base}/run/preview`, req);
  }

  /** L'API renvoie l'entité `PayrollResult` brute, pas `RunPayrollResponse` : l'id
   *  s'appelle `id` et `rubriqueDetails` est le JSON stocké en texte. On remet la forme
   *  attendue ici, sinon `resultId` manque et le détail d'une ligne ne s'ouvre pas. */
  getResults(employeeId: number): Observable<RunPayrollResponse[]> {
    return this.http.get<(RunPayrollResponse & { id?: number; variableInputsJson?: string | null })[]>(
      `${this.base}/results/${employeeId}`).pipe(
      map(list => list.map(r => ({
        ...r,
        resultId: r.resultId ?? r.id!,
        rubriqueDetails: parseRubriqueDetails(r.rubriqueDetails),
        variableInputs: r.variableInputs ?? parseVariableInputs(r.variableInputsJson),
      }))),
    );
  }

  /**
   * Détail par rubrique d'un résultat en Excel, généré par le backend — même contrat que les
   * exports de la facturation : `codes` = rubriques affichées, dans l'ordre du tableau
   * (recherche, filtres et tri appliqués) ; libellés selon `lang`.
   */
  exportResultRubriquesXlsx(resultId: number, codes: string[], lang: string): Observable<Blob> {
    return this.http.post(`${this.base}/results/${resultId}/rubriques/export.xlsx`, { ids: codes },
      { params: { lang }, responseType: 'blob' });
  }

  /** Historique de paie d'un collaborateur en Excel (liste des périodes de
   *  `/payroll/engine-results/:employeeId`) : `resultIds` = résultats affichés, dans l'ordre
   *  du tableau (recherche, filtres et tri appliqués). */
  exportResultsHistoryXlsx(employeeId: number, resultIds: number[], lang: string): Observable<Blob> {
    return this.http.post(`${this.base}/results/employee/${employeeId}/export.xlsx`, { ids: resultIds.map(String) },
      { params: { lang }, responseType: 'blob' });
  }

  /** Liste des collaborateurs de `/payroll/engine-results` en Excel : le service paie ne lit
   *  pas l'annuaire RH, le front envoie donc les lignes filtrées (toutes les pages, dans l'ordre
   *  du tri, libellés traduits) et le serveur les met en forme. */
  exportEmployeesXlsx(rows: EmployeeExportRow[], lang: string,
                      period: { from: string | null; to: string | null } = { from: null, to: null }): Observable<Blob> {
    return this.http.post(`${this.base}/results/employees/export.xlsx`, { rows, ...period },
      { params: { lang }, responseType: 'blob' });
  }

  /** Même historique en PDF (pdf-service) ; `employee` = nom affiché dans l'en-tête. */
  exportResultsHistoryPdf(employeeId: number, resultIds: number[], lang: string, employee: string): Observable<Blob> {
    return this.http.post(`${this.base}/results/employee/${employeeId}/export.pdf`, { ids: resultIds.map(String) },
      { params: { lang, employee }, responseType: 'blob' });
  }

  /** Même sélection en PDF (pdf-service) ; `employee` = nom affiché dans l'en-tête. */
  exportResultRubriquesPdf(resultId: number, codes: string[], lang: string, employee: string): Observable<Blob> {
    return this.http.post(`${this.base}/results/${resultId}/rubriques/export.pdf`, { ids: codes },
      { params: { lang, employee }, responseType: 'blob' });
  }

  /** Totaux du dernier mois calculé pour un pays (KPI de `/payroll/engine-results`). */
  getResultsSummary(paysId: number, scope: ResultsScope = {}): Observable<PayrollResultsSummaryDto> {
    return this.http.get<PayrollResultsSummaryDto>(`${this.base}/results/summary`,
      { params: scopeParams(scope).set('paysId', paysId) });
  }

  /** Un résumé par pays paie, chacun dans sa devise — à convertir avant de les additionner. */
  getAllResultsSummaries(scope: ResultsScope = {}): Observable<PayrollResultsSummaryDto[]> {
    return this.http.get<PayrollResultsSummaryDto[]>(`${this.base}/results/summary/all`,
      { params: scopeParams(scope) });
  }

  /** Collaborateurs (userId) ayant au moins un résultat entre `from` et `to` (au mois près). */
  getEmployeesWithResults(scope: { paysId?: number | null; from?: string | null; to?: string | null }): Observable<number[]> {
    let params = scopeParams(scope);
    if (scope.paysId != null) params = params.set('paysId', scope.paysId);
    return this.http.get<number[]>(`${this.base}/results/employees`, { params });
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
