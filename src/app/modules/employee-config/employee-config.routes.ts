import { Routes } from '@angular/router';

export const EMPLOYEE_CONFIG_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./employee-config.component').then(m => m.EmployeeConfigComponent),
  },
];
