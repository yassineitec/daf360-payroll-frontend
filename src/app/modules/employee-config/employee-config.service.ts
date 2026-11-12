import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface EmployeePayrollConfigDto {
  profileUserId: number;
  // Null on a never-configured employee whose country the cross-service HR lookup couldn't
  // resolve — the admin picks one explicitly via the country select in that case.
  paysId: number | null;
  contractType: string;
  selectedBenefitCodes: string[];
  /** In the working currency. When `inputCurrency` is set, the amount as typed is
   *  `inputAmountOriginal` — that is what the gross field must show and send back (sending
   *  this converted figure with `inputCurrency` converted it a second time). */
  currentGrossSalary: number | null;
  /** Computed by the payroll engine from the gross on every save — read-only. */
  currentNetSalary: number | null;
  /** Family IRPP-base deduction inputs — read from the RH profile (source of truth), not
   *  editable here. See ParameterSetDto's familyDeduction* fields. */
  isMarried: boolean;
  childrenCount: number;
  /** false = RH unreachable: the last value read from RH is shown. */
  familyFromHr: boolean | null;
  updatedBy: number | null;
  updatedAt: string | null;
  /** Set only when the stored gross salary was originally typed in a different currency
   *  than the working one — null in the common case. */
  inputCurrency: string | null;
  inputAmountOriginal: number | null;
  /** The country's working currency — resolved server-side, same value `salaryCurrency()`
   *  already derives locally from `paysList`; present for parity with other consumers of
   *  this DTO shape, not required reading here. */
  workingCurrency: string | null;
  /** Date the current salary applies from (yyyy-MM-dd); null before payroll V37. */
  effectiveDate: string | null;
}

export interface UpsertEmployeePayrollConfigRequest {
  paysId: number;
  contractType: string;
  selectedBenefitCodes: string[];
  /** As typed, in `inputCurrency` (or in the working currency when that is null). */
  currentGrossSalary: number | null;
  /** Ignored by the server whenever it can compute the net from the gross. */
  currentNetSalary: number | null;
  reason: string;
  /** Omit/null when currentGrossSalary is already in the working currency. */
  inputCurrency?: string | null;
  /** Date the salary applies from (yyyy-MM-dd); omitted = the day of the save (payroll V37). */
  effectiveDate?: string | null;
}

/** Une version enregistrée de la configuration (`GET …/{id}/history`, plus récente d'abord). */
export interface EmployeePayrollConfigHistoryDto {
  paysId: number | null;
  contractType: string;
  selectedBenefitCodes: string[];
  currentGrossSalary: number | null;
  currentNetSalary: number | null;
  reason: string | null;
  changedBy: number | null;
  changedAt: string;
  inputCurrency: string | null;
  inputAmountOriginal: number | null;
  /** Payroll V37+: date the salary applies from (null on older rows), author's name. */
  effectiveDate?: string | null;
  changedByName?: string | null;
}

export interface CalculateNetResponse {
  netInHand: number;
}

/** `CalculationFormValues` de daf360-payroll-service : ce que le formulaire affiche. */
export interface CalculationFormValues {
  paysId: number | null;
  contractType: string | null;
  selectedBenefitCodes: string[];
  isMarried: boolean;
  childrenCount: number;
}

/** `grossSalary` dans la devise de saisie ; `netInHand` dans la devise de travail, comme
 *  `CalculateNetResponse`. */
export interface CalculateGrossResponse {
  grossSalary: number;
  netInHand: number;
  convergenceOk: boolean;
}

export interface EmployeePayrollBonusDto {
  id: number;
  profileUserId: number;
  amount: number;
  currency: string;
  periodMonth: number;
  periodYear: number;
  label: string;
  comment: string | null;
  createdBy: number;
  createdAt: string;
}

export interface CreateEmployeePayrollBonusRequest {
  amount: number;
  currency: string;
  periodMonth: number;
  periodYear: number;
  label: string;
  comment: string | null;
}

