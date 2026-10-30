import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, forkJoin, map, of } from 'rxjs';
import {
  HrProfileService, LIFECYCLE_STATUSES, contractTypeLabel, departmentFilterOptions,
  type EmployeeFilterOptions, type EmployeeListItem,
} from '../../core/hr-profile.service';
import { PayrollEngineService, type PayrollResultsSummaryDto } from '../../core/payroll-engine.service';
import { CURRENCY_GLYPHS, CurrencyService, SUPPORTED_CURRENCIES } from '../../core/currency.service';
import {
  CardComponent,
  DataTableComponent,
  EntityCardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  PaginationComponent,
  RadialMenuComponent,
  SearchToolbarComponent,
  type RadialMenuConfig,
  type RadialMenuItem,
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
import { environment } from '../../../environments/environment';
import { rememberEmployee } from './engine-results-employee';
import { TableSort, delegatedSort, tableTools, toTableSort } from '../../shared/table-tools';
import { EngineResultsListStateService } from './engine-results-list-state.service';
import { PaysNamesService } from '../../core/pays-names.service';

interface PaysItem { id: number; iso_code: string; french_label: string; }

/**
 * `/payroll/engine-results` — annuaire des collaborateurs (cartes ou tableau). Un clic
 * ouvre `/payroll/engine-results/:employeeId`, l'historique de paie de ce collaborateur
 * (`EngineResultsComponent`). Remplace l'ancien sélecteur "Rechercher un collaborateur…"
 * du header, qui laissait la page vide tant qu'on n'avait choisi personne.
 *
 * Contrairement à `/payroll/candidate-simulation` (liste entière en mémoire), la
 * recherche, le filtre pays et la pagination sont faits côté serveur : l'endpoint RH
 * `/api/hr/profiles/employees` est paginé et couvre tout le personnel.
 */
@Component({
  selector: 'app-engine-results-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    CardComponent, DataTableComponent, EntityCardComponent, MetricCardComponent, PageComponent,
    PageHeaderComponent, PaginationComponent, RadialMenuComponent, SearchToolbarComponent,
  ],
  templateUrl: './engine-results-list.component.html',
  styleUrl: './engine-results-list.component.scss',
})
export class EngineResultsListComponent implements OnInit {
  /** Vue tableau uniquement (undefined en vue cartes) — passé au `[table]` de la barre pour placer réinitialiser + choix des
   *  colonnes à droite de Filtres, au lieu d'au-dessus du tableau. */
  readonly table = viewChild(DataTableComponent);

  private readonly hrService = inject(HrProfileService);
  private readonly engineApi = inject(PayrollEngineService);
  private readonly currency  = inject(CurrencyService);
  private readonly http      = inject(HttpClient);
  private readonly router    = inject(Router);
  private readonly route     = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly employees     = signal<EmployeeListItem[]>([]);
  readonly totalElements = signal(0);
  readonly totalPages    = signal(1);
  readonly loading       = signal(false);
  readonly error         = signal<string | null>(null);

  readonly searchText = signal('');
  readonly paysFilter = signal<number | null>(null);
  readonly statusFilter     = signal<string | null>(null);
  readonly departmentFilter = signal<string | null>(null);
  readonly contractFilter   = signal<string | null>(null);
  readonly viewMode   = signal<'grid' | 'list'>('grid');
  /** 0-indexé, comme `daf-pagination`. */
  readonly page     = signal(0);
  readonly pageSize = signal(20);

  private readonly paysList = signal<PaysItem[]>([]);
  private readonly filterOptions = signal<EmployeeFilterOptions | null>(null);

  // ── Mémoire de la liste ────────────────────────────────────────────────────
  private readonly listState = inject(EngineResultsListStateService);

