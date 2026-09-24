import { Routes } from '@angular/router';

// Route temporarily points at the shared placeholder rather than `CohortComponent` —
// the real component is untouched, just unplugged. Swap the `loadComponent` back to
// restore it.
export const COHORT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../../shared/under-development/under-development.component')
        .then(m => m.UnderDevelopmentComponent),
    data: {
      titleKey: 'PAYROLL.COHORT.TITLE',
    },
  },
];
