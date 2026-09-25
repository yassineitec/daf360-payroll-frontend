import { Routes } from '@angular/router';

// Route temporarily points at the shared placeholder rather than `BudgetComponent`
// — the real component is untouched, just unplugged. Swap the `loadComponent` back to
// restore it.
export const BUDGET_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../../shared/under-development/under-development.component')
        .then(m => m.UnderDevelopmentComponent),
    data: {
      titleKey: 'PAYROLL.BUDGET.TITLE',
    },
  },
];
