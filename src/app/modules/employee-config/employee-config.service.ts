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
  currentGrossSalary: number | null;
  currentNetSalary: number | null;
  /** Family IRPP-base deduction inputs — see ParameterSetDto's familyDeduction* fields. */
  isMarried: boolean;
  childrenCount: number;
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
}

export interface UpsertEmployeePayrollConfigRequest {
  paysId: number;
  contractType: string;
  selectedBenefitCodes: string[];
  currentGrossSalary: number | null;
  currentNetSalary: number | null;
  isMarried: boolean;
  childrenCount: number;
  reason: string;
  /** Omit/null when currentGrossSalary is already in the working currency. */
  inputCurrency?: string | null;
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
}

export interface CalculateNetResponse {
  netInHand: number;
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

  upsert(profileUserId: number, req: UpsertEmployeePayrollConfigRequest): Observable<EmployeePayrollConfigDto> {
    return this.http.put<EmployeePayrollConfigDto>(`${this.base}/${profileUserId}`, req);
  }

  /** Versions enregistrées de la configuration, la plus récente d'abord. */
  getHistory(profileUserId: number): Observable<EmployeePayrollConfigHistoryDto[]> {
    return this.http.get<EmployeePayrollConfigHistoryDto[]>(`${this.base}/${profileUserId}/history`);
  }

  calculateNet(profileUserId: number, grossSalary: number, inputCurrency?: string | null): Observable<CalculateNetResponse> {
    return this.http.post<CalculateNetResponse>(`${this.base}/${profileUserId}/calculate-net`, { grossSalary, inputCurrency });
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
