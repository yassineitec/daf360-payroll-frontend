import { Routes } from '@angular/router';

/** `/payroll/salary-advances` — gated on PAYROLL_MANAGE_SALARY_ADVANCES in app.routes. */
export const SALARY_ADVANCES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./salary-advances.component').then(m => m.SalaryAdvancesComponent),
  },
];
