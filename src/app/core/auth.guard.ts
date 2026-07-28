import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { UserStore } from './user.store';
import { environment } from '../../environments/environment';

export const authGuard: CanActivateFn = async () => {
  const userStore = inject(UserStore);

  if (userStore.isAuthenticated()) return true;

  await userStore.loadCurrentUser();
  if (userStore.isAuthenticated()) return true;

  window.location.href = environment.shellUrl || '/';
  return false;
};
