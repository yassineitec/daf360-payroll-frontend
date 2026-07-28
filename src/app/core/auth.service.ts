import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { UserStore } from './user.store';

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(private store: UserStore) {}

  login(): void {
    window.location.href = `${environment.portalUrl}/oauth2/authorization/azure`;
  }

  logout(): void {
    this.store.clear();
    window.location.href = `${environment.portalUrl}/logout`;
  }

  async refreshToken(): Promise<boolean> {
    try {
      await this.store.loadCurrentUser();
      return this.store.isAuthenticated();
    } catch {
      return false;
    }
  }
}
