import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

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

  /** Fiche complète (`GET /api/hr/profiles/{id}`, par `profileId`) — carte « Détails » de
   *  `/payroll/engine-results/:employeeId`. */
  getProfile(profileId: number): Observable<EmployeeProfileDetail> {
    return this.http.get<EmployeeProfileDetail>(`${this.base}/api/hr/profiles/${profileId}`);
  }

  /** `photoUrl` est stocké relatif (`/api/hr/profiles/{id}/photo`, servi sans jeton) —
   *  préfixé ici par l'URL du service RH ; `null` quand le profil n'a pas de photo. */
  photoSrc(photoUrl: string | null | undefined): string | null {
    return photoUrl ? `${this.base}${photoUrl}` : null;
  }
}

/**
 * Sous-ensemble de `EmployeeProfileResponseDto` (daf360-rh-service) lu par la paie. Les champs
 * sensibles (banque, CIN, passeport, n° SS, matricule fiscal) sont masqués par le service RH
 * pour les appelants sans droit RH — ils ne sont volontairement pas déclarés ici.
 */
export interface EmployeeProfileDetail {
  id: number;
  userId: number;
  fullName: string | null;
  matricule: string | null;
  paysLabel: string | null;
  lifecycleStatus: string | null;
  photoUrl: string | null;
  // Contrat
  hireDate: string | null;          // ISO yyyy-MM-dd
  contractType: string | null;
  contractEndDate: string | null;
  probationEndDate: string | null;
  isOnProbation: boolean | null;
  regimeLabelFr: string | null;
  // Poste
  department: string | null;
  grade: string | null;
  discipline: string | null;
  nogLevel: string | null;
  // Paie
  maritalStatus: string | null;
  numberOfChildren: number | null;
  cnssNumber: string | null;
  cnssAffiliationDate: string | null;
}
