import { Injectable, signal } from '@angular/core';
import { PayslipBatchResult, PayslipPageResult } from '../../core/payslip-batch.service';

export const MONTH_KEYS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

/** localStorage key of the recent-imports log — same key as before the list/new split, so
 *  the batches already processed from this browser stay listed. */
const HISTORY_KEY = 'daf360.payroll.payslips.history';
const HISTORY_MAX = 20;

/** One processed batch, as kept in the recent-imports log. */
export interface PayslipHistoryEntry {
  id: string;
  processedAt: string;   // ISO
  paysId: number;
  paysLabel: string;
  paysIso: string;
  periodYear: number;
  periodMonth: number;
  fileName: string;
  result: PayslipBatchResult;
}

/** Clé de période triable `YYYY-MM` — valeur des filtres « Période ». */
export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Page reconnue (SUCCESS) mais sans lien SharePoint : chemin non configuré pour le pays,
 *  dossier du collaborateur ambigu ou dépôt en échec — la fiche n'a PAS été distribuée. */
export function isNotFiled(d: PayslipPageResult): boolean {
  return d.status === 'SUCCESS' && !d.sharePointUrl;
}

/** Comptes d'un lot tels que la page les affiche : « distribuées » = déposées sur
 *  SharePoint, « à corriger » = tout le reste (non identifiées, erreurs, doublons,
 *  non déposées). */
export function batchCounts(r: PayslipBatchResult) {
  const notFiled = r.details.filter(isNotFiled).length;
  const filed = r.details.filter(d => d.status === 'SUCCESS' && !!d.sharePointUrl).length;
  return {
    total: r.totalPages,
    filed,
    notFiled,
    unidentified: r.unidentifiedCount,
    errors: r.errorCount,
    duplicates: r.duplicateCount,
    toFix: r.totalPages - filed,
  };
}

/**
 * Journal des lots traités — partagé par la liste (`/payroll/payslips`) et l'écran
 * d'import / rapport (`/payroll/payslips/:id`).
 *
 * daf360-rh-service ne garde aucun historique des lots : le journal vit dans CE navigateur
 * (les {@link HISTORY_MAX} derniers lots, rapport page par page compris). Suffisant pour
 * rouvrir un rapport après un rechargement, pas une piste d'audit partagée.
 */
@Injectable({ providedIn: 'root' })
export class PayslipHistoryStore {
  private readonly _entries = signal<PayslipHistoryEntry[]>(this.read());
  readonly entries = this._entries.asReadonly();

  find(id: string | null): PayslipHistoryEntry | null {
    return id ? this._entries().find(h => h.id === id) ?? null : null;
  }

  /** Dernier lot déjà traité pour ce pays et ce mois, depuis ce navigateur. */
  findPeriod(paysId: number, year: number, month: number): PayslipHistoryEntry | null {
    return this._entries().find(h => h.paysId === paysId && h.periodYear === year && h.periodMonth === month) ?? null;
  }

  add(entry: Omit<PayslipHistoryEntry, 'id' | 'processedAt'>): PayslipHistoryEntry {
    const full: PayslipHistoryEntry = { ...entry, id: `${Date.now()}`, processedAt: new Date().toISOString() };
    const next = [full, ...this._entries()].slice(0, HISTORY_MAX);
    this._entries.set(next);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* quota / private mode */ }
    return full;
  }

  private read(): PayslipHistoryEntry[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
