import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import {
  ButtonComponent,
  DataTableComponent,
  EntityCardComponent,
  FieldMessageComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  PaginationComponent,
  PermissionService,
  SearchToolbarComponent,
  SkeletonComponent,
  type BadgeCell,
  type EntityCardAction,
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
import {
  PayrollApiService,
  type PaysDto,
  type SimulationListItemDto,
  type SimulationPageDto,
} from '../../core/payroll-api.service';
import { HrProfileService, type HrContractType } from '../../core/hr-profile.service';
import { PaysNamesService } from '../../core/pays-names.service';
import { UserStore } from '../../core/user.store';
import { NotificationService } from '../../core/notification.service';
import { readBlobError, saveBlob } from '../../shared/blob-download';
import { TableSort, delegatedSort, tableTools, toTableSort } from '../../shared/table-tools';
import { PAYROLL_SIMULATOR_PERMISSIONS } from '../../core/payroll-nav';
import { SimulatorListStateService } from './simulator-list-state.service';

/**
 * `/payroll/simulator` — liste des simulations individuelles, même squelette que les listes
 * de la facturation (`/finance/clients`) : en-tête avec « Nouvelle simulation », bandeau de
 * KPI, barre de recherche + filtres, tableau, pagination. Un clic ouvre la fiche
 * `/payroll/simulator/:id` ; « Dupliquer » ouvre le formulaire pré-rempli
 * (`/payroll/simulator/new?from=:id`).
 *
 * Tout est côté serveur (`GET /simulations/individual`) : recherche, filtres, tri, pages et
 * chiffres du bandeau. L'historique est cloisonné par pays : la liste en affiche UN, celui
 * de l'utilisateur au départ, à changer dans les filtres.
 */
@Component({
  selector: 'app-simulator-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    ButtonComponent, DataTableComponent, EntityCardComponent, FieldMessageComponent, MetricCardComponent,
    PageComponent, PageHeaderComponent, PaginationComponent, SearchToolbarComponent, SkeletonComponent,
  ],
  templateUrl: './simulator-list.component.html',
})
export class SimulatorListComponent implements OnInit {
  private readonly api        = inject(PayrollApiService);
  private readonly hr         = inject(HrProfileService);
  private readonly router     = inject(Router);
  private readonly route      = inject(ActivatedRoute);
  private readonly translate  = inject(TranslateService);
  private readonly paysNames  = inject(PaysNamesService);
  private readonly userStore  = inject(UserStore);
  private readonly notify     = inject(NotificationService);
  private readonly perms      = inject(PermissionService);
  private readonly listState  = inject(SimulatorListStateService);

