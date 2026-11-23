import type { AuditEntryDto } from '../../../core/payroll-api.service';

/**
 * Makes the GENERIC source (raw trigger-based audit_trail rows) of the payroll change log
 * readable, without a further backend change: EMPLOYEE_CONFIG/SALARY_ADVANCE rows already carry
 * curated text and are never touched by anything in this file. Same pattern as
 * daf360-facturation-frontend's audit-trail-display.util.ts -- ported, not reinvented.
 */

const TABLE_LABELS: Record<string, string> = {
  benefits_catalogue: 'Catalogue des avantages',
  calibration_cycles: 'Cycles de calibration',
  calibration_variances: 'Écarts de calibration',
  cohort_definitions: 'Définitions de cohortes',
  employee_payroll_bonus: 'Primes collaborateurs',
  employee_payroll_config_history: 'Historique configuration paie',
  parameter_sets: 'Jeux de paramètres',
  payroll_budget_lines: 'Lignes budgétaires paie',
  payroll_calculation_sequences: 'Séquences de calcul',
  payroll_calibration_imports: 'Imports de calibration',
  payroll_calibration_lines: 'Lignes de calibration',
  payroll_countries: 'Pays de paie',
  payroll_forecast_outputs: 'Résultats de prévision',
  payroll_forex_snapshots: 'Instantanés de change',
  payroll_parameter_sets: 'Jeux de paramètres paie',
  payroll_precision_kpi_history: 'Historique précision KPI',
  payroll_results: 'Résultats de paie',
  payroll_rubriques: 'Rubriques de paie',
  payroll_rubriques_legacy: 'Rubriques de paie (ancien)',
  pays_ref: 'Référentiel pays',
  simulation_results: 'Résultats de simulation',
  social_charge_rates: 'Taux de charges sociales',
  users_ref: 'Utilisateurs',
};

export function tableLabel(tableName: string): string {
  return TABLE_LABELS[tableName] ?? humanizeTableName(tableName);
}

/** Which functional area a table belongs to -- coarser and more useful at a glance than the
 *  table name itself. Anything not listed falls back to 'Autre' rather than guessing. Same
 *  pattern as daf360-facturation-frontend's audit-trail-display.util.ts `tableDomain` -- no
 *  per-row country here (unlike Facturation's per-row Affaire): this screen is already scoped
 *  to one country at a time via the page's own Pays selector, so every visible row already
 *  shares the same country and a column repeating it would add nothing. */
export type FunctionalDomain = 'Paie' | 'Calibration' | 'Prévisions' | 'Paramétrage' | 'Référentiel' | 'Autre';

const TABLE_DOMAINS: Record<string, FunctionalDomain> = {
  payroll_results: 'Paie', payroll_calculation_sequences: 'Paie', payroll_rubriques: 'Paie',
  payroll_rubriques_legacy: 'Paie', social_charge_rates: 'Paie',
  employee_payroll_config_history: 'Paie', employee_payroll_bonus: 'Paie',

  calibration_cycles: 'Calibration', calibration_variances: 'Calibration',
  cohort_definitions: 'Calibration', payroll_calibration_imports: 'Calibration',
  payroll_calibration_lines: 'Calibration', payroll_precision_kpi_history: 'Calibration',

  payroll_forecast_outputs: 'Prévisions', simulation_results: 'Prévisions',

  parameter_sets: 'Paramétrage', payroll_parameter_sets: 'Paramétrage',
  payroll_budget_lines: 'Paramétrage', benefits_catalogue: 'Paramétrage',

  payroll_countries: 'Référentiel', pays_ref: 'Référentiel', users_ref: 'Référentiel',
  payroll_forex_snapshots: 'Référentiel',
};

export function tableDomain(tableName: string): FunctionalDomain {
  return TABLE_DOMAINS[tableName] ?? 'Autre';
}

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'secondary' | 'neutral' | 'teal';

/** INSERT/UPDATE/DELETE -> the same create/update/delete colour convention as version control
 *  and every other audit log: green = something new exists, blue = changed in place, red = gone.
 *  Reserved to the Action column -- Domain deliberately avoids these three (see domainVariant). */
export function actionVariant(action: string): BadgeVariant {
  return action === 'INSERT' ? 'success' : action === 'DELETE' ? 'danger' : 'info';
}

/** One colour family per functional area. Same grouping logic as Facturation's domainVariant:
 *  the pay-run engine itself (primary), the calibration/forecast cycle around it (teal/secondary),
 *  everything else support/reference (neutral). */
const DOMAIN_VARIANTS: Record<FunctionalDomain, BadgeVariant> = {
  'Paie': 'primary',
  'Calibration': 'teal',
  'Prévisions': 'secondary',
  'Paramétrage': 'neutral',
  'Référentiel': 'neutral',
  'Autre': 'neutral',
};

export function domainVariant(domain: FunctionalDomain): BadgeVariant {
  return DOMAIN_VARIANTS[domain];
}

function humanizeTableName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\p{L}/gu, c => c.toUpperCase());
}

const IDENTITY_FIELD_CANDIDATES = [
  'reference', 'numero', 'number', 'code',
  'email', 'username', 'nom', 'name', 'libelle', 'label', 'intitule', 'titre', 'title',
];

function safeParse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Payroll's DTO has no separate pkJson field for GENERIC rows -- the server only exposes it
 *  folded into `subjectName` as `"<table_name> <pk_json>"`. Recovering it here (rather than
 *  widening the backend further) by stripping the known table-name prefix back off. */
