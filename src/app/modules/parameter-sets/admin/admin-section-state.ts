import { Injectable, WritableSignal, effect, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Zone où les filtres des sections survivent : `/payroll/admin` (avec ou sans `?tab=` /
 * `?set=`) et « Salaires des collaborateurs » (`employee-config`, sa liste et ses fiches),
 * carte de cette même administration dont le fil d'Ariane y ramène. Sans préfixe fixe,
 * pour valoir sous le shell comme en app servie seule.
 */
const ADMIN_ZONE = /\/(admin|employee-config(\/\d+)?)$/;

/**
 * Mémoire des filtres des sections de `/payroll/admin`, une entrée par section (clé libre,
 * ex. `rubriques`) — même mécanisme que `/rh/admin`.
 *
 * Une section est un composant qui naît à l'ouverture de sa carte et meurt au retour à
 * l'accueil : sans cette mémoire, ses filtres repartaient de zéro à chaque fois.
 *
 * Volontairement en mémoire seulement : un rechargement (F5) repart de sections propres, et
 * quitter l'administration efface tout.
 */
@Injectable({ providedIn: 'root' })
export class AdminSectionStateService {
  private readonly state = new Map<string, Record<string, unknown>>();

  constructor() {
    inject(Router).events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        const path = e.urlAfterRedirects.split(/[?#]/)[0];
        if (!ADMIN_ZONE.test(path)) this.state.clear();
      });
  }

  save(key: string, values: Record<string, unknown>): void {
    this.state.set(key, values);
  }

  restore(key: string): Record<string, unknown> | null {
    return this.state.get(key) ?? null;
  }
}

/**
 * Fait mémoriser à une section de `/payroll/admin` les signaux qui décrivent sa vue —
 * recherche, filtres, tri, page — et les lui rend quand elle renaît.
 *
 * À appeler en initialiseur de champ, APRÈS la déclaration des signaux passés :
 *
 *   private readonly memory = rememberAdminState('rubriques', {
 *     search: this.search, filters: this.filters, page: this.page,
 *   });
 *
 * La restauration a lieu à la construction, donc avant `ngOnInit` et avant le premier
 * rendu : le premier chargement part déjà des bons filtres, et `daf-filter` — qui ne lit
 * `initialValues` qu'une fois — s'ouvre déjà rempli. Seuls des `WritableSignal` (pas des
 * `input()`) ; jamais la sélection en cours ni une modale ouverte.
 */
export function rememberAdminState(key: string, signals: Record<string, WritableSignal<any>>): void {
  const store = inject(AdminSectionStateService);

  const saved = store.restore(key);
  if (saved) {
    for (const [name, sig] of Object.entries(signals)) {
      if (name in saved) sig.set(saved[name]);
    }
  }

  // Premier passage après la construction : il réécrit l'état restauré, tel quel.
  effect(() => {
    store.save(key, Object.fromEntries(
      Object.entries(signals).map(([name, sig]) => [name, sig()])));
  });
}