  /**
   * Chaque changement de recherche, de filtre, de vue, de tri ou de page est mémorisé, pour
   * que le retour depuis l'historique d'un collaborateur retrouve la liste telle qu'on l'a
   * quittée. Le premier passage a lieu après `ngOnInit`, donc après la restauration.
   */
  private readonly persistState = effect(() => {
    this.listState.save({
      searchText:       this.searchText(),
      paysFilter:       this.paysFilter(),
      statusFilter:     this.statusFilter(),
      departmentFilter: this.departmentFilter(),
      contractFilter:   this.contractFilter(),
      viewMode:         this.viewMode(),
      employeeSort:     this.employeeSort(),
      page:             this.page(),
      pageSize:         this.pageSize(),
    });
  });

  /**
   * Avant les premiers chargements et le premier rendu : la liste ET le bandeau KPI suivent
   * le filtre pays, `daf-filter` ne lit `initialValues` qu'une fois, et le tableau ne lit son
   * tri (`delegatedSort`) qu'à sa création.
   */
  private restoreState(): void {
    const s = this.listState.restore();
    if (!s) return;
    this.searchText.set(s.searchText);
    this.paysFilter.set(s.paysFilter);
    this.statusFilter.set(s.statusFilter);
    this.departmentFilter.set(s.departmentFilter);
    this.contractFilter.set(s.contractFilter);
    this.viewMode.set(s.viewMode);
    this.employeeSort.set(s.employeeSort);
    this.page.set(s.page);
    this.pageSize.set(s.pageSize);
  }

  ngOnInit(): void {
    this.restoreState();
    this.http.get<PaysItem[]>(`${environment.hrApiUrl}/api/hr/config/hs/pays-list`)
      .pipe(catchError(() => of([] as PaysItem[])))
      .subscribe(list => this.paysList.set(list));
    // Aucun filtre pays par défaut : la liste affiche tout le personnel et le bandeau KPI
    // les totaux de tous les pays ; choisir un pays recharge ces mêmes tuiles pour lui.
    this.hrService.getFilterOptions().subscribe(o => this.filterOptions.set(o));
    this.load();
    this.loadKpis();
  }

  // ── Bandeau KPI paie ─────────────────────────────────────────────────
  // Totaux du dernier mois calculé : pour le pays filtré (`/engine/results/summary`), ou
  // pour tous les pays paie sans filtre (`/engine/results/summary/all`, un résumé par
  // pays). Chaque pays arrive dans sa propre devise et pour son propre dernier mois : les
  // montants sont convertis dans la devise d'affichage AVANT d'être additionnés — jamais
  // de TND + EUR bruts. La couverture compare les collaborateurs calculés à l'effectif en
  // poste du service RH (même endpoint que la liste, `size=1` : seul `totalElements`
  // compte). Suit le filtre pays, pas la recherche texte.
  /** `null` tant que rien n'est chargé (ou service en échec) ; sinon les pays ayant des résultats. */
  readonly summaries = signal<PayrollResultsSummaryDto[] | null>(null);
  readonly headcount = signal<number | null>(null);
  /** Rechargement en cours — les tuiles gardent les valeurs précédentes, estompées. */
  readonly kpiLoading = signal(false);
  private kpiSeq = 0;

  loadKpis(): void {
    const current = ++this.kpiSeq;
    const paysId = this.paysFilter();
    // Pas de remise à `null` ici : les tuiles restent affichées pendant le chargement,
    // leur contenu est simplement remplacé à l'arrivée de la réponse.
    this.kpiLoading.set(true);
    const summaries$ = paysId != null
      ? this.engineApi.getResultsSummary(paysId).pipe(map(s => [s]))
      : this.engineApi.getAllResultsSummaries().pipe(map(list => list.filter(s => s.employeeCount > 0)));
    forkJoin({
      summaries: summaries$.pipe(catchError(() => of(null))),
      headcount: this.hrService.listEmployees({ paysId, page: 0, size: 1 }).pipe(
        map(p => p.totalElements ?? 0),
        catchError(() => of(null)),
      ),
    }).subscribe(r => {
      if (current !== this.kpiSeq) return;
      this.summaries.set(r.summaries);
      this.headcount.set(r.headcount);
      this.kpiLoading.set(false);
    });
  }

