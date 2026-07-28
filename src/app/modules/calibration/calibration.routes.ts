import { Routes } from '@angular/router';

export const CALIBRATION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./calibration.component').then(m => m.CalibrationComponent),
  },
];
