import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { Store } from '@ngrx/store';
import { selectCurrentUser } from '@khalilrebhiitec/daf360';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

// Reads the current user directly from the shared NgRx store — no UserStore needed.
// This avoids the UserStore → HttpClient → interceptor → UserStore circular dep.
export const authGuard: CanActivateFn = () => {
  const store = inject(Store);
  return firstValueFrom(store.select(selectCurrentUser)).then(user => {
    if (user) return true;
    window.location.href = environment.shellUrl || '/';
    return false;
  });
};
