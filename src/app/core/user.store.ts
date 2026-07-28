import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface MeResponse {
  id:          number;
  email:       string;
  fullName:    string;
  roleName:    string;
  photoUrl:    string | null;
  permissions: string[];
  rhToken:     string | null;
}

@Injectable({ providedIn: 'root' })
export class UserStore {
  private readonly _me = signal<MeResponse | null>(null);

  readonly user            = this._me.asReadonly();
  readonly isAuthenticated = computed(() => this._me() !== null);
  readonly permissions     = computed(() => this._me()?.permissions ?? []);
  readonly isAdmin         = computed(() =>
    this._me()?.roleName?.toLowerCase() === 'administrateur'
  );

  constructor(private http: HttpClient) {}

  hasPermission(code: string): boolean {
    if (this.isAdmin()) return true;
    return this.permissions().includes(code);
  }

  async loadCurrentUser(): Promise<void> {
    try {
      const me = await lastValueFrom(
        this.http.get<MeResponse>(`${environment.portalUrl}/api/me`, { withCredentials: true })
      );
      this._me.set(me);
    } catch {
      this._me.set(null);
    }
  }

  clear(): void {
    this._me.set(null);
  }
}
