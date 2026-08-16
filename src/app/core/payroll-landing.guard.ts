import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { PermissionService } from '@khalilrebhiitec/daf360';
import { PAYROLL_NAV_DEFS } from './payroll-nav';

/**
 * Where `/payroll` — and any URL of a switched-off module — lands.
 *
 * A static `redirectTo: 'simulator'` would send a user who only holds
 * `PAYROLL_APPROVE_PARAMSET` straight into the simulator's guard and out to `/forbidden`,
 * from a link the shell showed them precisely because they *do* have a payroll screen.
 * So the landing route is resolved instead: the first nav entry the user can actually
 * open, in `PAYROLL_NAV_DEFS` order, and `/forbidden` only when there is genuinely none.
 *
 * Uses the same `PermissionService` the lib's `permissionGuard` reads, so this choice and
 * the guard on the target route can never disagree.
 */
export const payrollLandingGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): UrlTree => {
  const perms  = inject(PermissionService);
  const router = inject(Router);

  const first = PAYROLL_NAV_DEFS.find(
    def => !def.permissions.length || perms.hasAny(def.permissions),
  );

  if (!first) return router.parseUrl('/forbidden');

  // Built from the URL being visited rather than hardcoded to `/payroll/…`: federated the
  // module is mounted at `/payroll`, standalone (localhost:4205) it sits at the root.
  // Whatever this route itself consumed is dropped, so the `**` entry
  // (`/payroll/budget`) resolves against the module root and not against itself.
  const visited  = state.url.split(/[?#]/)[0].split('/').filter(Boolean);
  const base     = visited.slice(0, visited.length - route.url.length);

  return router.parseUrl('/' + [...base, first.route].join('/'));
};
