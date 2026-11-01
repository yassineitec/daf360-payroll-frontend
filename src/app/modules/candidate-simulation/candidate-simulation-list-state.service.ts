import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { CandidateSimulationSummaryDto } from '../../core/candidate-simulation.service';
import { TableSort } from '../../shared/table-tools';

/** La liste `/payroll/candidate-simulation` telle que l'utilisateur l'a laissée. */
export interface CandidateSimulationListState {
  paysId:         number | null;
  searchText:     string;
  statusFilter:   string;
  positionFilter: string | null;
  locationFilter: string | null;
  submittedFilter: Date[] | null;
  sort:           TableSort | null;
  page:           number;
  pageSize:       number;
  viewMode:       'grid' | 'list';
  /** Liste déjà chargée — la fiche s'en sert pour afficher l'en-tête sans attendre. */
  candidates:     CandidateSimulationSummaryDto[];
}

/** Zone où l'état survit : la liste et une fiche candidat (`/42`). */
const ZONE = /\/candidate-simulation(\/\d+)?$/;

/**
 * Mémorise filtres et pays pour que « Retour à la liste » (ou le fil d'Ariane) retrouve la
 * liste telle qu'on l'a quittée — même principe que `SimulatorListStateService`. En mémoire
 * seulement, effacé dès qu'on sort de la zone.
 */
@Injectable({ providedIn: 'root' })
export class CandidateSimulationListStateService {
  private state: CandidateSimulationListState | null = null;

  constructor() {
    inject(Router).events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        const path = e.urlAfterRedirects.split(/[?#]/)[0];
        if (!ZONE.test(path)) this.state = null;
      });
  }

  save(state: CandidateSimulationListState): void {
    this.state = state;
  }

  restore(): CandidateSimulationListState | null {
    return this.state;
  }

  /** Résumé d'un candidat de la dernière liste chargée, s'il y figure. */
  candidate(id: number): CandidateSimulationSummaryDto | undefined {
    return this.state?.candidates.find(c => c.candidateId === id);
  }
}
