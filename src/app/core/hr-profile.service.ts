import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface HrContractType {
  code: string;
  labelFr: string;
  labelEn: string;
}

export interface EmployeeListItem {
  userId: number;
  profileId: number | null;
  fullName: string;
  /** Matricule paie — employee_profiles.payroll_matricule, e.g. "01", "206".
   *  Le champ JSON garde le nom `employeeId` : seule sa source a changé côté rh-service
   *  (il venait de Users.employee_id, NULL pour tous les profils en prod). */
  employeeId: string | null;
  paysId: number | null;
  paysLabel: string | null;
  contractType: string | null;
  department: string | null;
  lifecycleStatus: string | null;
}

export interface EmployeePage {
  content: EmployeeListItem[];
  totalElements: number;
  totalPages: number;
  last: boolean;
}

@Injectable({ providedIn: 'root' })
export class HrProfileService {
  private readonly base = environment.hrApiUrl;

  constructor(private http: HttpClient) {}

  searchEmployees(search: string = '', paysId?: number | null, size = 20): Observable<EmployeePage> {
    let params = new HttpParams().set('size', size).set('page', 0);
    if (search.trim()) params = params.set('search', search.trim());
    if (paysId != null) params = params.set('pays', paysId);
    return this.http.get<EmployeePage>(`${this.base}/api/hr/profiles/employees`, { params });
  }

  /** Paginated variant for the `/payroll/engine-results` directory — same endpoint, but
   *  the caller drives `page` (0-indexed) instead of always reading the first page. */
  listEmployees(opts: {
    search?: string; paysId?: number | null; status?: string; page: number; size: number;
  }): Observable<EmployeePage> {
    let params = new HttpParams().set('size', opts.size).set('page', opts.page);
    if (opts.search?.trim()) params = params.set('search', opts.search.trim());
    if (opts.paysId != null) params = params.set('pays', opts.paysId);
    // Sans `status`, le service RH ne renvoie que les collaborateurs en poste
    // (ACTIVE / ON_LEAVE / ON_MISSION, ou sans fiche) ; avec, uniquement ce statut.
    if (opts.status) params = params.set('status', opts.status);
    return this.http.get<EmployeePage>(`${this.base}/api/hr/profiles/employees`, { params });
  }

  getContractTypes(paysId?: number | null): Observable<HrContractType[]> {
    let params = new HttpParams();
    if (paysId != null) params = params.set('paysId', paysId);
    return this.http.get<HrContractType[]>(`${this.base}/api/hr/ref/contract-types`, { params })
      .pipe(catchError(() => of([])));
  }
}
