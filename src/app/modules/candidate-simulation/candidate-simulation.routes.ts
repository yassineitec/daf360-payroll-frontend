import { Routes } from '@angular/router';

export const CANDIDATE_SIMULATION_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./candidate-simulation.component').then(m => m.CandidateSimulationComponent) },
];
