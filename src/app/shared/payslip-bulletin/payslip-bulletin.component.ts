import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  DataTableComponent,
  MetricCardComponent,
  SearchToolbarComponent,
  SectionCardComponent,
  SectionTitleComponent,
  type BadgeVariant,
  type MetricDelta,
  type TableColumn,
  type TableConfig,
  type TableRow,
  type ToolbarAction,
} from '@khalilrebhiitec/daf360';
import type { RubriqueResultItem, RunPayrollResponse } from '../../core/payroll-engine.service';

/** Ce que le calcul coûte à l'entreprise : brut, cotisations PATRONALES, coût employeur. */
export interface EmployerCost {
  gross: number;
  charges: number;
  loadedCost: number;
  /** Calcul enregistré avant la correction du moteur : ses « charges patronales » sont la
   *  CNSS salariale — on ne les affiche pas, on invite à relancer le calcul. */
  legacy: boolean;
}

/**
 * Coût employeur d'un résultat du moteur, pour la section « Coût pour l'entreprise » du
 * bulletin. Avant le 26/10/2026 le moteur enregistrait la CNSS SALARIALE (strate 3) comme
 * charges patronales : un résultat dont les charges valent exactement sa strate 3 est un
 * calcul ancien (`legacy`). `null` quand le résultat ne porte pas ces montants.
 */
export function employerCostOf(r: RunPayrollResponse | null | undefined): EmployerCost | null {
  if (!r || r.aggregateEmployerCharges == null || r.loadedCost == null || r.aggregateGross == null) return null;
  const legacy = r.strate3 != null && r.aggregateEmployerCharges > 0
    && Math.abs(r.aggregateEmployerCharges - r.strate3) < 0.005;
  return { gross: r.aggregateGross, charges: r.aggregateEmployerCharges, loadedCost: r.loadedCost, legacy };
}
import { rubriqueLineLabel, rubriqueModeLabel } from '../rubrique-labels';
import { searchTableRows } from '../table-tools';

/** Les quatre montants du bulletin, lus sur les strates réelles du moteur par le parent. */
export interface PayslipTotals {
  gross: number;
  /** S3 — CNSS, part SALARIALE. */
  employeeCharges: number;
  /** S4 — IRPP. */
  irpp: number;
  /** S5 — net à payer. */
  net: number;
}

/** Écarts N-1 optionnels des quatre tuiles (`/payroll/engine-run` seulement). */
export interface PayslipDeltas {
  gross?: MetricDelta | null;
  employeeCharges?: MetricDelta | null;
  irpp?: MetricDelta | null;
  net?: MetricDelta | null;
}

/**
 * Bulletin de paie — le MÊME affichage sur `/payroll/engine-run` (le calcul qui vient
 * d'être lancé) et `/payroll/engine-results/:id?result=` (un résultat enregistré) :
 *
 *   4 indicateurs (Brut, CNSS, IRPP, Net) → recherche (+ actions du parent) →
 *   Gains + Total brut → Retenues + Total des retenues → Net à payer → « Où va le brut ? »
 *
 * Rubriques réelles du moteur (vérifié en base le 2026-10-22, pays 179) :
 *   S1 SALAIRE_BASE (GAIN) · S2 PRIME_TRANSPORT (AVANTAGE) · S3 CNSS_EE (RETENUE)
 *   S4 IRPP (RETENUE) · S5 NET_A_PAYER (GAIN, mode FORMULE)
 * La strate 5 est le NET, pas un gain : elle sort des blocs et devient la ligne finale.
 *
 * Pas de tuile « coût employeur » : `aggregate_employer_charges` contient la CNSS
 * SALARIALE (= strate 3), pas les charges patronales.
 */
