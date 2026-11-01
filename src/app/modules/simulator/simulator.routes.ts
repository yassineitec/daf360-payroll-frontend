import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
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
 * Même parcours que les listes de la facturation et de RH :
 *   ''     → liste des simulations (recherche, filtres, KPI, pagination) ;
 *   'new'  → formulaire en 3 étapes ;
 *   ':id'  → fiche résultat, rechargeable et partageable par son URL.
 *
 * `new` et `:id` partagent UNE route (`:id` vaut `new` ou un nombre) : passer de l'une à
 * l'autre garde le même `SimulatorComponent`, donc le formulaire rempli survit à
 * « Simuler » → résultat → « Modifier la simulation » (et au bouton Précédent).
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
    path: ':id',
    loadComponent: () =>
      import('./simulator.component').then(m => m.SimulatorComponent),
  },
];
