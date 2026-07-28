import { Routes } from '@angular/router';

export const SIMULATOR_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./simulator.component').then(m => m.SimulatorComponent),
  },
];