@Component({
  selector: 'app-payslip-bulletin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    DataTableComponent, MetricCardComponent, SearchToolbarComponent, SectionCardComponent, SectionTitleComponent,
  ],
  templateUrl: './payslip-bulletin.component.html',
  styleUrl: './payslip-bulletin.component.scss',
})
export class PayslipBulletinComponent {
  private readonly translate = inject(TranslateService);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  /** Lignes du calcul, telles que le moteur les renvoie. */
  readonly details = input.required<RubriqueResultItem[]>();
  readonly totals  = input.required<PayslipTotals>();
  /** Code ISO 4217 du pays du calcul ; `null` → montants sans devise. */
  readonly currency = input<string | null>(null);
  /** Jours travaillés du calcul, quand on les connaît : en dessous d'un mois complet, les
   *  lignes proratisées le disent. */
  readonly prorataDays = input<number | null>(null);
  readonly deltas = input<PayslipDeltas>({});
  /** Actions à droite de la barre de recherche (exports…), émises par `toolbarAction`. */
  readonly toolbarActions = input<ToolbarAction[]>([]);
  readonly toolbarAction  = output<string>();
  /** Recherche, commune aux deux blocs — insensible à la casse et aux accents, code compris. */
  readonly search = model('');
  /** Coût pour l'entreprise (sous le net à payer) — voir {@link employerCostOf}. `null` :
   *  section masquée. */
  readonly employerCost = input<EmployerCost | null>(null);

  /** Coût employeur annuel (× 12), sous le total. */
  readonly employerCostAnnual = computed(() => {
    const c = this.employerCost();
    return c && !c.legacy ? this.t('PAYROLL.ENGINE_RUN.COST_PER_YEAR', { amount: this.money(c.loadedCost * 12) }) : '';
  });

  /** Mois complet de référence — la valeur par défaut des jours travaillés. */
  static readonly FULL_MONTH_DAYS = 22;
  /** Strate du net à payer. */
  private static readonly NET_STRATE = 5;

  private get locale(): string {
    return this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
  }

