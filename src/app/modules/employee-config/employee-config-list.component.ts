import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { type Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import {
  HrProfileService, LIFECYCLE_STATUSES, contractTypeLabel, departmentFilterOptions,
  type EmployeeFilterOptions, type EmployeeListItem, type HrContractType,
} from '../../core/hr-profile.service';
import { PayrollApiService, type PaysDto } from '../../core/payroll-api.service';
import {
  CardComponent,
  DataTableComponent,
  EntityCardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  PaginationComponent,
  SearchToolbarComponent,
  type BadgeCell,
  type BadgeVariant,
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
import { rememberEmployee } from './employee-config-employee';
import { TableSort, delegatedSort, tableTools, toTableSort } from '../../shared/table-tools';
import { PaysNamesService } from '../../core/pays-names.service';
import { EmployeeConfigListStateService } from './employee-config-list-state.service';
import { EmployeeConfigService } from './employee-config.service';
import { PageGuideComponent } from '../../shared/guide/page-guide.component';
import type { GuideStep } from '../../shared/guide/page-guide.types';

/** Guide de la page — `target` = un `data-guide` du gabarit. */
const guideStep = (key: string, icon: string, target?: string): GuideStep => ({
  icon, titleKey: `GUIDE.EMPLOYEE_CONFIG.${key}_TITLE`, textKey: `GUIDE.EMPLOYEE_CONFIG.${key}_TEXT`, target,
});
const GUIDE_STEPS: GuideStep[] = [
  guideStep('WELCOME',    'manage_accounts', 'ec-list-header'),
  guideStep('KPIS',       'monitoring',      'ec-list-kpis'),
  guideStep('TOOLBAR',    'filter_list',     'ec-list-toolbar'),
  guideStep('RESULTS',    'groups',          'ec-list-results'),
  guideStep('PAGINATION', 'last_page',       'ec-list-pagination'),
];

/** Tout le périmètre filtré en une page pour les KPI — le plafond par défaut de Spring Data,
 *  comme `ALL_EMPLOYEES` de /payroll/engine-results. */
const ALL_EMPLOYEES = 2000;
/** userId par appel à `/employee-configs/contract-types` : la liste passe dans l'URL. */
const CONTRACT_TYPES_CHUNK = 200;

/** Une tuile du bandeau KPI. */
interface KpiTile { label: string; value: string; delta: MetricDelta | null; options: MetricCardOptions; }

/**
 * `/payroll/employee-config` — « Rémunération », entrée de la barre latérale. Même mise en
 * page que `/payroll/engine-results` : en-tête, bandeau KPI, barre de recherche avec la
 * bascule cartes / tableau, puis `daf-pagination`. Un clic ouvre
 * `/payroll/employee-config/:userId`, la configuration de paie du collaborateur
 * (`EmployeeConfigComponent`).
 *
 * Recherche, filtres et pagination côté serveur (`/api/hr/profiles/employees`). Les KPI
 * suivent les filtres (pas la recherche) : tout le périmètre filtré, recoupé avec les
 * configurations enregistrées (`/employee-configs/contract-types`).
 */
@Component({
  selector: 'app-employee-config-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    CardComponent, DataTableComponent, EntityCardComponent, MetricCardComponent, PageComponent,
    PageHeaderComponent, PaginationComponent, SearchToolbarComponent, PageGuideComponent,
  ],
  templateUrl: './employee-config-list.component.html',
  styleUrl: './employee-config-list.component.scss',
})
export class EmployeeConfigListComponent implements OnInit {
  readonly guideSteps = GUIDE_STEPS;
  /** Vue tableau uniquement (undefined en vue cartes) — passé au `[table]` de la barre pour placer
   *  réinitialiser + choix des colonnes à droite de Filtres, au lieu d'au-dessus du tableau. */
  readonly table = viewChild(DataTableComponent);

  private readonly hrService  = inject(HrProfileService);
  private readonly payrollApi = inject(PayrollApiService);
  private readonly router     = inject(Router);
  private readonly route      = inject(ActivatedRoute);
  private readonly translate  = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);
  private readonly configService = inject(EmployeeConfigService);

  /** userId → contrat de la config paie enregistrée : prime sur le contrat de la fiche RH,
   *  sinon un contrat modifié dans `/employee-config/:id` n'apparaissait pas dans la liste.
   *  Un userId absent = configuration jamais enregistrée ; `null` tant que la page charge. */
  readonly payrollContracts = signal<Record<number, string> | null>(null);

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
  readonly viewMode = signal<'grid' | 'list'>('grid');
  /** 0-indexé, comme `daf-pagination`. */
  readonly page     = signal(0);
  /** 20 par page, comme /payroll/engine-results. */
  readonly pageSize = signal(20);

  private readonly paysList = signal<PaysDto[]>([]);
  private readonly filterOptions = signal<EmployeeFilterOptions | null>(null);

  // ── Mémoire de la liste ────────────────────────────────────────────────────
  private readonly listState = inject(EmployeeConfigListStateService);

  /**
   * Chaque changement de recherche, de filtre, de vue, de tri ou de page est mémorisé, pour
   * que le retour depuis la configuration d'un collaborateur retrouve la liste telle qu'on
   * l'a quittée. Le premier passage a lieu après `ngOnInit`, donc après la restauration.
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
   * Avant le premier chargement et le premier rendu : `daf-filter` ne lit `initialValues`
   * qu'une fois, et le tableau ne lit son tri (`delegatedSort`) qu'à sa création.
   */
  private restoreState(): void {
    const s = this.listState.restore();
    if (!s) return;
    this.searchText.set(s.searchText);
    this.paysFilter.set(s.paysFilter);
    this.statusFilter.set(s.statusFilter);
    this.departmentFilter.set(s.departmentFilter);
    this.contractFilter.set(s.contractFilter);
    this.viewMode.set(s.viewMode ?? 'grid');
    this.employeeSort.set(s.employeeSort);
    this.page.set(s.page);
    this.pageSize.set(s.pageSize ?? 20);
  }

  ngOnInit(): void {
    this.restoreState();
    this.payrollApi.listPayrollPays()
      .pipe(catchError(() => of([] as PaysDto[])))
      .subscribe(list => this.paysList.set(list));
    this.hrService.getFilterOptions().subscribe(o => this.filterOptions.set(o));
    this.loadContractTypes();
    this.load();
    this.loadKpis();
  }

  /** Choix du filtre « Type de contrat » : la liste configurable RH « Type de contrat »
   *  (/rh/admin?tab=lists), valeurs globales + celles du pays filtré, actives seulement. */
  readonly contractTypes = signal<HrContractType[]>([]);
  private contractTypesSeq = 0;
  private loadContractTypes(): void {
    const current = ++this.contractTypesSeq;
    this.hrService.getContractTypes(this.paysFilter())
      .subscribe(list => { if (current === this.contractTypesSeq) this.contractTypes.set(list); });
  }

  // ── Bandeau KPI ─────────────────────────────────────────────────────────────
  // Tout le périmètre filtré (pays, statut, département, contrat — pas la recherche texte),
  // puis les configurations enregistrées de ces collaborateurs, par paquets d'identifiants.
  /** `null` tant que rien n'est chargé, ou si un service est en échec (tuiles « — »). */
  private readonly kpiData = signal<{ staff: EmployeeListItem[]; configured: number } | null>(null);
  /** Rechargement en cours : les tuiles gardent les valeurs précédentes, estompées. */
  readonly kpiLoading = signal(false);
  private kpiSeq = 0;

  loadKpis(): void {
    const current = ++this.kpiSeq;
    this.kpiLoading.set(true);
    this.loadScope({}).pipe(
      map(({ staff, saved }) => ({ staff, configured: staff.filter(e => e.userId in saved).length })),
      catchError(() => of(null)),
    ).subscribe(d => {
      if (current !== this.kpiSeq) return;
      this.kpiData.set(d);
      this.kpiLoading.set(false);
    });
  }

  // ── Filtre « Type de contrat » ──────────────────────────────────────────────
  // La liste affiche le contrat de la configuration paie quand elle existe, sinon celui de la
  // fiche RH. Le filtre doit porter sur ce contrat affiché : le service RH, lui, ne connaît
  // que celui de la fiche (un collaborateur CDI côté RH mais « Stage » en paie sortait sous
  // « CDI »). Avec ce filtre, le périmètre est donc chargé en entier, recoupé ici, puis paginé
  // localement — même recette que les filtres Période / Collaborateurs de /payroll/engine-results.

  /** Anciens codes RH → codes de paie, pour comparer « PERMANENT » et « CDI » comme un seul contrat. */
  private static readonly LEGACY_CONTRACT: Record<string, string> = {
    PERMANENT: 'CDI', FIXED_TERM: 'CDD', INTERN: 'STAGE',
  };
  private static normContract(code: string | null | undefined): string | null {
    const c = code?.trim().toUpperCase();
    return c ? (EmployeeConfigListComponent.LEGACY_CONTRACT[c] ?? c) : null;
  }

  /** userId → contrat enregistré en paie, par paquets (la liste passe dans l'URL). */
  private savedContracts(ids: number[]): Observable<Record<number, string>> {
    const chunks: Observable<Record<number, string>>[] = [];
    for (let i = 0; i < ids.length; i += CONTRACT_TYPES_CHUNK) {
      chunks.push(this.configService.getSavedContractTypes(ids.slice(i, i + CONTRACT_TYPES_CHUNK)));
    }
    return chunks.length
      ? forkJoin(chunks).pipe(map(parts => Object.assign({}, ...parts.map(p => p ?? {}))))
      : of({});
  }

  /**
   * Tout le périmètre des filtres RH (pays, statut, département — le contrat n'est PAS envoyé
   * au service RH) puis, s'il y a un filtre contrat, seulement ceux dont le contrat affiché
   * correspond. `extra` : recherche texte et tri pour la liste, rien pour les KPI.
   */
  private loadScope(extra: { search?: string; sort?: string | null }):
      Observable<{ staff: EmployeeListItem[]; saved: Record<number, string> }> {
    return this.hrService.listEmployees({
      ...extra,
      paysId: this.paysFilter(),
      status: this.statusFilter() ?? undefined,
      department: this.departmentFilter(),
      page: 0,
      size: ALL_EMPLOYEES,
    }).pipe(
      map(p => p.content ?? []),
      switchMap(all => this.savedContracts(all.map(e => e.userId)).pipe(map(saved => {
        const wanted = EmployeeConfigListComponent.normContract(this.contractFilter());
        const staff = wanted
          ? all.filter(e => EmployeeConfigListComponent.normContract(saved[e.userId] ?? e.contractType) === wanted)
          : all;
        return { staff, saved };
      }))),
    );
  }

  private num(n: number, digits = 0): string {
    return new Intl.NumberFormat(this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR',
      { maximumFractionDigits: digits }).format(n);
  }

  /** Les quatre tuiles — TOUJOURS affichées : « — » tant que rien n'est chargé. */
  readonly kpiTiles = computed((): KpiTile[] => {
    const d = this.kpiData();
    if (!d) {
      const empty = '—';
      return [
        { label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_EMPLOYEES'),  value: empty, delta: null, options: { icon: 'groups' } },
        { label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_CONFIGURED'), value: empty, delta: null, options: { icon: 'task_alt' } },
        { label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_MISSING'),    value: empty, delta: null, options: { icon: 'person_alert' } },
        { label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_COUNTRIES'),  value: empty, delta: null, options: { icon: 'public' } },
      ];
    }
    const total = d.staff.length;
    const configured = Math.min(d.configured, total);
    const missing = total - configured;
    const departments = new Set(d.staff.map(e => e.department).filter(Boolean)).size;
    const countries = new Set(d.staff.map(e => e.paysLabel).filter(Boolean)).size;
    const pct = total > 0 ? this.num(configured / total * 100, 1) : null;
    return [
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_EMPLOYEES'),
        value: this.num(total),
        delta: departments
          ? { value: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_EMPLOYEES_SUB', { count: departments }), direction: 'neutral' }
          : null,
        options: { icon: 'groups', help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_EMPLOYEES_HELP') },
      },
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_CONFIGURED'),
        value: `${this.num(configured)} / ${this.num(total)}`,
        delta: pct != null
          ? { value: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_CONFIGURED_SUB', { pct }), direction: 'neutral' }
          : null,
        options: { icon: 'task_alt', valueColor: 'text-primary', help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_CONFIGURED_HELP') },
      },
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_MISSING'),
        value: this.num(missing),
        delta: {
          value: this.t(missing > 0 ? 'PAYROLL.EMPLOYEE_CONFIG.KPI_MISSING_SUB' : 'PAYROLL.EMPLOYEE_CONFIG.KPI_ALL_CONFIGURED'),
          direction: 'neutral',
        },
        options: {
          ...(missing > 0
            ? { valueColor: 'text-warning', icon: 'person_alert', iconColor: 'text-warning', iconBg: 'bg-warning/10' }
            : { valueColor: 'text-success', icon: 'verified', iconColor: 'text-success', iconBg: 'bg-success/10' }),
          help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_MISSING_HELP'),
        },
      },
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_COUNTRIES'),
        value: this.num(countries),
        delta: null,
        // Dernière tuile de la rangée : l'aide s'ouvre vers le haut (pas de débordement).
        options: { icon: 'public', help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_COUNTRIES_HELP'), helpPlacement: 'top' },
      },
    ];
  });

  /** Une requête à chaque changement de recherche/filtre/page ; les réponses d'une
   *  requête dépassée sont ignorées (`seq`). */
  private seq = 0;
  load(): void {
    const current = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    const size = this.pageSize();
    // Sans filtre contrat : pagination serveur. Avec : périmètre entier recoupé sur le
    // contrat affiché (voir `loadScope()`), puis découpé en pages ici.
    const page$: Observable<{ content: EmployeeListItem[]; totalElements: number; totalPages: number;
                              saved?: Record<number, string> }> = !this.contractFilter()
      ? this.hrService.listEmployees({
          search: this.searchText(),
          paysId: this.paysFilter(),
          status: this.statusFilter() ?? undefined,
          department: this.departmentFilter(),
          page: this.page(),
          size,
          sort: this.employeeSortParam(),
        })
      : this.loadScope({ search: this.searchText(), sort: this.employeeSortParam() }).pipe(map(({ staff, saved }) => {
          const start = this.page() * size;
          return {
            content: staff.slice(start, start + size),
            totalElements: staff.length,
            totalPages: Math.ceil(staff.length / size),
            saved,
          };
        }));
    page$.subscribe({
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
        if (p.saved) this.payrollContracts.set(p.saved);
        else this.loadPayrollContracts(current, (p.content ?? []).map(e => e.userId));
        this.totalElements.set(p.totalElements ?? 0);
        this.totalPages.set(Math.max(1, p.totalPages ?? 1));
        this.loading.set(false);
      },
      error: e => {
        if (current !== this.seq) return;
        this.employees.set([]);
        this.error.set(e?.error?.message ?? this.t('PAYROLL.EMPLOYEE_CONFIG.EMPLOYEE_LIST_ERROR'));
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

  readonly viewOptions = computed<ToolbarToggleOption[]>(() => [
    { id: 'grid', icon: 'grid_view',  tooltip: this.t('PAYROLL.ENGINE_RESULTS.VIEW_GRID') },
    { id: 'list', icon: 'table_rows', tooltip: this.t('PAYROLL.ENGINE_RESULTS.VIEW_LIST') },
  ]);

  readonly filterFields = computed<FilterField[]>(() => [{
    name: 'pays',
    label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_PAYS'),
    type: 'select',
    searchable: true,
    placeholder: this.t('PAYROLL.ENGINE_RESULTS.FILTER_ALL'),
    options: this.paysList().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})` })),
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
    // Liste RH « Type de contrat » (/rh/admin?tab=lists), dans son ordre et avec ses libellés.
    // Valeur = code ramené au code de paie, comparé au contrat affiché (voir `loadScope()`).
    // Un ancien code et son code de paie (« PERMANENT » / « CDI ») ne donnent qu'un choix.
    options: this.contractTypes()
      .map(c => ({
        value: EmployeeConfigListComponent.normContract(c.code)!,
        label: this.translate.currentLang() === 'en' ? (c.labelEn || c.labelFr) : c.labelFr,
      }))
      .filter((o, i, all) => all.findIndex(x => x.value === o.value) === i),
  }]);

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.ENGINE_RESULTS.FILTER_EMPLOYEES_TITLE'),
    applyLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_RESET'),
    triggerLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_TRIGGER'),
    initialValues: {
      pays:       this.paysFilter() != null ? [String(this.paysFilter())] : [],
      status:     this.statusFilter() ? [this.statusFilter()!] : [],
      department: this.departmentFilter() ? [this.departmentFilter()!] : [],
      contract:   this.contractFilter() ? [EmployeeConfigListComponent.normContract(this.contractFilter())!] : [],
    },
  }));

  applyFilters(result: FilterResult): void {
    const raw = result['pays'] as string | null;
    const paysChanged = (raw ? Number(raw) : null) !== this.paysFilter();
    this.paysFilter.set(raw ? Number(raw) : null);
    // Les types de contrat dépendent du pays (valeurs globales + celles du pays).
    if (paysChanged) this.loadContractTypes();
    this.statusFilter.set((result['status'] as string | null) || null);
    this.departmentFilter.set((result['department'] as string | null) || null);
    this.contractFilter.set((result['contract'] as string | null) || null);
    this.page.set(0);
    this.load();
    this.loadKpis();
  }

  private statusVariant(s: string): BadgeVariant {
    switch (s) {
      case 'ACTIVE':     return 'success';
      case 'TERMINATED':
      case 'ARCHIVED':   return 'neutral';
      default:           return 'warning';
    }
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

  private initials(fullName: string): string {
    return fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  }

  readonly employeeColumns = computed<TableColumn[]>(() => [
    { key: 'name',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_EMPLOYEE'),   sortable: true },
    { key: 'matricule',  label: this.t('PAYROLL.ENGINE_RESULTS.COL_MATRICULE'),  sortable: true },
    { key: 'department', label: this.t('PAYROLL.ENGINE_RESULTS.COL_DEPARTMENT'), sortable: true },
    { key: 'contract',   label: this.t('PAYROLL.ENGINE_RESULTS.COL_CONTRACT'),   sortable: true },
    { key: 'pays',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_PAYS'),       sortable: true },
    { key: 'status',     label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_STATUS'), type: 'badge', sortable: true },
    // État de la configuration de paie : pas une colonne du service RH, donc pas triable.
    { key: 'config',     label: this.t('PAYROLL.EMPLOYEE_CONFIG.COL_CONFIG'),    type: 'badge' },
  ]);

  /**
   * Tri serveur : la liste est paginée par le service RH, la lib ne trie donc pas elle-même
   * (`manualSort`). Colonne du tableau → clé acceptée par `GET /api/hr/profiles/employees`
   * (`EmployeeProfileService.EMPLOYEE_SORT_COLUMNS` côté RH) — même table que
   * `/payroll/engine-results`.
   */
  private static readonly EMPLOYEE_SORT_KEY: Record<string, string> = {
    name:       'fullName',
    matricule:  'employeeId',
    department: 'department',
    contract:   'contractType',
    pays:       'pays',
    status:     'lifecycleStatus',
  };

  readonly employeeSort = signal<TableSort | null>(null);

  onEmployeeSort(event: Parameters<typeof toTableSort>[0]): void {
    this.employeeSort.set(toTableSort(event));
    this.page.set(0);
    this.load();
  }

  /** En cas d'échec, la liste garde le contrat de la fiche RH (et « — » pour la configuration). */
  private loadPayrollContracts(seq: number, userIds: number[]): void {
    this.payrollContracts.set(null);
    if (!userIds.length) { this.payrollContracts.set({}); return; }
    this.configService.getSavedContractTypes(userIds)
      .pipe(catchError(() => of(null)))
      .subscribe(map => { if (seq === this.seq) this.payrollContracts.set(map); });
  }

  private employeeSortParam(): string | null {
    const sort = this.employeeSort();
    const key = sort ? EmployeeConfigListComponent.EMPLOYEE_SORT_KEY[sort.key] : undefined;
    return sort && key ? `${key},${sort.dir}` : null;
  }

  /** Contrat de la config paie s'il a été enregistré, sinon celui de la fiche RH — en clair
   *  (« CDI » pour PERMANENT…), comme /payroll/engine-results. */
  private contractOf(e: EmployeeListItem): string {
    const contract = this.payrollContracts()?.[e.userId] ?? e.contractType;
    return contract ? contractTypeLabel(contract, this.translate) : '—';
  }

  /** `true` / `false` une fois les configurations de la page connues, `null` avant (ou en échec). */
  private isConfigured(e: EmployeeListItem): boolean | null {
    const payroll = this.payrollContracts();
    return payroll ? e.userId in payroll : null;
  }

  private configLabel(configured: boolean): string {
    return this.t(configured ? 'PAYROLL.EMPLOYEE_CONFIG.CONFIG_SAVED' : 'PAYROLL.EMPLOYEE_CONFIG.CONFIG_MISSING');
  }

  readonly employeeRows = computed<TableRow[]>(() =>
    this.employees().map(e => {
      const configured = this.isConfigured(e);
      return {
        id:         e.userId,
        name:       e.fullName,
        matricule:  e.employeeId ?? '—',
        department: e.department ?? '—',
        contract:   this.contractOf(e),
        pays:       e.paysLabel ?? '—',
        status:     e.lifecycleStatus
          ? {
              label: this.lifecycleLabel(e.lifecycleStatus),
              options: { variant: this.statusVariant(e.lifecycleStatus), size: 'sm', dot: true },
            } satisfies BadgeCell
          : '—',
        config:     configured == null ? '—' : {
          label: this.configLabel(configured),
          options: { variant: configured ? 'success' : 'warning', size: 'sm', dot: true },
        } satisfies BadgeCell,
      };
    }),
  );

  /** Cartes : mêmes métriques que /payroll/engine-results (l'état de la configuration n'est
   *  que dans le tableau). */
  readonly employeeCards = computed(() =>
    this.employees().map(e => {
      return {
        id: e.userId,
        options: {
          clickable: true,
          image: { initials: this.initials(e.fullName) },
          metadata: {
            title: e.fullName,
            ...(e.lifecycleStatus
              ? { status: this.entityStatus(e.lifecycleStatus), statusLabel: this.lifecycleLabel(e.lifecycleStatus) }
              : {}),
          },
          metricsColumns: 2,
          metrics: [
            { label: this.t('PAYROLL.ENGINE_RESULTS.COL_MATRICULE'),  value: e.employeeId ?? '—' },
            { label: this.t('PAYROLL.ENGINE_RESULTS.COL_PAYS'),       value: e.paysLabel ?? '—' },
            { label: this.t('PAYROLL.ENGINE_RESULTS.COL_DEPARTMENT'), value: e.department ?? '—' },
            { label: this.t('PAYROLL.ENGINE_RESULTS.COL_CONTRACT'),   value: this.contractOf(e) },
          ],
          viewLabel: this.t('PAYROLL.EMPLOYEE_CONFIG.OPEN_CONFIG'),
        } satisfies EntityCardOptions,
      };
    }),
  );

  readonly tableConfig = computed<TableConfig>(() => ({
    // Pas d'en-tête de carte : sans titre, la lib n'y dessine qu'une bande vide au-dessus du tableau.
    showHeader: false, hoverable: true,
    emptyMessage: this.t('PAYROLL.ENGINE_RESULTS.EMPTY_EMPLOYEES'),
    ...tableTools(this.translate),
    ...delegatedSort(untracked(this.employeeSort)),
    actions: [{
      id: 'edit', icon: 'edit', tooltip: this.t('PAYROLL.EMPLOYEE_CONFIG.OPEN_CONFIG'),
      onClick: row => this.open(row['id']),
    }],
  }));

  open(userId: number): void {
    const e = this.employees().find(x => x.userId === userId);
    if (e) rememberEmployee(e);
    this.router.navigate([userId], { relativeTo: this.route });
  }
}
