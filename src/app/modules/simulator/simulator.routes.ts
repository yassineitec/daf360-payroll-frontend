import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes, UrlMatcher, UrlMatchResult } from '@angular/router';
import { PermissionService } from '@khalilrebhiitec/daf360';

/** Codes qui ouvrent la liste — ceux de `GET /simulations/individual` côté backend. */
export const SIMULATION_HISTORY_PERMISSIONS = ['PAYROLL_VIEW_INDIVIDUAL', 'PAYROLL_VIEW_AGGREGATE'];

/**
 * Un utilisateur qui peut simuler mais pas consulter l'historique arrive directement sur le
 * formulaire, plutôt que sur une liste qui ne lui renverrait que des 403. Même
 * `PermissionService` que le `permissionGuard` de la lib.
 */
const simulationListGuard: CanActivateFn = (_route, state) => {
  if (inject(PermissionService).hasAny(SIMULATION_HISTORY_PERMISSIONS)) return true;
  const path = state.url.split(/[?#]/)[0].replace(/\/$/, '');
  return inject(Router).parseUrl(`${path}/new`);
};

/**
 * `new`, `:id` et `:id/edit` sur UNE seule route : `id` vaut `new` ou un nombre, `edit`
 * n'est présent que sur le formulaire de modification. Trois routes distinctes (comme
 * les affaires) recréeraient le composant à chaque passage, et le formulaire rempli
 * serait perdu entre « Simuler » → résultat → « Modifier la simulation ».
 */
const simulatorMatcher: UrlMatcher = (segments): UrlMatchResult | null => {
  const [first, second] = segments;
  if (!first || segments.length > 2) return null;
  if (segments.length === 1) {
    return /^(new|\d+)$/.test(first.path) ? { consumed: segments, posParams: { id: first } } : null;
  }
  return /^\d+$/.test(first.path) && second.path === 'edit'
    ? { consumed: segments, posParams: { id: first, edit: second } }
    : null;
};

/**
 * Même parcours que les listes de la facturation et de RH :
 *   ''          → liste des simulations (recherche, filtres, KPI, pagination) ;
 *   'new'       → formulaire en 3 étapes ;
 *   ':id'       → fiche résultat, rechargeable et partageable par son URL ;
 *   ':id/edit'  → formulaire pré-rempli avec la simulation `:id` (« Modifier la simulation »).
 *
 * Les trois dernières partagent le même `SimulatorComponent` (voir `simulatorMatcher`).
 */
export const SIMULATOR_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [simulationListGuard],
    loadComponent: () =>
      import('./simulator-list.component').then(m => m.SimulatorListComponent),
  },
  {
    matcher: simulatorMatcher,
    loadComponent: () =>
      import('./simulator.component').then(m => m.SimulatorComponent),
  },
];
