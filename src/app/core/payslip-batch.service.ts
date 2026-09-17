import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type PayslipPageStatus = 'SUCCESS' | 'ERROR' | 'UNIDENTIFIED' | 'DUPLICATE';

/** Mirrors PayslipPageResultDto (daf360-rh-service). */
export interface PayslipPageResult {
  pageNumber: number;
  matricule: string | null;
  employeeFullName: string | null;
  status: PayslipPageStatus;
  sharePointUrl: string | null;
  errorMessage: string | null;
}

/** Mirrors PayslipBatchResultDto (daf360-rh-service). */
export interface PayslipBatchResult {
  totalPages: number;
  successCount: number;
  errorCount: number;
  unidentifiedCount: number;
  duplicateCount: number;
  details: PayslipPageResult[];
}

/**
 * Calls **directly into the RH API** (`hrApiUrl`), same mounting as
 * {@link CandidateSimulationService}/{@link HrProfileService}: the employee data, the
 * "Matricule" matching and the SharePoint upload all belong to daf360-rh-service (it owns
 * employee_profiles and the HR SharePoint tree) — nothing about payslip processing is
 * replicated into the payroll database. This app only triggers the batch and reads the
 * report back.
 */
@Injectable({ providedIn: 'root' })
export class PayslipBatchService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.hrApiUrl}/api/hr`;

  processBatch(
    file: File,
    paysId: number,
    periodYear: number,
    periodMonth: number,
  ): Observable<PayslipBatchResult> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('paysId', String(paysId));
    fd.append('periodYear', String(periodYear));
    fd.append('periodMonth', String(periodMonth));
    return this.http.post<PayslipBatchResult>(`${this.base}/payslips/process-batch`, fd);
  }
}