  /** Devises d'origine des totaux, sans doublon. */
  readonly sourceCurrencies = computed(() =>
    [...new Set((this.summaries() ?? []).map(s => s.currencyCode).filter((c): c is string => !!c))]);

  // ── Devise d'affichage (daf-radial-menu, comme le sélecteur devise de finance) ──
  // Les totaux arrivent dans la devise de chaque pays ; le menu les convertit au taux du
  // jour. `displayCurrency()` = devise réellement affichée : le choix du menu, sinon la
  // devise commune des pays affichés, sinon EUR quand plusieurs devises se mélangent.
  readonly displayCurrency = computed(() => {
    const chosen = this.currency.display();
    if (chosen) return chosen;
    const sources = this.sourceCurrencies();
    if (sources.length === 1) return sources[0];
    return sources.length > 1 ? 'EUR' : null;
  });
  readonly isConverted = computed(() => {
    const shown = this.displayCurrency();
    return !!shown && this.sourceCurrencies().some(c => c !== shown);
  });
  /** Devises converties vers `displayCurrency()`, pour la mention sous le titre. */
  readonly convertedFrom = computed(() =>
    this.sourceCurrencies().filter(c => c !== this.displayCurrency()).join(', '));

  readonly currencyItems = computed<RadialMenuItem[]>(() =>
    SUPPORTED_CURRENCIES.map(code => ({
      id: code,
      glyph: CURRENCY_GLYPHS[code],
      label: this.t(`PAYROLL.ENGINE_RESULTS.CURRENCY.${code}`),
    })));

  readonly currencyMenuConfig = computed<RadialMenuConfig>(() => ({
    label: this.t('PAYROLL.ENGINE_RESULTS.CURRENCY.TITLE'),
    maxVisible: SUPPORTED_CURRENCIES.length,
    // Rien à convertir sans totaux (aucun résultat, ou service en échec).
    disabled: this.sourceCurrencies().length === 0,
  }));

  onCurrencyPick(item: RadialMenuItem): void {
    this.currency.setDisplay(item.id);
  }

  /** Somme d'un montant sur tous les pays, chacun converti dans la devise d'affichage. */
  private total(field: 'totalGross' | 'totalNet' | 'totalLoadedCost'): number {
    const target = this.displayCurrency();
    return (this.summaries() ?? []).reduce((acc, s) => {
      const v = s[field] ?? 0;
      return acc + (s.currencyCode && target ? this.currency.convert(v, s.currencyCode, target) : v);
    }, 0);
  }

