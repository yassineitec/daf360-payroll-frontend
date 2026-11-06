import { Routes } from '@angular/router';

export const ENGINE_RUN_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./engine-run.component').then(m => m.EngineRunComponent) },
];
