import type { EmployeeListItem } from '../../core/hr-profile.service';

/**
 * Fiche du collaborateur ouvert depuis la liste `/payroll/engine-results`, gardée en
 * `sessionStorage` pour que la page détail affiche son bandeau d'identité sans nouvel
 * appel RH — et encore après un rafraîchissement. Le service RH n'expose pas de lecture
 * par `userId` (seulement par `profileId`), d'où ce relais plutôt qu'une requête.
 * Un lien ouvert dans un autre onglet n'a pas la fiche : la page tombe alors sur un
 * libellé générique, l'historique lui-même ne dépend que de l'id de l'URL.
 */
const KEY = 'payroll.engine-results.employee';

export function rememberEmployee(e: EmployeeListItem): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(e)); } catch { /* stockage indisponible */ }
}

export function recallEmployee(userId: number): EmployeeListItem | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const e = raw ? (JSON.parse(raw) as EmployeeListItem) : null;
    return e?.userId === userId ? e : null;
  } catch {
    return null;
  }
}
