import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { PayrollShellComponent } from './layout/payroll-shell.component';
import { provideState } from '@ngrx/store';
import { provideEnvironmentInitializer } from '@angular/core';
import { provideDafAccess } from '@khalilrebhiitec/daf360';
import { environment } from '../environments/environment';

export const routes: Routes = [
  // Pas de redirection racine ici : la valeur par défaut est déclarée sur les enfants
  // (`'' → simulator`, en fin de liste), comme dans facturation et log. Il y avait
  // `{ path: '', redirectTo: '', pathMatch: 'full' }`, une route qui se redirigeait vers
  // elle-même — supprimée parce qu'elle est fautive en soi, mais ce n'était PAS la cause du
  // NG0203 : celui-ci persistait après. Voir `core/auth.guard.ts` pour la vraie raison.
  {
    path: '',
    component: PayrollShellComponent,
    canActivate: [authGuard],
       providers: [
          // Feeds the lib permission guard: unauthenticated → shell login; a permission
          // denial → the shell's /forbidden page (federation shares one Router).
          ...provideDafAccess({
            loginRedirect: () => { window.location.href = environment.shellUrl || '/'; },
            forbiddenRoute: '/forbidden',
          }),
        ],
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
        path: 'budget',
        loadChildren: () =>
          import('./modules/budget/budget.routes').then(m => m.BUDGET_ROUTES),
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