/**
 * The config as the form edits it: when the gross was typed in another currency, the field
 * shows (and sends back) the amount AS TYPED, not the converted one stored in
 * `currentGrossSalary` — otherwise every save converted the salary once more.
 */
export function toEditableConfig(dto: EmployeePayrollConfigDto): EmployeePayrollConfigDto {
  return dto.inputCurrency && dto.inputAmountOriginal != null
    ? { ...dto, currentGrossSalary: dto.inputAmountOriginal }
    : dto;
}

@Injectable({ providedIn: 'root' })
export class EmployeeConfigService {
  private http = inject(HttpClient);
  private base = environment.payrollApiUrl + '/api/payroll/employee-configs';

  get(profileUserId: number): Observable<EmployeePayrollConfigDto> {
    return this.http.get<EmployeePayrollConfigDto>(`${this.base}/${profileUserId}`);
  }

  /** userId → contrat de la configuration paie enregistrée (absent = jamais enregistrée). */
  getSavedContractTypes(userIds: number[]): Observable<Record<number, string>> {
    return this.http.get<Record<number, string>>(`${this.base}/contract-types`, {
      params: { userIds: userIds.join(',') },
    });
  }

  /** Payroll V38: change of an already-paid employee, applied once the Country Director approves. */
  submitSalaryChange(profileUserId: number, req: {
    paysId: number; contractType: string; selectedBenefitCodes: string[]; grossSalary: number;
    inputCurrency: string | null; effectiveDate: string | null; reason: string;
  }): Observable<unknown> {
    return this.http.post(`${environment.payrollApiUrl}/api/payroll/salary-changes/employee/${profileUserId}`, req);
  }

  upsert(profileUserId: number, req: UpsertEmployeePayrollConfigRequest): Observable<EmployeePayrollConfigDto> {
    return this.http.put<EmployeePayrollConfigDto>(`${this.base}/${profileUserId}`, req);
  }

  /** Versions enregistrées de la configuration, la plus récente d'abord. */
  getHistory(profileUserId: number): Observable<EmployeePayrollConfigHistoryDto[]> {
    return this.http.get<EmployeePayrollConfigHistoryDto[]>(`${this.base}/${profileUserId}/history`);
  }

  /** Net by the real payroll engine (nothing saved). `form` : valeurs affichées (pas forcément
   *  enregistrées) — le serveur calcule avec leur pays / contrat, sinon avec la configuration
   *  enregistrée. paysId / contractType sont aussi envoyés à plat (format accepté par le serveur). */
  calculateNet(profileUserId: number, grossSalary: number, inputCurrency?: string | null,
               form?: CalculationFormValues): Observable<CalculateNetResponse> {
    return this.http.post<CalculateNetResponse>(`${this.base}/${profileUserId}/calculate-net`,
      { grossSalary, inputCurrency, paysId: form?.paysId ?? null, contractType: form?.contractType ?? null, form });
  }

  /** Calcul inverse : net saisi (devise de saisie) → brut dans cette même devise. */
  calculateGross(profileUserId: number, netSalary: number, inputCurrency?: string | null,
                 form?: CalculationFormValues): Observable<CalculateGrossResponse> {
    return this.http.post<CalculateGrossResponse>(`${this.base}/${profileUserId}/calculate-gross`, { netSalary, inputCurrency, form });
  }

  getBonuses(profileUserId: number): Observable<EmployeePayrollBonusDto[]> {
    return this.http.get<EmployeePayrollBonusDto[]>(`${this.base}/${profileUserId}/bonuses`);
  }

  createBonus(profileUserId: number, req: CreateEmployeePayrollBonusRequest): Observable<EmployeePayrollBonusDto> {
    return this.http.post<EmployeePayrollBonusDto>(`${this.base}/${profileUserId}/bonuses`, req);
  }

  deleteBonus(profileUserId: number, bonusId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${profileUserId}/bonuses/${bonusId}`);
  }
}
