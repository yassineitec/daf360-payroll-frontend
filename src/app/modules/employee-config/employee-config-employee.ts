import type { EmployeeListItem } from '../../core/hr-profile.service';

/**
 * Fiche du collaborateur ouvert depuis la liste `/payroll/employee-config`, gardée en
 * `sessionStorage` pour que la page détail affiche son nom sans nouvel appel RH — même
 * relais que `engine-results-employee.ts` (le service RH n'expose pas de lecture par
 * `userId`). Un lien ouvert dans un autre onglet tombe sur un libellé générique ; la
 * configuration elle-même ne dépend que de l'id de l'URL.
 */
const KEY = 'payroll.employee-config.employee';

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