  private money(amount: number): string {
    const target = this.displayCurrency();
    const locale = this.translate.getCurrentLang() === 'en' ? 'en-US' : 'fr-FR';
    if (target) {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: target, maximumFractionDigits: 0 })
          .format(amount);
      } catch { /* code ISO inconnu d'Intl — repli ci-dessous */ }
    }
    const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
    return target ? `${n} ${target}` : n;
  }

  /** Dernier mois calculé, en toutes lettres (« novembre 2026 ») ; une plage quand les pays
   *  n'en sont pas au même mois. */
  private periodLabel(list: PayrollResultsSummaryDto[]): string {
    const keys = list
      .filter(s => s.periodYear && s.periodMonth)
      .map(s => s.periodYear! * 100 + s.periodMonth!)
      .sort((a, b) => a - b);
    if (keys.length === 0) return this.t('PAYROLL.ENGINE_RESULTS.KPI_NO_PERIOD');
    const locale = this.translate.getCurrentLang() === 'en' ? 'en-GB' : 'fr-FR';
    const fmt = (k: number) => new Date(Math.floor(k / 100), (k % 100) - 1, 1)
      .toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    const first = keys[0], last = keys[keys.length - 1];
    return first === last ? fmt(last) : `${fmt(first)} – ${fmt(last)}`;
  }

  /** Les cinq tuiles, prêtes pour le template — TOUJOURS affichées : « — » tant que
   *  rien n'est chargé ou si le service est en échec. */
  readonly kpiTiles = computed(() => {
    const list = this.summaries();
    if (!list) {
      const empty = '—';
      return {
        period: empty,
        tiles: [
          { label: this.t('PAYROLL.ENGINE_RESULTS.KPI_GROSS_PAYROLL'), value: empty, delta: null, options: { icon: 'account_balance_wallet' } },
          { label: this.t('PAYROLL.ENGINE_RESULTS.KPI_NET_TOTAL'),     value: empty, delta: null, options: { icon: 'payments' } },
          { label: this.t('PAYROLL.ENGINE_RESULTS.KPI_WITHHELD'),      value: empty, delta: null, options: { icon: 'receipt_long' } },
          { label: this.t('PAYROLL.ENGINE_RESULTS.KPI_EMPLOYER_COST'), value: empty, delta: null, options: { icon: 'account_balance' } },
          { label: this.t('PAYROLL.ENGINE_RESULTS.KPI_COVERAGE'),      value: empty, delta: null, options: { icon: 'fact_check' } },
        ] satisfies { label: string; value: string | number; delta: MetricDelta | null; options: MetricCardOptions }[],
      };
    }
    // Tuile « Coût employeur total » de retour : depuis la correction du moteur (26/10/2026),
    // `totalLoadedCost` = brut + cotisations PATRONALES réelles (avant : brut + CNSS salariale).
    // Un mois calculé avant cette date garde l'ancienne valeur tant qu'il n'est pas relancé —
    // l'aide de la tuile le dit. Plus de tuile « Échecs de convergence » : toujours 0.
    const s = {
      totalGross:    this.total('totalGross'),
      totalNet:      this.total('totalNet'),
      totalLoadedCost: this.total('totalLoadedCost'),
      employeeCount: list.reduce((acc, x) => acc + x.employeeCount, 0),
    };
    const period = this.periodLabel(list);
    const headcount = this.headcount();
    // Collaborateurs en poste sans résultat sur la période. ⚠ `employeeCount` compte les
    // RÉSULTATS (un recalcul du même mois compte deux fois) tant que le résumé serveur ne
    // dédoublonne pas : le nombre est borné à 0 pour ne jamais devenir négatif.
    const missing = headcount != null ? Math.max(0, headcount - s.employeeCount) : null;
    // Retenues = ce qui sépare la masse brute de la masse nette (cotisations salariales + IRPP).
    const withheld = Math.max(0, s.totalGross - s.totalNet);
    const withheldPct = s.totalGross > 0
      ? new Intl.NumberFormat(this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: 1 })
          .format(withheld / s.totalGross * 100)
      : null;
    // Info-bulles sans titre : il redirait le libellé de la tuile, juste au-dessus.
    return {
      period,
      tiles: [
        {
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_GROSS_PAYROLL'),
          value: this.money(s.totalGross),
          delta: null,
          options: {
            icon: 'account_balance_wallet',
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_GROSS_PAYROLL_HELP', { period }),
          },
        },
        {
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_NET_TOTAL'),
          value: this.money(s.totalNet),
          delta: null,
          options: {
            valueColor: 'text-primary', icon: 'payments',
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_NET_TOTAL_HELP', { period }),
          },
        },
        {
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_WITHHELD'),
          value: this.money(withheld),
          delta: withheldPct != null
            ? { value: this.t('PAYROLL.ENGINE_RESULTS.KPI_WITHHELD_PCT', { pct: withheldPct }), direction: 'neutral' as const }
            : null,
          options: {
            icon: 'receipt_long',
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_WITHHELD_HELP', { period }),
          },
        },
        {
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_EMPLOYER_COST'),
          value: this.money(s.totalLoadedCost),
          delta: s.totalLoadedCost > s.totalGross
            ? { value: this.t('PAYROLL.ENGINE_RESULTS.KPI_EMPLOYER_COST_SUB', { amount: this.money(s.totalLoadedCost - s.totalGross) }), direction: 'neutral' as const }
            : null,
          options: {
            icon: 'account_balance', valueColor: 'text-primary',
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_EMPLOYER_COST_HELP', { period }),
          },
        },
        {
          // Collaborateurs calculés « 12 / 15 », les non calculés dessous (une seule tuile).
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_COVERAGE'),
          value: headcount != null ? `${s.employeeCount} / ${headcount}` : String(s.employeeCount),
          delta: missing == null ? null : {
            value: missing > 0
              ? this.t('PAYROLL.ENGINE_RESULTS.KPI_NOT_CALCULATED_SUB', { count: missing })
              : this.t('PAYROLL.ENGINE_RESULTS.KPI_ALL_CALCULATED'),
            direction: 'neutral' as const,
          },
          options: {
            ...(missing == null ? { icon: 'fact_check' }
              : missing > 0
                ? { valueColor: 'text-warning', icon: 'person_alert', iconColor: 'text-warning', iconBg: 'bg-warning/10' }
                : { valueColor: 'text-success', icon: 'task_alt', iconColor: 'text-success', iconBg: 'bg-success/10' }),
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_COVERAGE_HELP', { period }),
            // Dernière tuile de la rangée : l'aide s'ouvre vers le haut (pas de débordement).
            helpPlacement: 'top',
          },
        },
      ] satisfies { label: string; value: string | number; delta: MetricDelta | null; options: MetricCardOptions }[],
    };
  });

  /** Une requête à chaque changement de recherche/filtre/page. Les réponses d'une
   *  requête dépassée sont ignorées (`seq`), pour qu'une frappe rapide ne ré-affiche
   *  pas une page plus ancienne arrivée en retard. */
  private seq = 0;
  load(): void {
    const current = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    this.hrService.listEmployees({
      search: this.searchText(),
      paysId: this.paysFilter(),
      status: this.statusFilter() ?? undefined,
      department: this.departmentFilter(),
      contract: this.contractFilter(),
      page: this.page(),
      size: this.pageSize(),
      sort: this.employeeSortParam(),
    }).subscribe({
      next: p => {
        if (current !== this.seq) return;
        // Page restaurée devenue hors limites (collaborateurs sortis entre-temps) : on
        // retombe sur la première plutôt que d'afficher une page vide.
        if (!p.content?.length && this.page() > 0) {
          this.page.set(0);
          this.load();
          return;
        }
        this.employees.set(p.content ?? []);
        this.totalElements.set(p.totalElements ?? 0);
        this.totalPages.set(Math.max(1, p.totalPages ?? 1));
        this.loading.set(false);
      },
      error: e => {
        if (current !== this.seq) return;
        this.employees.set([]);
        this.error.set(e?.error?.message ?? this.t('PAYROLL.ENGINE_RESULTS.ERROR_EMPLOYEES'));
        this.loading.set(false);
      },
    });
  }

  onSearchTextChange(value: string): void {
    this.searchText.set(value);
    this.page.set(0);
    this.load();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(0);
    this.load();
  }

  readonly filterFields = computed<FilterField[]>(() => [{
    name: 'pays',
    label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_PAYS'),
    type: 'select',
    searchable: true,
    placeholder: this.t('PAYROLL.ENGINE_RESULTS.FILTER_ALL'),
    options: this.paysList().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.french_label)} (${p.iso_code})` })),
  }, {
    name: 'status',
    label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_STATUS'),
    type: 'select',
    // Sans statut, le service RH ne renvoie que les collaborateurs en poste.
    placeholder: this.t('PAYROLL.ENGINE_RESULTS.FILTER_IN_POST'),
    options: LIFECYCLE_STATUSES.map(s => ({ value: s, label: this.lifecycleLabel(s) })),
  }, {
    name: 'department',
    label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_DEPARTMENT'),
    type: 'select',
    searchable: true,
    placeholder: this.t('PAYROLL.ENGINE_RESULTS.FILTER_ALL'),
    options: departmentFilterOptions(this.filterOptions(), this.translate.currentLang()),
  }, {
    name: 'contract',
    label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_CONTRACT'),
    type: 'select',
    placeholder: this.t('PAYROLL.ENGINE_RESULTS.FILTER_ALL'),
    options: (this.filterOptions()?.contractTypes ?? []).map(c => ({ value: c, label: contractTypeLabel(c, this.translate) })),
  }]);

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.ENGINE_RESULTS.FILTER_EMPLOYEES_TITLE'),
    applyLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_RESET'),
    triggerLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_TRIGGER'),
    // `daf-filter` seeds `initialValues` in its own shape — a `select` is a `string[]`.
    initialValues: {
      pays:       this.paysFilter() != null ? [String(this.paysFilter())] : [],
      status:     this.statusFilter() ? [this.statusFilter()!] : [],
      department: this.departmentFilter() ? [this.departmentFilter()!] : [],
      contract:   this.contractFilter() ? [this.contractFilter()!] : [],
    },
  }));

  applyFilters(result: FilterResult): void {
    const raw = result['pays'] as string | null;
    this.paysFilter.set(raw ? Number(raw) : null);
    this.statusFilter.set((result['status'] as string | null) || null);
    this.departmentFilter.set((result['department'] as string | null) || null);
    this.contractFilter.set((result['contract'] as string | null) || null);
    this.page.set(0);
    this.load();
    this.loadKpis();
  }

  readonly viewOptions = computed<ToolbarToggleOption[]>(() => [
    { id: 'grid', icon: 'grid_view',  tooltip: this.t('PAYROLL.ENGINE_RESULTS.VIEW_GRID') },
    { id: 'list', icon: 'table_rows', tooltip: this.t('PAYROLL.ENGINE_RESULTS.VIEW_LIST') },
  ]);

  private initials(fullName: string): string {
    return fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  }

  /** `LifecycleStatus` du service RH → pastille de la carte. */
  private entityStatus(s: string): 'active' | 'inactive' | 'pending' {
    switch (s) {
      case 'ACTIVE':     return 'active';
      case 'TERMINATED':
      case 'ARCHIVED':   return 'inactive';
      default:           return 'pending';
    }
  }

  private lifecycleLabel(s: string): string {
    const key = `PAYROLL.ENGINE_RESULTS.LIFECYCLE.${s}`;
    const label = this.t(key);
    return label === key ? s : label;
  }

  readonly employeeCards = computed(() =>
    this.employees().map(e => ({
      id: e.userId,
      options: {
        clickable: true,
        image: { initials: this.initials(e.fullName) },
        metadata: {
          title: e.fullName,
          // Département et contrat sont désormais des métriques de la carte : plus de
          // sous-titre, qui les aurait répétés.
          ...(e.lifecycleStatus
            ? { status: this.entityStatus(e.lifecycleStatus), statusLabel: this.lifecycleLabel(e.lifecycleStatus) }
            : {}),
        },
        metricsColumns: 2,
        metrics: [
          { label: this.t('PAYROLL.ENGINE_RESULTS.COL_MATRICULE'), value: e.employeeId ?? '—' },
          { label: this.t('PAYROLL.ENGINE_RESULTS.COL_PAYS'),      value: e.paysLabel ?? '—' },
          { label: this.t('PAYROLL.ENGINE_RESULTS.COL_DEPARTMENT'), value: e.department ?? '—' },
          { label: this.t('PAYROLL.ENGINE_RESULTS.COL_CONTRACT'),   value: this.contractLabel(e.contractType) },
        ],
        viewLabel: this.t('PAYROLL.ENGINE_RESULTS.VIEW_HISTORY'),
      } satisfies EntityCardOptions,
    })),
  );

  readonly employeeColumns = computed<TableColumn[]>(() => [
    { key: 'name',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_EMPLOYEE'),   sortable: true },
    { key: 'matricule',  label: this.t('PAYROLL.ENGINE_RESULTS.COL_MATRICULE'),  sortable: true },
    { key: 'department', label: this.t('PAYROLL.ENGINE_RESULTS.COL_DEPARTMENT'), sortable: true },
    { key: 'contract',   label: this.t('PAYROLL.ENGINE_RESULTS.COL_CONTRACT'),   sortable: true },
    { key: 'pays',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_PAYS'),       sortable: true },
  ]);

  /**
   * Tri serveur : la liste est paginée par le service RH, la lib ne trie donc pas elle-même
   * (`manualSort`). Colonne du tableau → clé acceptée par `GET /api/hr/profiles/employees`
   * (`EmployeeProfileService.EMPLOYEE_SORT_COLUMNS` côté RH).
   */
  private static readonly EMPLOYEE_SORT_KEY: Record<string, string> = {
    name:       'fullName',
    matricule:  'employeeId',
    department: 'department',
    contract:   'contractType',
    pays:       'pays',
  };

  readonly employeeSort = signal<TableSort | null>(null);

  onEmployeeSort(event: Parameters<typeof toTableSort>[0]): void {
    this.employeeSort.set(toTableSort(event));
    this.page.set(0);
    this.load();
  }

  private employeeSortParam(): string | null {
    const sort = this.employeeSort();
    const key = sort ? EngineResultsListComponent.EMPLOYEE_SORT_KEY[sort.key] : undefined;
    return sort && key ? `${key},${sort.dir}` : null;
  }

  /** Outils de tableau communs (`tableTools`), comme sur `/finance/affaires`. */
  readonly employeeTableConfig = computed<TableConfig>(() => ({
    actions: this.employeeActions(),
    emptyMessage: this.t('PAYROLL.ENGINE_RESULTS.EMPTY_EMPLOYEES'),
    showHeader: false,
    ...tableTools(this.translate),
    ...delegatedSort(untracked(this.employeeSort)),
  }));

  readonly employeeRows = computed<TableRow[]>(() =>
    this.employees().map(e => ({
      id:         e.userId,
      name:       e.fullName,
      matricule:  e.employeeId ?? '—',
      department: e.department ?? '—',
      contract:   this.contractLabel(e.contractType),
      pays:       e.paysLabel ?? '—',
    })),
  );

  /** Contrat en clair (« CDI » pour PERMANENT, « Stage » pour INTERN…), « — » sans contrat. */
  private contractLabel(code: string | null): string {
    return code ? contractTypeLabel(code, this.translate) : '—';
  }

  /** Nom de la devise d'affichage (« Dinar tunisien »), pour la ligne au-dessus des tuiles :
   *  le bouton flottant de la lib n'affiche que le symbole. */
  readonly displayCurrencyName = computed(() => {
    const code = this.displayCurrency();
    if (!code) return null;
    const key = `PAYROLL.ENGINE_RESULTS.CURRENCY.${code}`;
    const name = this.t(key);
    return name === key ? code : name;
  });

  /** `id: 'view'` → icône `visibility` de la lib ; le tableau n'affiche que l'icône. */
  readonly employeeActions = computed(() => [
    { id: 'view', tooltip: this.t('PAYROLL.ENGINE_RESULTS.VIEW_HISTORY'), onClick: (row: TableRow) => this.open(row['id']) },
  ]);

  /** Garde la fiche en cache de session pour que la page détail affiche le bandeau
   *  d'identité sans rappeler le service RH, y compris après un rafraîchissement. */
  open(userId: number): void {
    const e = this.employees().find(x => x.userId === userId);
    if (e) rememberEmployee(e);
    this.router.navigate([userId], { relativeTo: this.route });
  }
}
