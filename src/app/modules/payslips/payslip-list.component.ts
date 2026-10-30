import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent,
  DafCellDirective,
  DataTableComponent,
  EntityCardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  SearchToolbarComponent,
  type BadgeCell,
  type EntityCardOptions,
  type FilterField,
  type FilterResult,
  type MetricCardOptions,
  type MetricDelta,
  type SearchToolbarFilterConfig,
  type TableColumn,
  type TableConfig,
  type TableRow,
  type ToolbarToggleOption,
} from '@khalilrebhiitec/daf360';
import { PaysNamesService } from '../../core/pays-names.service';
import { dayRange, distinctSorted, inDayRange, pickValue, rangeSeed } from '../../shared/filter-utils';
import { searchTableRows, tableTools } from '../../shared/table-tools';
import { MONTH_KEYS, PayslipHistoryEntry, PayslipHistoryStore, batchCounts, periodKey } from './payslip-history';

type StatusFilter = 'ALL' | 'SUCCESS' | 'PARTIAL';

/**
 * `/payroll/payslips` — historique des lots de fiches de paie distribués, même squelette
 * que la liste du simulateur : en-tête avec l'action « Distribuer des fiches de paie »
 * (teal), 4 KPI, barre de recherche + filtres + bascule cartes / tableau, puis les lots.
 * Un clic sur un lot rouvre son rapport (`/payroll/payslips/:id`).
 *
 * Le journal vient de {@link PayslipHistoryStore} (ce navigateur seulement) : tout est
 * filtré et trié localement, 20 lots au plus — pas de pagination.
 */
@Component({
  selector: 'app-payslip-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    ButtonComponent, DafCellDirective, DataTableComponent, EntityCardComponent, MetricCardComponent,
    PageComponent, PageHeaderComponent, SearchToolbarComponent,
  ],
  templateUrl: './payslip-list.component.html',
  styleUrl: './payslip-batch.component.scss',
})
export class PayslipListComponent {
  private readonly router    = inject(Router);
  private readonly route     = inject(ActivatedRoute);
  private readonly store     = inject(PayslipHistoryStore);
  private readonly paysNames = inject(PaysNamesService);
  protected readonly translate = inject(TranslateService);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  private numberLocale(): string {
    return this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR';
  }

  readonly history = this.store.entries;

  private periodLabel(year: number, month: number): string {
    return `${this.t(`PAYROLL.PAYSLIPS.MONTHS.${MONTH_KEYS[month - 1]}`)} ${year}`;
  }

  private paysName(h: PayslipHistoryEntry): string {
    return this.paysNames.name(h.paysId, h.paysLabel || h.paysIso);
  }

