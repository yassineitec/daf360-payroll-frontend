import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { TableSort } from '../../shared/table-tools';

/** Tout ce qui décrit la liste « Salaires des collaborateurs » telle que l'utilisateur l'a laissée. */
export interface EmployeeConfigListState {
  searchText:       string;
  paysFilter:       number | null;
  statusFilter:     string | null;
  departmentFilter: string | null;
  contractFilter:   string | null;
  employeeSort:     TableSort | null;
  page:             number;
}

/**
 * Zone où les filtres survivent : la liste (`employee-config`) et la configuration d'un
 * collaborateur (`employee-config/42`, avec ou sans `?tab=`). Sans préfixe fixe, pour valoir
 * sous le shell (`/payroll/employee-config`) comme en app servie seule.
 */
const EMPLOYEE_CONFIG_ZONE = /\/employee-config(\/\d+)?$/;

/**
 * Mémorise les filtres de la liste pour que le retour depuis la configuration d'un
 * collaborateur (fil d'Ariane) retrouve la liste telle qu'on l'a quittée.
 *
 * Volontairement en mémoire seulement : un rechargement (F5) repart d'une liste propre.
 * Et toute navigation hors de la zone liste / fiche efface l'état — revenir par
 * l'administration après être passé ailleurs ne ramène pas l'ancien filtre.
 */
@Injectable({ providedIn: 'root' })
export class EmployeeConfigListStateService {
  private state: EmployeeConfigListState | null = null;

  constructor() {
    inject(Router).events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        const path = e.urlAfterRedirects.split(/[?#]/)[0];
        if (!EMPLOYEE_CONFIG_ZONE.test(path)) this.state = null;
      });
  }

  save(state: EmployeeConfigListState): void {
    this.state = state;
  }

  restore(): EmployeeConfigListState | null {
    return this.state;
  }
}
