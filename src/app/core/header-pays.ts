import { Signal, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectSelectedCountryIds } from '@khalilrebhiitec/daf360';

/**
 * Les drapeaux cochés dans la barre (store partagé avec le shell), en `pays_id` triés et
 * séparés par des virgules (`179,53`). Ce sont les ids du RH — les mêmes que la paie.
 * `undefined` = « Tous les pays ».
 *
 * Texte trié : deux sélections identiques donnent la même valeur, donc un `effect` qui la
 * compare au dernier chargement ne recharge que sur un vrai changement de drapeaux.
 * À appeler dans un contexte d'injection.
 */
export function injectHeaderPays(): Signal<string | undefined> {
  const ids = inject(Store).selectSignal(selectSelectedCountryIds);
  return computed(() => {
    const list = [...new Set(ids().map(Number).filter(id => Number.isInteger(id) && id > 0))]
      .sort((a, b) => a - b);
    return list.length ? list.join(',') : undefined;
  });
}

/** Cet élément est-il d'un des pays cochés (`179,53`) ? Sans drapeau, tout passe. */
export function inHeaderPays(pays: string | undefined, paysId: number | null | undefined): boolean {
  if (!pays) return true;
  return paysId != null && pays.split(',').includes(String(paysId));
}

/**
 * L'entité UNIQUE d'un écran qui ne travaille que sur un pays à la fois, tirée des drapeaux
 * — même règle que /rh/admin : un drapeau → ce pays ; aucun → `own` (le pays de
 * l'utilisateur) ; plusieurs → `own` s'il est coché, sinon le premier coché.
 * `null` = pas encore connu.
 */
export function flagEntity(pays: string | undefined, own: number | null | undefined): number | null {
  const ids = (pays ?? '').split(',').map(Number).filter(id => Number.isInteger(id) && id > 0);
  if (ids.length === 1) return ids[0];
  if (!ids.length || (own != null && ids.includes(own))) return own ?? null;
  return ids[0];
}
