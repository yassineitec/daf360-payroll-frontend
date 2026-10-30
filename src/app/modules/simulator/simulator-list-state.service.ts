import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { TableSort } from '../../shared/table-tools';

/** La liste `/payroll/simulator` telle que l'utilisateur l'a laissée. */
export interface SimulatorListState {
  searchText:     string;
  paysFilter:     number | null;
  contractFilter: string | null;
  subjectFilter:  string | null;
  modeFilter:     string | null;
  partialOnly:    boolean;
  sort:           TableSort | null;
  page:           number;
  pageSize:       number;
  /** Vue choisie dans la barre : tableau (`list`) ou cartes (`grid`). */
  viewMode:       'list' | 'grid';
}

/** Zone où les filtres survivent : la liste, le formulaire (`new`) et une fiche (`42`). */
const SIMULATOR_ZONE = /\/simulator(\/(new|\d+))?$/;

/**
 * Mémorise les filtres de la liste pour que le retour depuis une fiche ou le formulaire
 * (fil d'Ariane, « Retour à la liste ») la retrouve telle qu'on l'a quittée — même principe
 * que `EmployeeConfigListStateService`. En mémoire seulement, et effacé dès qu'on sort de
 * la zone simulateur.
 */
@Injectable({ providedIn: 'root' })
export class SimulatorListStateService {
  private state: SimulatorListState | null = null;

  constructor() {
    inject(Router).events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        const path = e.urlAfterRedirects.split(/[?#]/)[0];
        if (!SIMULATOR_ZONE.test(path)) this.state = null;
      });
  }

  save(state: SimulatorListState): void {
    this.state = state;
  }

  restore(): SimulatorListState | null {
    return this.state;
  }
}