  /** Présent seulement quand le tableau est rendu — passé à `[table]` de la barre. */
  readonly table = viewChild(DataTableComponent);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  private readonly numberLocale = computed(() =>
    this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR');

  readonly canCreate = computed(() => this.perms.hasAny(PAYROLL_SIMULATOR_PERMISSIONS));

  // ── État ───────────────────────────────────────────────────────────────────
  /** Premier chargement seulement : squelette de page de la lib (`daf-page [loading]`). */
  readonly firstLoad = signal(true);
  readonly loading   = signal(false);
  readonly error     = signal<string | null>(null);
  readonly pageData  = signal<SimulationPageDto | null>(null);
  readonly rowsData  = computed(() => this.pageData()?.content ?? []);
  /** Répartition candidats / collaborateurs, sous « Simulations ce mois-ci » : nombre de
   *  simulations de chaque sujet, avec les mêmes filtres que la liste SAUF le sujet (les deux
   *  comptes restent visibles quand on filtre sur l'un). Deux requêtes d'une ligne : seul
   *  `totalElements` sert. */
  readonly candidateCount = signal<number | null>(null);
  readonly employeeCount  = signal<number | null>(null);

  readonly searchText     = signal('');
  readonly paysFilter     = signal<number | null>(null);
  readonly contractFilter = signal<string | null>(null);
  readonly subjectFilter  = signal<string | null>(null);
  readonly modeFilter     = signal<string | null>(null);
  /** Seulement les résultats estimés (convergence partielle) — filtre et carte « À vérifier ». */
  readonly partialOnly    = signal(false);
  readonly sort           = signal<TableSort | null>(null);
  /** 0-indexé, comme `daf-pagination`. */
  readonly page     = signal(0);
  readonly pageSize = signal(20);
  /** Cartes (`grid`, par défaut — comme /finance/affaires) ou tableau (`list`) — bascule de
   *  la barre de recherche. Mêmes lignes, mêmes actions, autre présentation. */
  readonly viewMode = signal<'list' | 'grid'>('grid');

  /** Cartes puis tableau — même ordre que toutes les listes de la facturation. */
  readonly viewOptions = computed((): ToolbarToggleOption[] => [
    { id: 'grid', icon: 'grid_view',  tooltip: this.t('PAYROLL.SIMULATOR.LIST.VIEW_GRID') },
    { id: 'list', icon: 'table_rows', tooltip: this.t('PAYROLL.SIMULATOR.LIST.VIEW_LIST') },
  ]);

  setViewMode(id: string): void {
    this.viewMode.set(id === 'grid' ? 'grid' : 'list');
  }

  private readonly paysList      = signal<PaysDto[]>([]);
  private readonly contractTypes = signal<HrContractType[]>([]);
  readonly exportingId = signal<number | null>(null);

  readonly totalElements = computed(() => this.pageData()?.totalElements ?? 0);
  readonly totalPages    = computed(() => this.pageData()?.totalPages ?? 1);

  private readonly persistState = effect(() => {
    this.listState.save({
      searchText:     this.searchText(),
      paysFilter:     this.paysFilter(),
      contractFilter: this.contractFilter(),
      subjectFilter:  this.subjectFilter(),
      modeFilter:     this.modeFilter(),
      partialOnly:    this.partialOnly(),
      sort:           this.sort(),
      page:           this.page(),
      pageSize:       this.pageSize(),
      viewMode:       this.viewMode(),
    });
  });

  ngOnInit(): void {
    const s = this.listState.restore();
    if (s) {
      this.searchText.set(s.searchText);
      this.paysFilter.set(s.paysFilter);
      this.contractFilter.set(s.contractFilter);
      this.subjectFilter.set(s.subjectFilter);
      this.modeFilter.set(s.modeFilter);
      this.partialOnly.set(s.partialOnly ?? false);
      this.sort.set(s.sort);
      this.page.set(s.page);
      this.pageSize.set(s.pageSize);
      this.viewMode.set(s.viewMode ?? 'grid');
    } else {
      // Pays de départ : celui de l'utilisateur — c'est aussi le seul que la plupart des
      // rôles ont le droit de lire.
      this.paysFilter.set(this.userStore.currentUser()?.paysId ?? null);
    }

    this.api.listPays()
      .pipe(catchError(() => of([] as PaysDto[])))
      .subscribe(list => {
        this.paysList.set(list);
        if (this.paysFilter() == null && list.length) {
          this.paysFilter.set(list[0].id);
          this.loadContractTypes();
          this.load();
        } else if (this.paysFilter() == null) {
          // Aucun pays lisible : pas de requête à attendre, la page s'affiche vide.
          this.firstLoad.set(false);
        }
      });
    this.loadContractTypes();
    this.load();
  }

  // ── Chargement ─────────────────────────────────────────────────────────────

  /** Les réponses d'une requête dépassée sont ignorées (`seq`). */
  private seq = 0;
  load(): void {
    const paysId = this.paysFilter();
    if (paysId == null) {
      // Pays pas encore connu : `listPays()` relance le chargement dès qu'il en choisit un.
      this.pageData.set(null);
      return;
    }
    const current = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    this.loadSubjectCounts(paysId, current);
    this.api.listSimulations({
      paysId,
      page: this.page(),
      size: this.pageSize(),
      contractType: this.contractFilter(),
      mode: this.modeFilter(),
      subject: this.subjectFilter(),
      search: this.searchText(),
      partialOnly: this.partialOnly(),
      sort: this.sortParam(),
    }).subscribe({
      next: p => {
        if (current !== this.seq) return;
        // Page restaurée devenue hors limites : retour à la première.
        if (!p.content.length && this.page() > 0) {
          this.page.set(0);
          this.load();
          return;
        }
        this.pageData.set(p);
        this.loading.set(false);
        this.firstLoad.set(false);
      },
      error: e => {
        if (current !== this.seq) return;
        this.pageData.set(null);
        this.error.set(e?.error?.detail ?? e?.error?.error ?? this.t('PAYROLL.SIMULATOR.LIST.ERROR'));
        this.loading.set(false);
        this.firstLoad.set(false);
      },
    });
  }

  private loadSubjectCounts(paysId: number, current: number): void {
    const base = {
      paysId, page: 0, size: 1,
      contractType: this.contractFilter(), mode: this.modeFilter(),
      search: this.searchText(), partialOnly: this.partialOnly(), sort: null,
    };
    for (const [subject, target] of [['CANDIDATE', this.candidateCount], ['EMPLOYEE', this.employeeCount]] as const) {
      this.api.listSimulations({ ...base, subject }).pipe(catchError(() => of(null))).subscribe(p => {
        if (current === this.seq) target.set(p?.totalElements ?? null);
      });
    }
  }

  private loadContractTypes(): void {
    this.hr.getContractTypes(this.paysFilter()).subscribe(types => this.contractTypes.set(types));
  }

  // ── Recherche, filtres, tri, pages ─────────────────────────────────────────

  onSearchTextChange(value: string): void {
    this.searchText.set(value);
    this.page.set(0);
    this.load();
  }

  readonly filterFields = computed((): FilterField[] => [
    {
      name: 'pays',
      label: this.t('PAYROLL.SIMULATOR.LIST.FILTER.PAYS'),
      type: 'select',
      searchable: true,
      options: this.paysList().map(p => ({
        value: String(p.id),
        label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})`,
      })),
    },
    {
      name: 'contract',
      label: this.t('PAYROLL.SIMULATOR.LIST.FILTER.CONTRACT'),
      type: 'select',
      placeholder: this.t('PAYROLL.SIMULATOR.LIST.FILTER.ALL'),
      options: this.contractTypes().map(c => ({ value: c.code, label: c.code })),
    },
    {
      name: 'subject',
      label: this.t('PAYROLL.SIMULATOR.LIST.FILTER.SUBJECT'),
      type: 'select',
      placeholder: this.t('PAYROLL.SIMULATOR.LIST.FILTER.ALL'),
      options: [
        { value: 'CANDIDATE', label: this.t('PAYROLL.SIMULATOR.LIST.SUBJECT.CANDIDATE') },
        { value: 'EMPLOYEE',  label: this.t('PAYROLL.SIMULATOR.LIST.SUBJECT.EMPLOYEE') },
      ],
    },
    {
      name: 'mode',
      label: this.t('PAYROLL.SIMULATOR.LIST.FILTER.MODE'),
      type: 'select',
      placeholder: this.t('PAYROLL.SIMULATOR.LIST.FILTER.ALL'),
      options: [
        { value: 'NET_TO_BRUT', label: this.t('PAYROLL.SIMULATOR.MODE.NET_TO_BRUT') },
        { value: 'BRUT_TO_NET', label: this.t('PAYROLL.SIMULATOR.MODE.BRUT_TO_NET') },
      ],
    },
    {
      name: 'convergence',
      label: this.t('PAYROLL.SIMULATOR.LIST.FILTER.CONVERGENCE'),
      type: 'select',
      placeholder: this.t('PAYROLL.SIMULATOR.LIST.FILTER.ALL'),
      options: [
        { value: 'PARTIAL', label: this.t('PAYROLL.SIMULATOR.LIST.FILTER.CONVERGENCE_PARTIAL') },
      ],
    },
  ]);

  readonly filterConfig = computed((): SearchToolbarFilterConfig => ({
    title:        this.t('PAYROLL.SIMULATOR.LIST.FILTER.TITLE'),
    applyLabel:   this.t('PAYROLL.SIMULATOR.LIST.FILTER.APPLY'),
    cancelLabel:  this.t('PAYROLL.SIMULATOR.LIST.FILTER.CANCEL'),
    resetLabel:   this.t('PAYROLL.SIMULATOR.LIST.FILTER.RESET'),
    triggerLabel: this.t('PAYROLL.SIMULATOR.LIST.FILTER.TRIGGER'),
    initialValues: {
      pays:     this.paysFilter() != null ? [String(this.paysFilter())] : [],
      contract: this.contractFilter() ? [this.contractFilter()!] : [],
      subject:  this.subjectFilter() ? [this.subjectFilter()!] : [],
      mode:     this.modeFilter() ? [this.modeFilter()!] : [],
      convergence: this.partialOnly() ? ['PARTIAL'] : [],
    },
  }));

  applyFilters(result: FilterResult): void {
    const rawPays = result['pays'] as string | null;
    // Le pays est obligatoire (l'historique est cloisonné par pays) : « Réinitialiser »
    // ramène celui de l'utilisateur plutôt qu'une liste vide.
    const nextPays = rawPays ? Number(rawPays) : (this.userStore.currentUser()?.paysId ?? this.paysFilter());
    const paysChanged = nextPays !== this.paysFilter();
    this.paysFilter.set(nextPays);
    this.contractFilter.set((result['contract'] as string | null) || null);
    this.subjectFilter.set((result['subject'] as string | null) || null);
    this.modeFilter.set((result['mode'] as string | null) || null);
    this.partialOnly.set(result['convergence'] === 'PARTIAL');
    this.page.set(0);
    if (paysChanged) this.loadContractTypes();
    this.load();
  }

  onSort(event: Parameters<typeof toTableSort>[0]): void {
    this.sort.set(toTableSort(event));
    this.page.set(0);
    this.load();
  }

  private sortParam(): string | null {
    const s = this.sort();
    return s ? `${s.key},${s.dir}` : null;
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  onPageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(0);
    this.load();
  }

  // ── KPI ────────────────────────────────────────────────────────────────────

  readonly currency = computed(() =>
    this.rowsData().find(r => r.localCurrency)?.localCurrency
      ?? this.paysList().find(p => p.id === this.paysFilter())?.devise
      ?? '');

  private readonly summary = computed(() => this.pageData()?.summary ?? null);

  // Quatre tuiles de RÉSULTAT, aucune cliquable : le filtrage passe par le panneau Filtres
  // (Sujet, Fiabilité…). Ordre de lecture d'un financier : ce que coûte 1 de net, l'enveloppe
  // de coût des profils simulés, le volume, la fiabilité.

  // 1 · Coefficient de charge moyen — comparé au mois précédent. Un ratio qui monte veut dire
  //     que les charges pèsent plus : la flèche monte, mais rien n'est peint en « bien ».
  readonly kpiAvgRatio = computed(() => {
    const r = this.summary()?.avgRatio;
    return r == null ? '—' : `× ${this.money(r, 2)}`;
  });
  readonly kpiRatioDelta = computed((): MetricDelta | null => {
    const s = this.summary();
    if (!s) return null;
    if (s.prevMonthAvgRatio == null) {
      return { value: this.t('PAYROLL.SIMULATOR.LIST.KPI.RATIO_NO_PREV'), direction: 'neutral' };
    }
    const cur = s.avgRatio ?? s.prevMonthAvgRatio;
    return {
      value: this.t('PAYROLL.SIMULATOR.LIST.KPI.RATIO_PREV', { ratio: this.money(s.prevMonthAvgRatio, 2) }),
      direction: cur > s.prevMonthAvgRatio ? 'up' : cur < s.prevMonthAvgRatio ? 'down' : 'neutral',
    };
  });

  // 2 · Coût employeur mensuel — la FOURCHETTE des profils simulés (l'enveloppe), la moyenne
  //     en second : une moyenne seule de profils sans rapport ne parle pas.
  readonly kpiCostRange = computed(() => {
    const s = this.summary();
    if (!s || s.minLoadedCost == null || s.maxLoadedCost == null) return '—';
    const cur = this.currency();
    return s.minLoadedCost === s.maxLoadedCost
      ? this.money(s.minLoadedCost, 0, cur)
      : `${this.money(s.minLoadedCost, 0)} – ${this.money(s.maxLoadedCost, 0, cur)}`;
  });
  readonly kpiCostAvg = computed((): MetricDelta | null => {
    const avg = this.summary()?.avgLoadedCost;
    return avg == null ? null : {
      value: this.t('PAYROLL.SIMULATOR.LIST.KPI.COST_AVG', { amount: this.money(avg, 0, this.currency()) }),
      direction: 'neutral',
    };
  });

  // 3 · Simulations ce mois-ci — tendance vs le mois précédent, puis la répartition
  //     candidats / collaborateurs (comptes `loadSubjectCounts`, hors filtre Sujet).
  readonly kpiMonth = computed(() => String(this.summary()?.monthCount ?? 0));
  readonly kpiMonthDelta = computed((): MetricDelta | null => {
    const s = this.summary();
    if (!s) return null;
    const diff = s.monthCount - s.prevMonthCount;
    const c = this.candidateCount(), e = this.employeeCount();
    const trend = this.t('PAYROLL.SIMULATOR.LIST.KPI.MONTH_DELTA', { diff: (diff > 0 ? '+' : '') + diff });
    return {
      value: c == null || e == null
        ? trend
        : `${trend} · ${this.t('PAYROLL.SIMULATOR.LIST.KPI.SUBJECTS_SPLIT', { candidates: c, employees: e })}`,
      direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'neutral',
    };
  });

  // 4 · Résultats approximatifs — « 3 sur 45 » (convergence partielle) : la fiabilité des
  //     chiffres. Information seule ; le filtre est « Fiabilité » du panneau.
  readonly kpiPartial = computed(() => {
    const s = this.summary();
    return s ? this.t('PAYROLL.SIMULATOR.LIST.KPI.PARTIAL_VALUE', { count: s.partialCount, total: s.total }) : '—';
  });
  readonly kpiPartialDelta = computed((): MetricDelta | null => {
    const s = this.summary();
    if (!s) return null;
    return {
      value: this.t(s.partialCount ? 'PAYROLL.SIMULATOR.LIST.KPI.PARTIAL_SUB' : 'PAYROLL.SIMULATOR.LIST.KPI.PARTIAL_NONE'),
      direction: 'neutral',
    };
  });

  // Options des tuiles : `help` = description affichée au survol de la tuile (même usage que
  // /finance/treasury et /payroll/engine-results). En `computed` pour se retraduire au
  // changement de langue.
  readonly kpiRatioOptions = computed((): MetricCardOptions => ({
    icon: 'balance', iconColor: 'text-tertiary', iconBg: 'bg-tertiary/10',
    help: this.t('PAYROLL.SIMULATOR.LIST.KPI.AVG_RATIO_HELP'),
  }));
  readonly kpiCostOptions = computed((): MetricCardOptions => ({
    icon: 'account_balance_wallet', iconColor: 'text-secondary', iconBg: 'bg-secondary/10',
    help: this.t('PAYROLL.SIMULATOR.LIST.KPI.COST_HELP'),
  }));
  readonly kpiMonthOptions = computed((): MetricCardOptions => ({
    icon: 'calendar_month', iconColor: 'text-primary', iconBg: 'bg-primary/10',
    help: this.t('PAYROLL.SIMULATOR.LIST.KPI.MONTH_HELP'),
  }));
  readonly kpiPartialOptions = computed((): MetricCardOptions => {
    const n = this.summary()?.partialCount ?? 0;
    return {
      icon: n ? 'warning' : 'task_alt',
      iconColor: n ? 'text-warning' : 'text-success',
      iconBg: n ? 'bg-warning/10' : 'bg-success/10',
      valueColor: n ? 'text-warning' : undefined,
      help: this.t('PAYROLL.SIMULATOR.LIST.KPI.PARTIAL_HELP'),
      // Dernière tuile de la rangée : l'info-bulle s'ouvre vers le haut pour ne pas
      // déborder à droite (comme la dernière tuile de /finance/treasury).
      helpPlacement: 'top',
    };
  });

  // ── Tableau ────────────────────────────────────────────────────────────────

  readonly columns = computed((): TableColumn[] => {
    const money = { locale: this.numberLocale(), minimumFractionDigits: 0, maximumFractionDigits: 0 };
    return [
      { key: 'simulatedAt',  label: this.t('PAYROLL.SIMULATOR.LIST.COL.DATE'), type: 'date',
        format: { locale: this.numberLocale(), dateStyle: 'short', timeStyle: 'short' }, sortable: true },
      { key: 'subject',      label: this.t('PAYROLL.SIMULATOR.LIST.COL.SUBJECT'), sortable: true },
      { key: 'poste',        label: this.t('PAYROLL.SIMULATOR.LIST.COL.POSTE'), sortable: true },
      { key: 'contractType', label: this.t('PAYROLL.SIMULATOR.LIST.COL.CONTRACT'), sortable: true },
      { key: 'mode',         label: this.t('PAYROLL.SIMULATOR.LIST.COL.MODE'), type: 'badge', sortable: true },
      { key: 'gross',        label: this.t('PAYROLL.SIMULATOR.LIST.COL.GROSS'), type: 'number', align: 'right', format: money, sortable: true },
      { key: 'net',          label: this.t('PAYROLL.SIMULATOR.LIST.COL.NET'), type: 'number', align: 'right', format: money },
      { key: 'loadedCost',   label: this.t('PAYROLL.SIMULATOR.LIST.COL.LOADED_COST'), type: 'number', align: 'right', format: money, sortable: true },
      { key: 'costNetRatio', label: this.t('PAYROLL.SIMULATOR.LIST.COL.RATIO'), type: 'number', align: 'right',
        format: { locale: this.numberLocale(), minimumFractionDigits: 2, maximumFractionDigits: 2, prefix: '× ' }, sortable: true },
      { key: 'author',       label: this.t('PAYROLL.SIMULATOR.LIST.COL.AUTHOR') },
    ];
  });

  readonly rows = computed((): TableRow[] =>
    this.rowsData().map(r => ({
      id:           r.id,
      simulatedAt:  r.simulatedAt,
      subject:      this.subjectLabel(r),
      poste:        r.poste || '—',
      contractType: r.contractType || '—',
      mode: {
        label: this.t(`PAYROLL.SIMULATOR.MODE.${r.mode === 'BRUT_TO_NET' ? 'BRUT_TO_NET' : 'NET_TO_BRUT'}`),
        options: { variant: r.mode === 'BRUT_TO_NET' ? 'secondary' : 'primary', size: 'sm' },
      } satisfies BadgeCell,
      gross:        r.gross,
      net:          r.netPaid,
      loadedCost:   r.loadedCost,
      costNetRatio: r.costNetRatio,
      author:       r.simulatedByName || '—',
    })),
  );

  readonly tableConfig = computed((): TableConfig => ({
    showHeader: false,
    hoverable: true,
    emptyMessage: this.paysFilter() == null
      ? this.t('PAYROLL.SIMULATOR.LIST.EMPTY_NO_PAYS')
      : this.t('PAYROLL.SIMULATOR.LIST.EMPTY'),
    loading: this.loading() && !this.rowsData().length,
    skeletonRows: 5,
    ...tableTools(this.translate),
    ...delegatedSort(untracked(this.sort)),
    actions: [
      { id: 'open', icon: 'visibility', tooltip: this.t('PAYROLL.SIMULATOR.LIST.ACTION.OPEN'),
        onClick: row => this.open(row['id'] as number) },
      { id: 'duplicate', icon: 'content_copy', tooltip: this.t('PAYROLL.SIMULATOR.LIST.ACTION.DUPLICATE'),
        hidden: () => !this.canCreate(),
        onClick: row => this.duplicate(row['id'] as number) },
      { id: 'xlsx', icon: 'description', tooltip: this.t('PAYROLL.SIMULATOR.LIST.ACTION.EXPORT_XLSX'),
        disabled: row => this.exportingId() === row['id'],
        onClick: row => this.exportXlsx(row['id'] as number) },
    ],
  }));

  // ── Vue cartes ─────────────────────────────────────────────────────────────

  readonly cards = computed(() => {
    const currency = this.currency();
    const dateFmt = new Intl.DateTimeFormat(this.numberLocale(), { dateStyle: 'short', timeStyle: 'short' });
    return this.rowsData().map(r => {
      const subject = this.subjectLabel(r);
      const actions: EntityCardAction[] = [];
      if (this.canCreate()) {
        actions.push({ id: 'duplicate', icon: 'content_copy',
          tooltip: this.t('PAYROLL.SIMULATOR.LIST.ACTION.DUPLICATE'),
          callback: () => this.duplicate(r.id) });
      }
      actions.push({ id: 'xlsx', icon: 'description',
        tooltip: this.t('PAYROLL.SIMULATOR.LIST.ACTION.EXPORT_XLSX'),
        callback: () => this.exportXlsx(r.id) });
      return {
        id: r.id,
        options: {
          // Comme /finance/affaires : carte vitrée, sans `image` — la lib ne dessine alors
          // pas de pastille d'avatar et le titre prend toute la largeur de la carte.
          variant: 'glass',
          clickable: true,
          metadata: {
            title: subject,
            subtitle: [r.poste, r.contractType, dateFmt.format(new Date(r.simulatedAt))]
              .filter(Boolean).join(' · '),
            // Convergence partielle = résultat estimé : la carte le signale en « pending ».
            status: r.convergenceOk === false ? 'pending' : 'active',
            statusLabel: this.t(`PAYROLL.SIMULATOR.MODE.${r.mode === 'BRUT_TO_NET' ? 'BRUT_TO_NET' : 'NET_TO_BRUT'}`),
          },
          metricsColumns: 2,
          metrics: [
            { label: this.t('PAYROLL.SIMULATOR.LIST.COL.GROSS'), value: this.money(r.gross, 0), unit: currency },
            { label: this.t('PAYROLL.SIMULATOR.LIST.COL.NET'), value: this.money(r.netPaid, 0), unit: currency },
            { label: this.t('PAYROLL.SIMULATOR.LIST.COL.LOADED_COST'), value: this.money(r.loadedCost, 0), unit: currency },
            { label: this.t('PAYROLL.SIMULATOR.LIST.COL.RATIO'),
              value: r.costNetRatio == null ? '—' : `× ${this.money(r.costNetRatio, 2)}` },
          ],
          actions,
          viewLabel: this.t('PAYROLL.SIMULATOR.LIST.ACTION.OPEN'),
        } satisfies EntityCardOptions,
      };
    });
  });

  /** Emplacements de squelette pendant le chargement de la vue cartes — une page pleine,
   *  bornée à 9 (trois rangées) pour ne pas dessiner 100 blocs. */
  readonly skeletonSlots = computed(() =>
    Array.from({ length: Math.min(9, Math.max(3, this.pageSize())) }, (_, i) => i));

  private subjectLabel(r: SimulationListItemDto): string {
    if (r.profileUserId != null) {
      return r.subjectLabel || this.t('PAYROLL.SIMULATOR.LIST.SUBJECT.EMPLOYEE_ID', { id: r.profileUserId });
    }
    return r.subjectLabel || this.t('PAYROLL.SIMULATOR.LIST.SUBJECT.UNNAMED_CANDIDATE');
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  newSimulation(): void {
    this.router.navigate(['new'], { relativeTo: this.route });
  }

  open(id: number): void {
    this.router.navigate([id], { relativeTo: this.route });
  }

  duplicate(id: number): void {
    this.router.navigate(['new'], { relativeTo: this.route, queryParams: { from: id } });
  }

  exportXlsx(id: number): void {
    if (this.exportingId() != null) return;
    this.exportingId.set(id);
    this.api.downloadSimulationXlsx(id, this.translate.currentLang() || 'fr').subscribe({
      next: blob => {
        this.exportingId.set(null);
        saveBlob(blob, `simulation-${id}.xlsx`);
      },
      error: err => {
        this.exportingId.set(null);
        readBlobError(err, this.t('PAYROLL.SIMULATOR.RESULT.EXPORT_ERROR'))
          .then(msg => this.notify.error(msg));
      },
    });
  }

  private money(value: number | null | undefined, decimals: number, currency = ''): string {
    if (value == null || Number.isNaN(value)) return '—';
    const s = new Intl.NumberFormat(this.numberLocale(), {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(value);
    return currency ? `${s} ${currency}` : s;
  }
}
