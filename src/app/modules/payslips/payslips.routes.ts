import { Routes } from '@angular/router';

export const PAYSLIPS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./payslip-batch.component').then(m => m.PayslipBatchComponent),
  },
];
