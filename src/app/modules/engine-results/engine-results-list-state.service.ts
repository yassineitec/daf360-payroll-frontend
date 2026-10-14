import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { TableSort } from '../../shared/table-tools';

/** Tout ce qui décrit la liste « Résultats de paie » telle que l'utilisateur l'a laissée. */
export interface EngineResultsListState {
  searchText:       string;
  paysFilter:       number | null;
  statusFilter:     string | null;
  departmentFilter: string | null;
  contractFilter:   string | null;
  viewMode:         'grid' | 'list';
  employeeSort:     TableSort | null;
  page:             number;
  pageSize:         number;
}

/**
 * Zone où les filtres survivent : la liste (`engine-results`) et l'historique de paie d'un
 * collaborateur (`engine-results/42`). Sans préfixe fixe, pour valoir sous le shell
 * (`/payroll/engine-results`) comme en app servie seule.
 */
const ENGINE_RESULTS_ZONE = /\/engine-results(\/\d+)?$/;

/**
 * Mémorise les filtres de la liste pour que le retour depuis l'historique d'un collaborateur
 * (fil d'Ariane) retrouve la liste telle qu'on l'a quittée.
 *
 * Volontairement en mémoire seulement : un rechargement (F5) repart d'une liste propre.
 * Et toute navigation hors de la zone liste / fiche efface l'état — revenir par le menu
 * après être passé ailleurs ne ramène pas l'ancien filtre.
 */
@Injectable({ providedIn: 'root' })
export class EngineResultsListStateService {
  private state: EngineResultsListState | null = null;

  constructor() {
    inject(Router).events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        const path = e.urlAfterRedirects.split(/[?#]/)[0];
        if (!ENGINE_RESULTS_ZONE.test(path)) this.state = null;
      });
  }

  save(state: EngineResultsListState): void {
    this.state = state;
  }

  restore(): EngineResultsListState | null {
    return this.state;
  }
}
