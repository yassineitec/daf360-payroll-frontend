import { Routes } from '@angular/router';

/**
 *   ''              → liste des candidats (filtres, KPI, cartes/tableau) ;
 *   ':candidateId'  → fiche candidat, rechargeable et partageable par son URL.
 */
export const CANDIDATE_SIMULATION_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./candidate-simulation.component').then(m => m.CandidateSimulationComponent),
  },
  {
    path: ':candidateId',
    loadComponent: () => import('./candidate-simulation-detail.component').then(m => m.CandidateSimulationDetailComponent),
  },
];
