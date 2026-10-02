import { TranslateService } from '@ngx-translate/core';
import { SortDirection, SortValue, TableColumn, TableConfig, TableRow } from '@khalilrebhiitec/daf360';

/** Tri d'en-tête de tableau tel qu'une page le garde — `null` = ordre d'origine. */
export interface TableSort {
  key: string;
  dir: 'asc' | 'desc';
}

/** `sortChange` de `daf-data-table` → `TableSort`, ou `null` quand le tri est retiré. */
export function toTableSort(event: { key: string; dir: SortDirection } | null): TableSort | null {
  return event?.key && event.dir ? { key: event.key, dir: event.dir } : null;
}


/**
 * Outils de tableau de la lib, les mêmes sur toutes les listes de la paie (calqués
 * sur `/finance/affaires` de la facturation) : colonnes et lignes redimensionnables, choix des colonnes,
 * bouton de réinitialisation et identité stable des lignes (hauteurs et tri s'attachent à
 * `row.id`, pas à l'index d'affichage).
 *
 * À appeler dans un `computed` : la langue courante est lue ici, les libellés suivent
 * donc la langue.
 */
export function tableTools(
  translate: TranslateService,
  /** Champ de la ligne qui l'identifie — `id` par défaut, `candidateId`, `resultId`… ailleurs. */
  idKey = 'id',
): Pick<TableConfig,
  'rowId' | 'resizableColumns' | 'resizableRows' | 'columnPicker' | 'columnPickerLabel'
  | 'showReset' | 'resetLabel' | 'sortLabel'> {
  // Lu ici : la config qui étale ces outils suit la langue même sans le lire elle-même.
  translate.currentLang();
  const t = (key: string) => translate.instant(key);
  return {
    rowId:             (row: TableRow) => row[idKey] as string | number,
    resizableColumns:  true,
    resizableRows:     true,
    columnPicker:      true,
    columnPickerLabel: t('PAYROLL.COMMON.TABLE.COLUMN_PICKER'),
    showReset:         true,
    resetLabel:        t('PAYROLL.COMMON.TABLE.RESET'),
    sortLabel:         t('PAYROLL.COMMON.TABLE.SORT_BY'),
  };
}

/**
 * Trie un jeu de lignes **complet** avant sa pagination côté client. La lib ne trie que
 * les lignes qu'on lui passe : paginer d'abord puis la laisser trier ne réordonnerait
 * que la page visible. La page trie donc elle-même ici et passe `manualSort: true`.
 *
 * Même valeur de tri que la lib : `sortAccessor` s'il existe, sinon la cellule brute
 * (`.name` d'un avatar, `.label` d'une pastille). Les valeurs vides vont en fin de liste.
 */
export function sortTableRows<T extends TableRow>(rows: T[], columns: TableColumn[], sort: TableSort | null): T[] {
  const col = sort ? columns.find(c => c.key === sort.key) : undefined;
  if (!sort || !col) return rows;
  const value = (row: T): SortValue => {
    if (col.sortAccessor) return col.sortAccessor(row);
    const v = row[col.key];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const o = v as { name?: string; label?: string };
      return o.name ?? o.label ?? null;
    }
    return v as SortValue;
  };
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = value(a), bv = value(b);
    const aEmpty = av == null || av === '', bEmpty = bv == null || bv === '';
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    if (av instanceof Date && bv instanceof Date) return (av.getTime() - bv.getTime()) * sign;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * sign;
  });
}

/**
 * Tri délégué (serveur ou page) : la lib ne réordonne pas les lignes reçues mais émet
 * toujours `sortChange`, et `defaultSort` redonne la flèche quand le tableau est recréé
 * (aller-retour cartes ↔ liste). `seed` doit être lu en `untracked` par l'appelant — le
 * suivre reconstruirait la config à chaque clic d'en-tête.
 */
export function delegatedSort(seed: TableSort | null): Pick<TableConfig, 'manualSort' | 'defaultSort'> {
  return { manualSort: true, ...(seed ? { defaultSort: seed } : {}) };
}