  /** Montant formaté, dans la devise quand on la connaît. */
  money(v: number | null | undefined): string {
    if (v == null) return '';
    const currency = this.currency();
    return new Intl.NumberFormat(this.locale, {
      ...(currency ? { style: 'currency', currency } : {}),
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(v);
  }

  // ── Lignes du bulletin ──────────────────────────────────────────────────────

  private natureVariant(nature: string): BadgeVariant {
    switch (nature) {
      case 'RETENUE':   return 'danger';
      case 'AVANTAGE':  return 'info';
      case 'INDEMNITE': return 'secondary';
      case 'PRIME':     return 'success';
      default:          return 'neutral';
    }
  }

  private natureLabel(nature: string): string {
    const key = `PAYROLL.ENGINE_RUN.NATURE.${nature}`;
    const label = this.t(key);
    return label === key ? nature : label;
  }

  /** Montant de colonne : en devise quand on la connaît (`type: 'currency'` de la lib), sinon nombre. */
  private moneyColumn(): Pick<TableColumn, 'type' | 'format'> {
    const digits = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    const currency = this.currency();
    return currency
      ? { type: 'currency', format: { currency, ...digits } }
      : { type: 'number', format: digits };
  }

  /**
   * Colonnes des deux tableaux — ligne, nature, base de calcul, montant. Pas de tri : un
   * bulletin se lit dans son ordre. Code, strate et mode de calcul restent dans la
   * recherche (et dans les exports des pages).
   */
  readonly columns = computed<TableColumn[]>(() => {
    const money = this.moneyColumn();
    return [
      { key: 'label',  label: this.t('PAYROLL.ENGINE_RUN.COL_LINE') },
      { key: 'nature', label: this.t('PAYROLL.ENGINE_RUN.COL_NATURE'), type: 'badge', width: '140px' },
      // Texte déjà formaté : « — » quand la ligne n'a pas de base (le serveur envoie alors 0).
      { key: 'base',   label: this.t('PAYROLL.ENGINE_RUN.COL_BASE'), align: 'right', width: '170px' },
      // Retenues en négatif ; `signColor` de la lib les colore.
      { key: 'amount', label: this.t('PAYROLL.ENGINE_RUN.COL_AMOUNT'), ...money, align: 'right', width: '170px',
        format: { ...money.format, signColor: true } },
    ];
  });

  /** Colonnes de la recherche : le détail complet, code compris. */
  private readonly searchColumns = computed<TableColumn[]>(() => [
    { key: 'code',   label: this.t('PAYROLL.ENGINE_RUN.COL_CODE') },
    { key: 'label',  label: this.t('PAYROLL.ENGINE_RUN.COL_LINE') },
    { key: 'nature', label: this.t('PAYROLL.ENGINE_RUN.COL_NATURE') },
    { key: 'mode',   label: this.t('PAYROLL.ENGINE_RUN.COL_MODE') },
  ]);

  /** Toutes les lignes du calcul, dans l'ordre du bulletin (strate puis ordre du moteur). */
  private readonly lines = computed<TableRow[]>(() => {
    const days = this.prorataDays();
    const full = PayslipBulletinComponent.FULL_MONTH_DAYS;
    const partialMonth = days != null && days < full;
    return this.details()
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (a.r.strate - b.r.strate) || (a.i - b.i))
      .map(({ r }) => {
        const debit = r.nature === 'RETENUE';
        const label = rubriqueLineLabel(r, this.translate);
        return {
          id:      r.rubriqueCode,
          code:    r.rubriqueCode,
          // Mois incomplet : les lignes proratisées par le moteur le disent.
          label:   partialMonth && r.prorataApplied
            ? `${label} · ${this.t('PAYROLL.ENGINE_RUN.PRORATA', { days, full })}`
            : label,
          _strate: r.strate,
          _debit:  debit,
          nature:  { label: this.natureLabel(r.nature), options: { variant: this.natureVariant(r.nature), size: 'sm' as const } },
          base:    r.assiette ? this.money(r.assiette) : '—',
          amount:  debit ? -Math.abs(r.amount) : r.amount,
          mode:    rubriqueModeLabel(r.modeCalcul, this.translate),
        };
      });
  });

  private isGain(row: TableRow): boolean {
    return !row['_debit'] && (row['_strate'] as number) < PayslipBulletinComponent.NET_STRATE;
  }

  /** Lignes après la recherche. */
  private readonly searchedLines = computed<TableRow[]>(() =>
    searchTableRows(this.lines(), this.searchColumns(), this.search()));

  /** Codes des lignes retenues par la recherche, dans l'ordre du bulletin — ce que les
   *  pages envoient à leurs exports. */
  readonly searchedCodes = computed(() => this.searchedLines().map(row => row['code'] as string));

  readonly gainRows      = computed(() => this.searchedLines().filter(row => this.isGain(row)));
  readonly deductionRows = computed(() => this.searchedLines().filter(row => !!row['_debit']));

  /** Sous-totaux sur TOUTES les lignes (la recherche ne change pas le bulletin). */
  readonly subtotals = computed(() => {
    const lines = this.lines();
    const sum = (rows: TableRow[]) => rows.reduce((s, row) => s + Math.abs(row['amount'] as number), 0);
    return {
      gains:      sum(lines.filter(row => this.isGain(row))),
      deductions: sum(lines.filter(row => !!row['_debit'])),
    };
  });

  readonly tableConfig = computed<TableConfig>(() => ({
    emptyMessage: this.t('PAYROLL.ENGINE_RUN.EMPTY_RUBRIQUES'),
    hoverable: true,
    rowId: row => row['id'] as string,
  }));

  // ── « Où va le brut ? » — une barre : net versé, CNSS salariale, IRPP ─────────────

  readonly grossSplit = computed(() => {
    const k = this.totals();
    if (!k.gross) return [];
    const pctFmt = new Intl.NumberFormat(this.locale, { maximumFractionDigits: 1 });
    return [
      { key: 'net',  label: this.t('PAYROLL.ENGINE_RUN.SPLIT_NET'),               amount: k.net,             cls: 'split__seg--net' },
      { key: 'cnss', label: this.t('PAYROLL.ENGINE_RUN.KPI_DEDUCTIONS_EMPLOYEE'), amount: k.employeeCharges, cls: 'split__seg--cnss' },
      { key: 'irpp', label: this.t('PAYROLL.ENGINE_RUN.KPI_DEDUCTIONS_IRPP'),     amount: k.irpp,            cls: 'split__seg--irpp' },
    ]
      .filter(s => s.amount > 0.005)
      .map(s => {
        const pct = (s.amount / k.gross) * 100;
        return { ...s, pct, pctText: `${pctFmt.format(pct)} %`, amountText: this.money(s.amount) };
      });
  });
}