  /** Dernier lot de chaque pays + mois — l'historique est déjà du plus récent au plus
   *  ancien. Les KPI « à corriger » ne comptent que lui : relancer un mois corrigé ne
   *  doit pas laisser traîner les anomalies du lot précédent. */
  private readonly latestPerPeriod = computed(() => {
    const seen = new Set<string>();
    return this.history().filter(h => {
      const key = `${h.paysId}|${periodKey(h.periodYear, h.periodMonth)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  // ── KPI ────────────────────────────────────────────────────────────────────
  readonly kpiBatches = computed(() => String(this.history().length));
  readonly kpiBatchesOptions = computed((): MetricCardOptions => ({
    icon: 'inventory_2', iconBg: 'bg-primary/10', iconColor: 'text-primary',
    help: this.t('PAYROLL.PAYSLIPS.LIST.KPI.BATCHES_HELP'),
    // Dernière tuile de la rangée : l'aide s'ouvre vers le haut (pas de débordement).
    helpPlacement: 'top',
  }));

  private readonly filedTotals = computed(() => this.latestPerPeriod().reduce(
    (acc, h) => { const c = batchCounts(h.result); return { filed: acc.filed + c.filed, toFix: acc.toFix + c.toFix, total: acc.total + c.total }; },
    { filed: 0, toFix: 0, total: 0 }));

  readonly kpiFiled = computed(() => String(this.filedTotals().filed));
  /** « sur 41 pages · 66 % » — la proportion distribuée, sans calcul à faire. */
  readonly kpiFiledDelta = computed((): MetricDelta | null => {
    const { filed, total } = this.filedTotals();
    if (!total) return null;
    const pct = new Intl.NumberFormat(this.numberLocale(), { maximumFractionDigits: 0 }).format(filed / total * 100);
    return { value: this.t('PAYROLL.PAYSLIPS.LIST.KPI.FILED_DELTA', { total, pct }), direction: 'neutral' };
  });
  readonly kpiFiledOptions = computed((): MetricCardOptions => ({
    icon: 'cloud_done', iconBg: 'bg-secondary/10', iconColor: 'text-secondary', valueColor: 'text-secondary',
    help: this.t('PAYROLL.PAYSLIPS.LIST.KPI.FILED_HELP'),
  }));

  readonly kpiToFix = computed(() => String(this.filedTotals().toFix));
  readonly kpiToFixDelta = computed((): MetricDelta | null => {
    const n = this.latestPerPeriod().filter(h => batchCounts(h.result).toFix > 0).length;
    return n ? { value: this.t('PAYROLL.PAYSLIPS.LIST.KPI.TO_FIX_DELTA', { count: n }), direction: 'neutral' } : null;
  });
  readonly kpiToFixOptions = computed((): MetricCardOptions => {
    const n = this.filedTotals().toFix;
    return {
      icon: n ? 'warning' : 'task_alt',
      iconColor: n ? 'text-warning' : 'text-success',
      iconBg: n ? 'bg-warning/10' : 'bg-success/10',
      valueColor: n ? 'text-warning' : undefined,
      help: this.t('PAYROLL.PAYSLIPS.LIST.KPI.TO_FIX_HELP'),
    };
  });

  private readonly lastPeriod = computed(() => {
    const sorted = [...this.history()].sort((a, b) =>
      periodKey(b.periodYear, b.periodMonth).localeCompare(periodKey(a.periodYear, a.periodMonth)));
    return sorted[0] ?? null;
  });
  readonly kpiLastPeriod = computed(() => {
    const h = this.lastPeriod();
    return h ? this.periodLabel(h.periodYear, h.periodMonth) : '—';
  });
  readonly kpiLastPeriodDelta = computed((): MetricDelta | null => {
    const h = this.lastPeriod();
    return h ? { value: this.paysName(h), direction: 'neutral' } : null;
  });
  readonly kpiLastPeriodOptions = computed((): MetricCardOptions => ({
    icon: 'event', iconBg: 'bg-tertiary/10', iconColor: 'text-tertiary',
    help: this.t('PAYROLL.PAYSLIPS.LIST.KPI.LAST_PERIOD_HELP'),
  }));

  // ── Recherche, filtres, vue ────────────────────────────────────────────────
  readonly search          = signal('');
  readonly statusFilter    = signal<StatusFilter>('ALL');
  readonly paysFilter      = signal<number | null>(null);
  /** Période au format `YYYY-MM`. */
  readonly periodFilter    = signal<string | null>(null);
  /** Plage « Date de traitement » telle qu'émise par le panneau (`Date[]`). */
  readonly processedFilter = signal<Date[] | null>(null);

  /** Cartes (par défaut, comme le simulateur) ou tableau. */
  readonly viewMode = signal<'list' | 'grid'>('grid');
  readonly viewOptions = computed((): ToolbarToggleOption[] => [
    { id: 'grid', icon: 'grid_view',  tooltip: this.t('PAYROLL.SIMULATOR.LIST.VIEW_GRID') },
    { id: 'list', icon: 'table_rows', tooltip: this.t('PAYROLL.SIMULATOR.LIST.VIEW_LIST') },
  ]);
  setViewMode(id: string): void {
    this.viewMode.set(id === 'grid' ? 'grid' : 'list');
  }

  readonly filterFields = computed<FilterField[]>(() => {
    const history = this.history();
    const pays = new Map(history.map(h => [h.paysId, this.paysName(h)]));
    const periods = distinctSorted(history.map(h => periodKey(h.periodYear, h.periodMonth))).reverse();
    return [{
      name: 'status',
      label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_STATUS'),
      type: 'select',
      placeholder: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_ALL'),
      options: [
        { value: 'SUCCESS', label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_SUCCESS') },
        { value: 'PARTIAL', label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_PARTIAL') },
      ],
    }, {
      name: 'pays',
      label: this.t('PAYROLL.PAYSLIPS.HISTORY.PAYS'),
      type: 'select',
      searchable: true,
      placeholder: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_ALL_PAYS'),
      options: [...pays.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, label]) => ({ value: String(id), label })),
    }, {
      name: 'period',
      label: this.t('PAYROLL.PAYSLIPS.HISTORY.PERIOD'),
      type: 'select',
      placeholder: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_ALL_PERIODS'),
      options: periods.map(p => {
        const [y, m] = p.split('-').map(Number);
        return { value: p, label: this.periodLabel(y, m) };
      }),
    }, {
      name: 'processedAt',
      label: this.t('PAYROLL.PAYSLIPS.HISTORY.DATE'),
      type: 'daterange',
    }];
  });

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title:        this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_TITLE'),
    triggerLabel: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_TRIGGER'),
    applyLabel:   this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_APPLY'),
    cancelLabel:  this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_CANCEL'),
    resetLabel:   this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_RESET'),
    align:        'right',
    initialValues: {
      status:      this.statusFilter() === 'ALL' ? [] : [this.statusFilter()],
      pays:        this.paysFilter() != null ? [String(this.paysFilter())] : [],
      period:      this.periodFilter() ? [this.periodFilter()!] : [],
      processedAt: this.processedFilter(),
    },
  }));

  applyFilters(result: FilterResult): void {
    this.statusFilter.set(((result['status'] as string | null) || 'ALL') as StatusFilter);
    const pays = pickValue(result, 'pays');
    this.paysFilter.set(pays ? Number(pays) : null);
    this.periodFilter.set(pickValue(result, 'period'));
    this.processedFilter.set(rangeSeed(result['processedAt']));
  }

  resetFilters(): void {
    this.statusFilter.set('ALL');
    this.paysFilter.set(null);
    this.periodFilter.set(null);
    this.processedFilter.set(null);
  }

  /** Lots retenus par les filtres et la recherche — même liste pour les cartes et le tableau. */
  private readonly filtered = computed(() => {
    const status = this.statusFilter();
    const pays = this.paysFilter();
    const period = this.periodFilter();
    const processed = dayRange(this.processedFilter());
    return this.history().filter(h => {
      const ok = batchCounts(h.result).toFix === 0;
      return (status === 'ALL' || (status === 'SUCCESS') === ok)
        && (pays == null || h.paysId === pays)
        && (!period || periodKey(h.periodYear, h.periodMonth) === period)
        && inDayRange(h.processedAt, processed);
    });
  });

  private statusBadge(h: PayslipHistoryEntry): BadgeCell {
    const c = batchCounts(h.result);
    return c.toFix === 0
      ? { label: this.t('PAYROLL.PAYSLIPS.LIST.STATUS_COMPLETE'), options: { variant: 'success', size: 'sm', dot: true } }
      : { label: this.t('PAYROLL.PAYSLIPS.LIST.STATUS_TO_CHECK', { count: c.toFix }), options: { variant: 'warning', size: 'sm', dot: true } };
  }

  // ── Tableau ────────────────────────────────────────────────────────────────
  readonly columns = computed((): TableColumn[] => [
    { key: 'processedAt', label: this.t('PAYROLL.PAYSLIPS.HISTORY.DATE'), type: 'date', sortable: true,
      format: { locale: this.numberLocale(), dateStyle: 'short', timeStyle: 'short' } },
    { key: 'pays',        label: this.t('PAYROLL.PAYSLIPS.HISTORY.PAYS'), sortable: true },
    // Mois écrit en toutes lettres : trié sur AAAA-MM, pas sur le libellé.
    { key: 'period',      label: this.t('PAYROLL.PAYSLIPS.HISTORY.PERIOD'), sortable: true,
      sortAccessor: row => row['_periodKey'] as string },
    { key: 'fileName',    label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILE'), type: 'custom', sortable: true },
    { key: 'total',       label: this.t('PAYROLL.PAYSLIPS.SUMMARY.TOTAL'), type: 'number', align: 'right', sortable: true },
    { key: 'filed',       label: this.t('PAYROLL.PAYSLIPS.SUMMARY.FILED'), type: 'number', align: 'right', sortable: true },
    { key: 'status',      label: this.t('PAYROLL.PAYSLIPS.HISTORY.STATUS'), type: 'badge', sortable: true },
  ]);

  private readonly rows = computed((): TableRow[] => this.filtered().map(h => {
    const c = batchCounts(h.result);
    return {
      id:          h.id,
      processedAt: h.processedAt,
      pays:        this.paysName(h),
      period:      this.periodLabel(h.periodYear, h.periodMonth),
      _periodKey:  periodKey(h.periodYear, h.periodMonth),
      fileName:    h.fileName,
      total:       c.total,
      filed:       c.filed,
      status:      this.statusBadge(h),
    };
  }));

  /** Recherche sur le texte affiché : date formatée (pas l'ISO), période en toutes lettres. */
  readonly filteredRows = computed<TableRow[]>(() => {
    const dateFmt = new Intl.DateTimeFormat(this.numberLocale(), { dateStyle: 'short', timeStyle: 'short' });
    return searchTableRows(this.rows(), this.columns().map(c =>
      c.key === 'processedAt' ? { ...c, sortAccessor: (row: TableRow) => dateFmt.format(new Date(row['processedAt'] as string)) } : c),
      this.search());
  });

  readonly tableConfig = computed((): TableConfig => ({
    showHeader: false,
    hoverable: true,
    emptyMessage: this.t(this.history().length ? 'PAYROLL.PAYSLIPS.LIST.EMPTY_FILTERED' : 'PAYROLL.PAYSLIPS.HISTORY.EMPTY'),
    ...tableTools(this.translate),
    defaultSort: { key: 'processedAt', dir: 'desc' as const },
    actions: [{
      id: 'view',
      icon: 'visibility',
      tooltip: this.t('PAYROLL.PAYSLIPS.LIST.OPEN'),
      onClick: (row: TableRow) => this.open(String(row['id'])),
    }],
  }));

  // ── Vue cartes ─────────────────────────────────────────────────────────────
  readonly cards = computed(() => {
    const ids = new Set(this.filteredRows().map(r => String(r['id'])));
    const dateFmt = new Intl.DateTimeFormat(this.numberLocale(), { dateStyle: 'short', timeStyle: 'short' });
    return this.filtered().filter(h => ids.has(h.id)).map(h => {
      const c = batchCounts(h.result);
      return {
        id: h.id,
        options: {
          variant: 'glass',
          clickable: true,
          metadata: {
            title: `${this.periodLabel(h.periodYear, h.periodMonth)} · ${this.paysName(h)}`,
            subtitle: `${h.fileName} · ${dateFmt.format(new Date(h.processedAt))}`,
            status: c.toFix === 0 ? 'active' : 'pending',
            // Sans nombre : la métrique « À corriger » de la carte le donne déjà.
            statusLabel: this.t(c.toFix === 0 ? 'PAYROLL.PAYSLIPS.LIST.STATUS_COMPLETE' : 'PAYROLL.PAYSLIPS.LIST.STATUS_TO_CHECK_SHORT'),
          },
          metricsColumns: 3,
          metrics: [
            { label: this.t('PAYROLL.PAYSLIPS.SUMMARY.TOTAL'), value: String(c.total) },
            { label: this.t('PAYROLL.PAYSLIPS.SUMMARY.FILED'), value: String(c.filed) },
            { label: this.t('PAYROLL.PAYSLIPS.SUMMARY.TO_FIX'), value: String(c.toFix) },
          ],
          viewLabel: this.t('PAYROLL.PAYSLIPS.LIST.OPEN'),
        } satisfies EntityCardOptions,
      };
    });
  });

  // ── Actions ────────────────────────────────────────────────────────────────
  newBatch(): void {
    this.router.navigate(['new'], { relativeTo: this.route });
  }

  open(id: string): void {
    this.router.navigate([id], { relativeTo: this.route });
  }
}
