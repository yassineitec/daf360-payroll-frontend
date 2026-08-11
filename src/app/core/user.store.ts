import { computed, Injectable } from '@angular/core';
import { inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import {
  MeResponse,
  UserActions,
  selectCurrentUser,
  selectUserPermissions,
} from '@khalilrebhiitec/daf360';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class UserStore {
  private readonly http  = inject(HttpClient);
  private readonly store = inject(Store);

  // Reads from the shared NgRx store — populated by the shell's AuthService on
  // login, so all federated remotes see the same user state without a separate fetch.
  readonly currentUser    = toSignal(this.store.select(selectCurrentUser),    { initialValue: null });
  readonly permissions    = toSignal(this.store.select(selectUserPermissions), { initialValue: [] as string[] });
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly isAdmin         = computed(() =>
    this.currentUser()?.roleName?.toLowerCase() === 'administrateur'
  );

  hasPermission(code: string): boolean {
    if (this.isAdmin()) return true;
    return this.permissions().includes(code);
  }

  // Used in standalone mode (direct access to localhost:4205).
  // In federation, the shell's AuthService already populates the shared store.
  async loadCurrentUser(): Promise<void> {
    try {
      const me = await firstValueFrom(
        this.http.get<MeResponse>(`${environment.portalUrl}/api/me`, { withCredentials: true })
      );
      this.store.dispatch(UserActions.loadCurrentUserSuccess({ user: me }));
    } catch {
      this.store.dispatch(UserActions.clearUser());
    }
  }

  clear(): void {
    this.store.dispatch(UserActions.clearUser());
  }
}
