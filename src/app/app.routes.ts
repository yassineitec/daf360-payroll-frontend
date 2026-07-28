import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { PayrollShellComponent } from './layout/payroll-shell.component';

export const routes: Routes = [
  {
    path: '',
    component: PayrollShellComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'simulator',
        loadChildren: () =>
          import('./modules/simulator/simulator.routes').then(m => m.SIMULATOR_ROUTES),
      },
      {
        path: 'cohort',
        loadChildren: () =>
          import('./modules/cohort/cohort.routes').then(m => m.COHORT_ROUTES),
      },
      {
        path: 'calibration',
        loadChildren: () =>
          import('./modules/calibration/calibration.routes').then(m => m.CALIBRATION_ROUTES),
      },
      {
        path: 'parameter-sets',
        loadChildren: () =>
          import('./modules/parameter-sets/parameter-sets.routes').then(m => m.PARAMETER_SETS_ROUTES),
      },
      {
        path: 'admin',
        loadChildren: () =>
          import('./modules/admin/admin.routes').then(m => m.ADMIN_ROUTES),
      },
      {
        path: 'engine-run',
        loadChildren: () =>
          import('./modules/engine-run/engine-run.routes').then(m => m.ENGINE_RUN_ROUTES),
      },
      {
        path: 'engine-results',
        loadChildren: () =>
          import('./modules/engine-results/engine-results.routes').then(m => m.ENGINE_RESULTS_ROUTES),
      },
      { path: '', redirectTo: 'simulator', pathMatch: 'full' },
    ],
  },
];
