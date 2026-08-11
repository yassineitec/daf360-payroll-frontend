import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectCurrentUser } from '@khalilrebhiitec/daf360';
import { catchError, throwError, from, switchMap, EMPTY, take } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

function withToken(
  req: HttpRequest<unknown>,
  token: string | null | undefined,
): HttpRequest<unknown> {
  return token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` }, withCredentials: true })
    : req.clone({ withCredentials: true });
}

/** Read the current user's rhToken synchronously from the NgRx store. */
function getRhToken(store: Store): string | null | undefined {
  let token: string | null | undefined;
  store.select(selectCurrentUser).pipe(take(1)).subscribe(u => { token = u?.rhToken; });
  return token;
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Use Store directly — avoids UserStore → HttpClient → interceptor → UserStore cycle.
  const store    = inject(Store);
  // Use Injector for lazy AuthService access — AuthService injects UserStore,
  // so we must NOT inject it eagerly here (same cycle risk).
  const injector = inject(Injector);
  const getAuth  = () => injector.get(AuthService);

  const isPortalCall = req.url.startsWith(environment.portalUrl);
  const isPayrollApi = req.url.startsWith(environment.payrollApiUrl);
  const isHrApi      = req.url.startsWith(environment.hrApiUrl);

  if (isPortalCall) {
    return next(req.clone({ withCredentials: true })).pipe(
      catchError(err => {
        if (err.status === 401) getAuth().login();
        return throwError(() => err);
      }),
    );
  }

  if (isPayrollApi || isHrApi) {
    return next(withToken(req, getRhToken(store))).pipe(
      catchError(err => {
        if (err.status !== 401) return throwError(() => err);
        return from(getAuth().refreshToken()).pipe(
          switchMap(isAuthenticated => {
            if (!isAuthenticated) { getAuth().login(); return EMPTY; }
            // Re-read token from store after successful refresh
            return next(withToken(req, getRhToken(store)));
          }),
          catchError(() => { getAuth().login(); return EMPTY; }),
        );
      }),
    );
  }

  return next(req);
};
