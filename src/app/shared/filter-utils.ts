import type { FilterResult } from '@khalilrebhiitec/daf360';

/**
 * Petits utilitaires partagés par les boutons « Filtrer » (`daf-filter`) de la paie,
 * pour les filtres appliqués côté client sur une liste déjà chargée en mémoire.
 */

/** Première valeur d'un `select` appliqué (`string | null`, ou `string[]` en amorçage). */
export function pickValue(result: FilterResult, name: string): string | null {
  const v = result[name];
  return ((Array.isArray(v) ? v[0] : v) as string | null | undefined) || null;
}

/** Bornes d'un `daterange` appliqué, en `YYYY-MM-DD`, toutes deux incluses. */
export function dayRange(value: unknown): [string | null, string | null] {
  const days = (Array.isArray(value) ? value : [value])
    .filter((d): d is Date => d instanceof Date)
    .map(isoDay)
    .sort();
  return [days[0] ?? null, days[days.length - 1] ?? null];
}

/** Le jour d'un horodatage ISO tombe-t-il dans [from, to] ? Sans borne → pas de contrainte ;
 *  sans date → exclu dès qu'une borne est posée. */
export function inDayRange(iso: string | null | undefined, [from, to]: [string | null, string | null]): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  const day = iso.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}

/** Valeur d'amorçage (`initialValues`) d'un `daterange` : la plage telle qu'appliquée. */
export function rangeSeed(value: unknown): Date[] | null {
  return Array.isArray(value) && value.length ? value as Date[] : null;
}

/** Nom du mois (1–12) dans la langue courante, capitalisé : « Janvier », « March ». */
export function monthName(month: number, lang: string): string {
  const name = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'fr-FR', { month: 'long' })
    .format(new Date(2000, month - 1, 1));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Valeurs distinctes, sans `null`/vide, triées. */
export function distinctSorted<T extends string | number>(values: (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((v): v is T => v != null && v !== ''))]
    .sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))));
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
