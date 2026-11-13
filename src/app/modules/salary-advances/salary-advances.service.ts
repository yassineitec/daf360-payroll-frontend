import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Payroll's side of the salary advances (payroll-service, V25 / V39): the payout of what the
 * DAF granted — blocked until the debt contract is signed where the country requires it — the
 * monthly deductions, the follow-up and the per-country rules. Every call needs
 * PAYROLL_MANAGE_SALARY_ADVANCES server-side. The employee asks from the shell's self-service;
 * the director (above the threshold) and the DAF decide from finance.
 */

export type AdvanceStatus =
  | 'PENDING_DIRECTOR' | 'PENDING_FINANCE' | 'REJECTED' | 'APPROVED' | 'REPAYING' | 'REPAID' | 'CANCELLED';

export const ADVANCE_STATUSES: AdvanceStatus[] =
  ['PENDING_DIRECTOR', 'PENDING_FINANCE', 'APPROVED', 'REPAYING', 'REPAID', 'REJECTED', 'CANCELLED'];

export type ContractStatus = 'TO_SIGN' | 'SIGNED';

export type InstallmentStatus = 'PLANNED' | 'DEDUCTED' | 'SKIPPED' | 'WAIVED';

export type DisbursementMethod = 'ESPECES' | 'VIREMENT' | 'CARTE' | 'AUTRE';
export const DISBURSEMENT_METHODS: DisbursementMethod[] = ['VIREMENT', 'ESPECES', 'CARTE', 'AUTRE'];

export interface AdvanceInstallment {
  id: number;
  seq: number;
  dueMonth: string;
  amount: number;
  status: InstallmentStatus;
  processedAt: string | null;
  notes: string | null;
}

export interface SalaryAdvance {
  id: number;
  paysId: number;
  employeeUserId: number;
  employeeName: string | null;
  currency: string;
  /** Asked until approval, granted from then on. */
  amount: number;
  installments: number;
  /** "yyyy-MM" — null until the DAF sets it. */
  firstDeductionMonth: string | null;
  lastDeductionMonth: string | null;
  monthlyAmount: number | null;
  requestedAmount: number;
  requestedInstallments: number;
  requestedAvailabilityDate: string | null;
  /** « Date d'effet », "yyyy-MM-dd". */
  effectiveDate: string | null;
  reason: string | null;
  status: AdvanceStatus;
  directorThreshold: number | null;
  requireSignedContract: boolean;
  directorDecidedByName: string | null;
  directorDecidedAt: string | null;
  directorNotes: string | null;
  contractStatus: ContractStatus | null;
  contractAvailable: boolean;
  contractGeneratedAt: string | null;
  signedContractAvailable: boolean;
  signedContractUploadedByName: string | null;
  signedContractUploadedAt: string | null;
  financeDecidedByName: string | null;
  financeDecidedAt: string | null;
  financeNotes: string | null;
  disbursementMethod: string | null;
  disbursementReference: string | null;
  disbursedOn: string | null;
  disbursedByName: string | null;
  outstandingAmount: number | null;
  repaidAt: string | null;
  createdAt: string;
  schedule: AdvanceInstallment[];
}

export interface DeductionRow {
  installmentId: number;
  salaryAdvanceId: number;
  employeeUserId: number;
  employeeName: string | null;
  payrollMatricule: string | null;
  paysId: number;
  month: string;
  seq: number;
  installmentsTotal: number;
  amount: number;
  currency: string;
  status: InstallmentStatus;
  outstandingAmount: number | null;
}

export interface AdvancePolicy {
  paysId: number;
  currency: string;
  maxInstallments: number;
  minSeniorityMonths: number;
  isActive: boolean;
  /** Above it (in `currency`) a director validates first. Null = no director step. */
  directorThreshold: number | null;
  /** Payout blocked until the signed contract is archived. */
  requireSignedContract: boolean;
  updatedAt?: string | null;
}

export interface DisbursePayload {
  method: DisbursementMethod;
  reference: string | null;
  /** yyyy-MM-dd */
  disbursedOn: string;
  notes: string | null;
}

@Injectable({ providedIn: 'root' })
export class SalaryAdvancesService {
  private http = inject(HttpClient);
  private base = environment.payrollApiUrl + '/api/payroll/salary-advances';

  list(statuses: AdvanceStatus[] = []): Observable<SalaryAdvance[]> {
    let params = new HttpParams();
    statuses.forEach(s => (params = params.append('status', s)));
    return this.http.get<SalaryAdvance[]>(this.base, { params });
  }

  toDisburse(): Observable<SalaryAdvance[]> {
    return this.http.get<SalaryAdvance[]>(`${this.base}/to-disburse`);
  }

  get(id: number): Observable<SalaryAdvance> {
    return this.http.get<SalaryAdvance>(`${this.base}/${id}`);
  }

  /** The generated contract, or the signed scan with `signed`. */
  contract(id: number, signed: boolean): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/contract`, {
      params: new HttpParams().set('signed', signed), responseType: 'blob',
    });
  }

  disburse(id: number, payload: DisbursePayload): Observable<SalaryAdvance> {
    return this.http.post<SalaryAdvance>(`${this.base}/${id}/disburse`, payload);
  }

  deductions(month: string): Observable<DeductionRow[]> {
    return this.http.get<DeductionRow[]>(`${this.base}/deductions`, { params: new HttpParams().set('month', month) });
  }

  exportDeductions(month: string): Observable<Blob> {
    return this.http.get(`${this.base}/deductions/export`, {
      params: new HttpParams().set('month', month), responseType: 'blob',
    });
  }

  markDeducted(installmentIds: number[]): Observable<{ updated: number }> {
    return this.http.post<{ updated: number }>(`${this.base}/installments/deducted`, { installmentIds, notes: null });
  }

  skip(installmentIds: number[], notes: string): Observable<{ updated: number }> {
    return this.http.post<{ updated: number }>(`${this.base}/installments/skip`, { installmentIds, notes });
  }

  waive(installmentIds: number[], notes: string): Observable<{ updated: number }> {
    return this.http.post<{ updated: number }>(`${this.base}/installments/waive`, { installmentIds, notes });
  }

  policies(): Observable<AdvancePolicy[]> {
    return this.http.get<AdvancePolicy[]>(`${this.base}/policies`);
  }

  savePolicy(policy: AdvancePolicy): Observable<AdvancePolicy> {
    return this.http.put<AdvancePolicy>(`${this.base}/policies/${policy.paysId}`, policy);
  }
}
