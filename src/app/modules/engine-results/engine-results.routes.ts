import { Routes } from '@angular/router';

export const ENGINE_RESULTS_ROUTES: Routes = [
  // Annuaire des collaborateurs (cartes / tableau) → clic → historique de paie du collaborateur.
  { path: '', loadComponent: () => import('./engine-results-list.component').then(m => m.EngineResultsListComponent) },
  { path: ':employeeId', loadComponent: () => import('./engine-results.component').then(m => m.EngineResultsComponent) },
];
