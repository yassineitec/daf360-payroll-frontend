import { Routes } from '@angular/router';

/**
 * Même parcours que le simulateur :
 *   ''     → historique des lots distribués (KPI, recherche, filtres, cartes / tableau) ;
 *   'new'  → import d'un fichier de paie ;
 *   ':id'  → rapport d'un lot de l'historique.
 *
 * `new` et `:id` partagent UNE route : après le traitement, l'import bascule sur le
 * rapport du lot (`/payroll/payslips/<id>`) sans recréer le composant.
 */
export const PAYSLIPS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./payslip-list.component').then(m => m.PayslipListComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./payslip-batch.component').then(m => m.PayslipBatchComponent),
  },
];
