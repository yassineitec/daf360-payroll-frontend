import { Routes } from '@angular/router';

export const PARAMETER_SETS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./parameter-sets.component').then(m => m.ParameterSetsComponent),
  },
];
