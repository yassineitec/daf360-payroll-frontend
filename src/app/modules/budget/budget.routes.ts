import { Routes } from '@angular/router';

export const BUDGET_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./budget.component').then(m => m.BudgetComponent),
  },
];
