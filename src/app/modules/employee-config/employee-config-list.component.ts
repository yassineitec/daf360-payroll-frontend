import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, forkJoin, map, of, type Observable } from 'rxjs';
import { HrProfileService, type EmployeeListItem } from '../../core/hr-profile.service';
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
  type BreadcrumbItem,
  type EntityCardOptions,
  type FilterField,
  type FilterResult,
  type MetricCardOptions,
  type SearchToolbarFilterConfig,
  type TableColumn,
  type TableRow,
  type ToolbarToggleOption,
} from '@khalilrebhiitec/daf360';
import { rememberEmployee } from './employee-config-employee';

/**
 * `/payroll/employee-config` — annuaire des collaborateurs (cartes ou tableau), sur le
 * modèle de `/payroll/engine-results`. Un clic ouvre `/payroll/employee-config/:userId`,
 * la configuration de paie du collaborateur (`EmployeeConfigComponent`).
 *
 * Recherche, filtre pays et pagination côté serveur (`/api/hr/profiles/employees`).
 * Le bandeau KPI ne s'appuie que sur des endpoints existants : effectifs RH par statut
 * (`size=1`, seul `totalElements` compte) et nombre de pays paie.
 */
@Component({
  selector: 'app-employee-config-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    CardComponent, DataTableComponent, EntityCardComponent, MetricCardComponent, PageComponent,
    PageHeaderComponent, PaginationComponent, SearchToolbarComponent,
  ],
  templateUrl: './employee-config-list.component.html',
  styleUrl: './employee-config-list.component.scss',
})
export class EmployeeConfigListComponent implements OnInit {
  private readonly hrService  = inject(HrProfileService);
  private readonly payrollApi = inject(PayrollApiService);
  private readonly router     = inject(Router);
  private readonly route      = inject(ActivatedRoute);
  private readonly translate  = inject(TranslateService);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.EMPLOYEE_CONFIG.BREADCRUMB') },
  ]);

  readonly employees     = signal<EmployeeListItem[]>([]);
  readonly totalElements = signal(0);
  readonly totalPages    = signal(1);
  readonly loading       = signal(false);
  readonly error         = signal<string | null>(null);

  readonly searchText = signal('');
  readonly paysFilter = signal<number | null>(null);
  readonly viewMode   = signal<'grid' | 'list'>('grid');
  /** 0-indexé, comme `daf-pagination`. */
  readonly page     = signal(0);
  readonly pageSize = signal(20);

  private readonly paysList = signal<PaysDto[]>([]);

  ngOnInit(): void {
    this.payrollApi.listPays()
      .pipe(catchError(() => of([] as PaysDto[])))
      .subscribe(list => this.paysList.set(list));
    this.load();
    this.loadKpis();
  }

  // ── Bandeau KPI ──────────────────────────────────────────────────────
  // Suit le filtre pays, pas la recherche texte. `null` = pas encore chargé ou en échec.
  readonly kpis = signal<{ inPost: number | null; active: number | null; away: number | null } | null>(null);
  readonly kpiLoading = signal(false);
  private kpiSeq = 0;

  private count(status?: string): Observable<number | null> {
    return this.hrService.listEmployees({ paysId: this.paysFilter(), status, page: 0, size: 1 }).pipe(
      map(p => p.totalElements ?? 0),
      catchError(() => of(null)),
    );
  }

  loadKpis(): void {
    const current = ++this.kpiSeq;
    this.kpiLoading.set(true);
    forkJoin({
      inPost:    this.count(),
      active:    this.count('ACTIVE'),
      onLeave:   this.count('ON_LEAVE'),
      onMission: this.count('ON_MISSION'),
    }).subscribe(r => {
      if (current !== this.kpiSeq) return;
      this.kpis.set({
        inPost: r.inPost,
        active: r.active,
        away: r.onLeave == null && r.onMission == null ? null : (r.onLeave ?? 0) + (r.onMission ?? 0),
      });
      this.kpiLoading.set(false);
    });
  }

  /** Les quatre tuiles — TOUJOURS affichées : « — » tant que rien n'est chargé. */
  readonly kpiTiles = computed(() => {
    const k = this.kpis();
    const show = (v: number | null | undefined) => (v == null ? '—' : v);
    const paysCount = this.paysList().length;
    return [
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_IN_POST'),
        value: show(k?.inPost),
        options: {
          icon: 'groups',
          helpTitle: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_IN_POST'),
          help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_IN_POST_HELP'),
        },
      },
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_ACTIVE'),
        value: show(k?.active),
        options: {
          valueColor: 'text-success', icon: 'task_alt', iconColor: 'text-success', iconBg: 'bg-success/10',
          helpTitle: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_ACTIVE'),
          help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_ACTIVE_HELP'),
        },
      },
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_AWAY'),
        value: show(k?.away),
        options: {
          icon: 'flight_takeoff',
          helpTitle: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_AWAY'),
          help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_AWAY_HELP'),
        },
      },
      {
        label: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_PAYS'),
        value: paysCount || '—',
        options: {
          valueColor: 'text-primary', icon: 'public',
          helpTitle: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_PAYS'),
          help: this.t('PAYROLL.EMPLOYEE_CONFIG.KPI_PAYS_HELP'),
        },
      },
    ] satisfies { label: string; value: string | number; options: MetricCardOptions }[];
  });

  /** Une requête à chaque changement de recherche/filtre/page ; les réponses d'une
   *  requête dépassée sont ignorées (`seq`). */
  private seq = 0;
  load(): void {
    const current = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    this.hrService.listEmployees({
      search: this.searchText(),
      paysId: this.paysFilter(),
      page: this.page(),
      size: this.pageSize(),
    }).subscribe({
      next: p => {
        if (current !== this.seq) return;
        this.employees.set(p.content ?? []);
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

  readonly filterFields = computed<FilterField[]>(() => [{
    name: 'pays',
    label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_PAYS'),
    type: 'select',
    searchable: true,
    placeholder: this.t('PAYROLL.ENGINE_RESULTS.FILTER_ALL'),
    options: this.paysList().map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})` })),
  }]);

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.ENGINE_RESULTS.FILTER_EMPLOYEES_TITLE'),
    applyLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_RESET'),
    triggerLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_TRIGGER'),
    initialValues: { pays: this.paysFilter() != null ? [String(this.paysFilter())] : [] },
  }));

  applyFilters(result: FilterResult): void {
    const raw = result['pays'] as string | null;
    this.paysFilter.set(raw ? Number(raw) : null);
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
          subtitle: [e.department, e.contractType].filter(Boolean).join(' · '),
          ...(e.lifecycleStatus
            ? { status: this.entityStatus(e.lifecycleStatus), statusLabel: this.lifecycleLabel(e.lifecycleStatus) }
            : {}),
        },
        metricsColumns: 2,
        metrics: [
          { label: this.t('PAYROLL.ENGINE_RESULTS.COL_MATRICULE'), value: e.employeeId ?? '—' },
          { label: this.t('PAYROLL.ENGINE_RESULTS.COL_PAYS'),      value: e.paysLabel ?? '—' },
        ],
        viewLabel: this.t('PAYROLL.EMPLOYEE_CONFIG.OPEN_CONFIG'),
      } satisfies EntityCardOptions,
    })),
  );

  readonly employeeColumns = computed<TableColumn[]>(() => [
    { key: 'name',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_EMPLOYEE') },
    { key: 'matricule',  label: this.t('PAYROLL.ENGINE_RESULTS.COL_MATRICULE') },
    { key: 'department', label: this.t('PAYROLL.ENGINE_RESULTS.COL_DEPARTMENT') },
    { key: 'contract',   label: this.t('PAYROLL.ENGINE_RESULTS.COL_CONTRACT') },
    { key: 'pays',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_PAYS') },
  ]);

  readonly employeeRows = computed<TableRow[]>(() =>
    this.employees().map(e => ({
      id:         e.userId,
      name:       e.fullName,
      matricule:  e.employeeId ?? '—',
      department: e.department ?? '—',
      contract:   e.contractType ?? '—',
      pays:       e.paysLabel ?? '—',
    })),
  );

  readonly employeeActions = computed(() => [
    { id: 'edit', icon: 'edit', tooltip: this.t('PAYROLL.EMPLOYEE_CONFIG.OPEN_CONFIG'), onClick: (row: TableRow) => this.open(row['id']) },
  ]);

  open(userId: number): void {
    const e = this.employees().find(x => x.userId === userId);
    if (e) rememberEmployee(e);
    this.router.navigate([userId], { relativeTo: this.route });
  }
}
