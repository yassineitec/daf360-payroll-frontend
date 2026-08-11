import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ConfigurableListValueDto {
  id: number;
  valueCode: string;
  labelFr: string;
  labelEn: string | null;
  sortOrder: number;
  isActive: boolean;
}

@Injectable({ providedIn: 'root' })
export class HrRefApiService {
  private readonly base = environment.hrApiUrl + '/api/hr/lists';

  constructor(private http: HttpClient) {}

  listGrades(paysId?: number): Observable<ConfigurableListValueDto[]> {
    let params = new HttpParams();
    if (paysId != null) params = params.set('pays', paysId);
    return this.http.get<ConfigurableListValueDto[]>(`${this.base}/GRADE`, { params });
  }

  listDisciplines(paysId?: number): Observable<ConfigurableListValueDto[]> {
    let params = new HttpParams();
    if (paysId != null) params = params.set('pays', paysId);
    return this.http.get<ConfigurableListValueDto[]>(`${this.base}/DISCIPLINE`, { params });
  }
}
