import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface EmployeeListItem {
  userId: number;
  profileId: number | null;
  fullName: string;
  employeeId: string | null;  // matricule e.g. "DUPPIE125"
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
}
