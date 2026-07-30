import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError, from, switchMap, EMPTY } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserStore } from './user.store';
import { AuthService } from './auth.service';

function withToken(req: HttpRequest<unknown>, token: string | null | undefined): HttpRequest<unknown> {
  return token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` }, withCredentials: true })
    : req.clone({ withCredentials: true });
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(UserStore);
  const auth  = inject(AuthService);

  const isPortalCall  = req.url.startsWith(environment.portalUrl);
  const isPayrollApi  = req.url.startsWith(environment.payrollApiUrl);
  const isHrApi       = req.url.startsWith(environment.hrApiUrl);

  if (isPortalCall) {
    return next(req.clone({ withCredentials: true })).pipe(
      catchError(err => {
        if (err.status === 401) auth.login();
        return throwError(() => err);
      }),
    );
  }

  if (isPayrollApi || isHrApi) {
    return next(withToken(req, store.user()?.rhToken)).pipe(
      catchError(err => {
        if (err.status !== 401) return throwError(() => err);
        return from(auth.refreshToken()).pipe(
          switchMap(isAuthenticated => {
            if (!isAuthenticated) { auth.login(); return EMPTY; }
            return next(withToken(req, store.user()?.rhToken));
          }),
          catchError(() => { auth.login(); return EMPTY; }),
        );
      }),
    );
  }

  return next(req);
};
