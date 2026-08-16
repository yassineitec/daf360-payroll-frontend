import { Routes } from '@angular/router';
import { inject, provideEnvironmentInitializer } from '@angular/core';
import {
  TranslateService, TranslateLoader, provideChildTranslateService,
} from '@ngx-translate/core';
import { authGuard } from './core/auth.guard';
import { InlineTranslateLoader, PAYROLL_TRANSLATIONS } from './core/inline-translate.loader';
import { PayrollShellComponent } from './layout/payroll-shell.component';
import { provideDafAccess, permissionGuard } from '@khalilrebhiitec/daf360';
import {
  PAYROLL_ADMIN_PERMISSIONS,
  PAYROLL_SIMULATOR_PERMISSIONS,
} from './core/payroll-nav';
import { payrollLandingGuard } from './core/payroll-landing.guard';
import { environment } from '../environments/environment';

/**
 * Remplit le magasin isolé dès la création du sous-arbre, pour que `translate.instant()`
 * appelé dans un `computed` rende déjà le libellé et non la clé — `use()` est asynchrone et
 * les premiers rendus (badges, étapes, options radio) partent avant sa résolution.
 */
function registerTranslations(): void {
  const translate = inject(TranslateService);
  translate.setTranslation('fr', PAYROLL_TRANSLATIONS['fr'], true);
  translate.setTranslation('en', PAYROLL_TRANSLATIONS['en'], true);
  if (!translate.getCurrentLang()) translate.use('fr');
}

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
          // `TranslateService` isolé pour tout le sous-arbre paie, comme dans facturation :
          // le magasin de clés est propre au module (les clés `PAYROLL.*` n'écrasent pas
          // celles du shell hôte) tandis que `use()` / `currentLang` continuent de déléguer
          // à la racine — le module suit donc le sélecteur de langue du shell.
          ...provideChildTranslateService({
            loader: { provide: TranslateLoader, useClass: InlineTranslateLoader },
          }),
          provideEnvironmentInitializer(() => registerTranslations()),
        ],
    children: [
      // ⚠️ Only the simulator and the administration panel are enabled. The six other
      // modules below are built but switched off; their sidebar entries are commented out
      // in `core/payroll-nav.ts` and their routes here. Re-enable BOTH together.
      //
      // Every live route carries `permissionGuard` + `data.permissions`, using the same
      // code lists the sidebar filters on (`core/payroll-nav.ts`). The module had no route
      // guards at all until now — nav-only gating, so a typed URL walked straight into a
      // page that then collected 403s from every call.
      {
        path: 'simulator',
        canActivate: [permissionGuard],
        data: { permissions: PAYROLL_SIMULATOR_PERMISSIONS },
        loadChildren: () =>
          import('./modules/simulator/simulator.routes').then(m => m.SIMULATOR_ROUTES),
      },
      {
        path: 'admin',
        canActivate: [permissionGuard],
        data: { permissions: PAYROLL_ADMIN_PERMISSIONS },
        loadChildren: () =>
          import('./modules/admin/admin.routes').then(m => m.ADMIN_ROUTES),
      },

      // ── Disabled for now — keep in sync with core/payroll-nav.ts ──────────────
      // {
      //   path: 'cohort',
      //   canActivate: [permissionGuard],
      //   data: { permissions: ['PAYROLL_RUN_SIMULATION'] },
      //   loadChildren: () =>
      //     import('./modules/cohort/cohort.routes').then(m => m.COHORT_ROUTES),
      // },
      // {
      //   path: 'calibration',
      //   canActivate: [permissionGuard],
      //   data: { permissions: ['PAYROLL_RUN_CALIBRATION'] },
      //   loadChildren: () =>
      //     import('./modules/calibration/calibration.routes').then(m => m.CALIBRATION_ROUTES),
      // },
      // {
      //   path: 'parameter-sets',
      //   canActivate: [permissionGuard],
      //   data: { permissions: ['PAYROLL_VIEW_PARAMSET'] },
      //   loadChildren: () =>
      //     import('./modules/parameter-sets/parameter-sets.routes').then(m => m.PARAMETER_SETS_ROUTES),
      // },
      // {
      //   path: 'budget',
      //   canActivate: [permissionGuard],
      //   data: { permissions: ['PAYROLL_VIEW_BUDGET_AGGREGATE'] },
      //   loadChildren: () =>
      //     import('./modules/budget/budget.routes').then(m => m.BUDGET_ROUTES),
      // },
      // {
      //   path: 'engine-run',
      //   canActivate: [permissionGuard],
      //   data: { permissions: ['PAYROLL_RUN_ENGINE'] },
      //   loadChildren: () =>
      //     import('./modules/engine-run/engine-run.routes').then(m => m.ENGINE_RUN_ROUTES),
      // },
      // {
      //   path: 'engine-results',
      //   canActivate: [permissionGuard],
      //   data: { permissions: ['PAYROLL_VIEW_RESULTS'] },
      //   loadChildren: () =>
      //     import('./modules/engine-results/engine-results.routes').then(m => m.ENGINE_RESULTS_ROUTES),
      // },

      // Landing route — resolved, not a static `redirectTo: 'simulator'`, so a user who
      // only holds the admin codes isn't bounced to /forbidden by the link the shell just
      // offered them. See `core/payroll-landing.guard.ts`.
      { path: '', pathMatch: 'full', canActivate: [payrollLandingGuard], children: [] },
      // A URL of a switched-off module (`/payroll/budget`, a stale bookmark) goes through
      // the same resolution rather than the shell's 404 — the module still exists, it is
      // just not exposed. The guard always returns a UrlTree, so `children: []` is never
      // rendered.
      { path: '**', canActivate: [payrollLandingGuard], children: [] },
    ],
  },
];
