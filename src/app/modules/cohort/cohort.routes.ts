import { Routes } from '@angular/router';

export const COHORT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./cohort.component').then(m => m.CohortComponent),
  },
];
