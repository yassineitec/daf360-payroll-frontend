import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Shape of `RefDataItemDto` (daf360-rh-service, `modules.dto.ref`) as returned by the real
 * grade/discipline reference endpoints below. Previously this service called the generic
 * `/api/hr/lists/{GRADE,DISCIPLINE}` configurable-list endpoints instead -- those list TYPES
 * were never created in daf360-rh-service at all (confirmed empty on both localhost and
 * 192.168.1.233), so the Simulator's Grade/Discipline dropdowns were always empty regardless
 * of country. The real data (grades/disciplines tables, e.g. 61 grades + 24 disciplines for
 * Tunisia) lives behind `/api/hr/ref/grades`/`/disciplines` instead -- the same endpoints
 * EmployeeProfileController and the rest of the RH app already use. Fixed 2026-10-23.
 */
export interface ConfigurableListValueDto {
  id: number;
  code: string;
  labelFr: string;
  labelEn: string | null;
  sortOrder: number;
  isActive: boolean;
}

@Injectable({ providedIn: 'root' })
export class HrRefApiService {
  private readonly base = environment.hrApiUrl + '/api/hr/ref';

  constructor(private http: HttpClient) {}

  listGrades(paysId?: number): Observable<ConfigurableListValueDto[]> {
    let params = new HttpParams();
    if (paysId != null) params = params.set('paysId', paysId);
    return this.http.get<ConfigurableListValueDto[]>(`${this.base}/grades`, { params });
  }

  listDisciplines(paysId?: number): Observable<ConfigurableListValueDto[]> {
    let params = new HttpParams();
    if (paysId != null) params = params.set('paysId', paysId);
    return this.http.get<ConfigurableListValueDto[]>(`${this.base}/disciplines`, { params });
  }
}
