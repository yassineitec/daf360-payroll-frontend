import { Routes } from '@angular/router';

export const EMPLOYEE_CONFIG_ROUTES: Routes = [
  // Annuaire des collaborateurs (KPI + cartes / tableau) → clic → configuration de paie du
  // collaborateur. Même découpage que `/payroll/engine-results`.
  { path: '', loadComponent: () => import('./employee-config-list.component').then(m => m.EmployeeConfigListComponent) },
  { path: ':userId', loadComponent: () => import('./employee-config.component').then(m => m.EmployeeConfigComponent) },
];