function recoverPkJson(tableName: string, subjectName: string | null): string {
  if (!subjectName) return '';
  const prefix = `${tableName} `;
  return subjectName.startsWith(prefix) ? subjectName.slice(prefix.length) : subjectName;
}

function formatPk(pkJson: string): string {
  const pk = safeParse(pkJson);
  if (!pk) return pkJson;
  return Object.entries(pk).map(([k, v]) => `${k} = ${v}`).join(', ');
}

/** GENERIC rows only: a meaningful field from the row's own JSON when one exists, else the
 *  formatted primary key -- never the raw "<table> {"id":123}" string the API returns. */
export function recordIdentity(entry: Pick<AuditEntryDto, 'detail' | 'subjectName' | 'oldValue' | 'newValue'>): string {
  const row = safeParse(entry.newValue) ?? safeParse(entry.oldValue);
  if (row) {
    for (const key of IDENTITY_FIELD_CANDIDATES) {
      const value = row[key];
      if (value !== null && value !== undefined && String(value).trim() !== '') return String(value);
    }
  }
  return formatPk(recoverPkJson(entry.detail ?? '', entry.subjectName));
}

export interface FieldDiff {
  field: string;
  before: string;
  after: string;
  changed: boolean;
}

const NO_VALUE = '—';

/** A field ending in `_by` is this platform's actor-reference convention (`changed_by`,
 *  `created_by`, `emitted_by`...) -- its value is a users_ref id, not something meant to be
 *  read as a bare number. Same heuristic used in daf360-rh-frontend / daf360-facturation-frontend. */
function isActorRefField(field: string): boolean {
  return /_by$/i.test(field);
}

function toUserId(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

/** Every users_ref id referenced by an `_by` field in this row's before/after JSON -- what the
 *  caller needs to resolve before rendering the diff, collected once per distinct id. */
export function extractActorRefIds(entry: Pick<AuditEntryDto, 'oldValue' | 'newValue'>): number[] {
  const ids = new Set<number>();
  for (const json of [entry.oldValue, entry.newValue]) {
    const row = safeParse(json);
    if (!row) continue;
    for (const [field, value] of Object.entries(row)) {
      if (!isActorRefField(field)) continue;
      const id = toUserId(value);
      if (id !== null) ids.add(id);
    }
  }
  return [...ids];
}

function display(value: unknown): string {
  if (value === null || value === undefined) return NO_VALUE;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** `userNames` resolves an `_by` field's raw id to a person -- see `extractActorRefIds`. Missing
 *  from the map (not yet resolved, or no such user) falls back to the bare id rather than
 *  blocking the rest of the diff. */
function displayField(field: string, value: unknown, present: boolean, userNames: Record<number, string>): string {
  if (!present) return NO_VALUE;
  if (isActorRefField(field)) {
    const id = toUserId(value);
    if (id !== null) {
      const name = userNames[id];
      return name ? `${name} (#${id})` : `#${id}`;
    }
  }
  return display(value);
}

export function computeFieldDiffs(
  entry: Pick<AuditEntryDto, 'oldValue' | 'newValue'>,
  userNames: Record<number, string> = {},
): FieldDiff[] {
  const before = safeParse(entry.oldValue) ?? {};
  const after = safeParse(entry.newValue) ?? {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  return keys.map(field => {
    const b = before[field];
    const a = after[field];
    return {
      field,
      before: displayField(field, b, field in before, userNames),
      after: displayField(field, a, field in after, userNames),
      changed: JSON.stringify(b) !== JSON.stringify(a),
    };
  });
}

export interface SingleRow { kind: 'single'; entry: AuditEntryDto }
export interface GroupRow { kind: 'group'; members: AuditEntryDto[]; detail: string; action: string; at: string }
export type DisplayEntry = SingleRow | GroupRow;

const BATCH_WINDOW_MS = 2000;
const MIN_BATCH_SIZE = 3;

/** Collapses consecutive GENERIC, actor-less entries (a scheduled job writing many rows at
 *  once) that share the same table (`detail`) + action within a tight time window into one
 *  summary row. EMPLOYEE_CONFIG/SALARY_ADVANCE rows, and any GENERIC row with a real actor, are
 *  always passed through as singles -- a human's own changes are never hidden. `entries` must
 *  already be sorted newest-first (the API's own order, preserved here). */
export function groupGenericBursts(entries: AuditEntryDto[]): DisplayEntry[] {
  const out: DisplayEntry[] = [];
  let i = 0;
  while (i < entries.length) {
    const start = entries[i];
    let j = i + 1;
    if (start.source === 'GENERIC' && start.actorName === null) {
      while (
        j < entries.length &&
        entries[j].source === 'GENERIC' &&
        entries[j].detail === start.detail &&
        entries[j].action === start.action &&
        entries[j].actorName === null &&
        Math.abs(new Date(entries[j - 1].at).getTime() - new Date(entries[j].at).getTime()) <= BATCH_WINDOW_MS
      ) {
        j++;
      }
    }
    const size = j - i;
    if (size >= MIN_BATCH_SIZE) {
      out.push({ kind: 'group', members: entries.slice(i, j), detail: start.detail ?? '', action: start.action, at: start.at });
    } else {
      for (let k = i; k < j; k++) out.push({ kind: 'single', entry: entries[k] });
    }
    i = j;
  }
  return out;
}
