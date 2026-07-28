import { Routes } from '@angular/router';

export const ENGINE_RESULTS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./engine-results.component').then(m => m.EngineResultsComponent) },
];
