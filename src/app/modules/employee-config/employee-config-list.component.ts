import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import {
  HrProfileService, LIFECYCLE_STATUSES, contractTypeLabel, departmentFilterOptions,
  type EmployeeFilterOptions, type EmployeeListItem,
} from '../../core/hr-profile.service';
import { PayrollApiService, type PaysDto } from '../../core/payroll-api.service';
import {
  DataTableComponent,
  PageComponent,
  PageHeaderComponent,
  SearchToolbarComponent,
  type BadgeCell,
  type BadgeVariant,
  type BreadcrumbItem,
  type FilterField,
  type FilterResult,
  type SearchToolbarFilterConfig,
  type TableColumn,
  type TableConfig,
  type TableRow,
} from '@khalilrebhiitec/daf360';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from '../parameter-sets/admin/admin-section-header.component';
import { AdminSpinnerComponent, AdminTableFooterComponent } from '../parameter-sets/admin/admin-section-kit';
import { rememberEmployee } from './employee-config-employee';
import { TableSort, delegatedSort, tableTools, toTableSort } from '../../shared/table-tools';
import { PaysNamesService } from '../../core/pays-names.service';

/**
 * `/payroll/employee-config` — « Salaires des collaborateurs », ouverte depuis sa carte de
 * l'administration paie et présentée comme ses autres sections (et celles de /rh/admin) :
 * en-tête de section, tableau, « N collaborateurs » + pagination. Un clic ouvre `/payroll/employee-config/:userId`,
 * la configuration de paie du collaborateur (`EmployeeConfigComponent`).
 *
 * Recherche, filtres et pagination côté serveur (`/api/hr/profiles/employees`).
 */
@Component({
  selector: 'app-employee-config-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    AdminSectionHeaderComponent, AdminSpinnerComponent, AdminTableFooterComponent,
    DataTableComponent, PageComponent, PageHeaderComponent, SearchToolbarComponent,
  ],
  templateUrl: './employee-config-list.component.html',
  styles: [ADMIN_SECTION_STYLES],
  styleUrls: ['./employee-config-list.component.scss'],
})
export class EmployeeConfigListComponent implements OnInit {
  private readonly hrService  = inject(HrProfileService);
  private readonly payrollApi = inject(PayrollApiService);
  private readonly router     = inject(Router);
  private readonly route      = inject(ActivatedRoute);
  private readonly translate  = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  /** La page s'ouvre depuis sa carte de l'administration (plus d'entrée dans la barre
   *  latérale) : le fil d'Ariane y ramène. */
  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.ADMIN_HOME.TITLE'), link: '/payroll/admin' },
    { label: this.t('PAYROLL.EMPLOYEE_CONFIG.BREADCRUMB') },
  ]);

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
  /** 0-indexé, comme `daf-pagination`. */
  readonly page     = signal(0);
  /** 10 lignes par page : les sections admin en affichent 5, trop peu pour un annuaire. */
  readonly pageSize = signal(10);

  private readonly paysList = signal<PaysDto[]>([]);
  private readonly filterOptions = signal<EmployeeFilterOptions | null>(null);

  ngOnInit(): void {
    this.payrollApi.listPays()
      .pipe(catchError(() => of([] as PaysDto[])))
      .subscribe(list => this.paysList.set(list));
    this.hrService.getFilterOptions().subscribe(o => this.filterOptions.set(o));
    this.load();
  }

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
      status: this.statusFilter() ?? undefined,
      department: this.departmentFilter(),
      contract: this.contractFilter(),
      page: this.page(),
      size: this.pageSize(),
      sort: this.employeeSortParam(),
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
    options: (this.filterOptions()?.contractTypes ?? []).map(c => ({ value: c, label: contractTypeLabel(c, this.translate) })),
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
  }

  private statusVariant(s: string): BadgeVariant {
    switch (s) {
      case 'ACTIVE':     return 'success';
      case 'TERMINATED':
      case 'ARCHIVED':   return 'neutral';
      default:           return 'warning';
    }
  }

  private lifecycleLabel(s: string): string {
    const key = `PAYROLL.ENGINE_RESULTS.LIFECYCLE.${s}`;
    const label = this.t(key);
    return label === key ? s : label;
  }

  readonly employeeColumns = computed<TableColumn[]>(() => [
    { key: 'name',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_EMPLOYEE'),   sortable: true },
    { key: 'matricule',  label: this.t('PAYROLL.ENGINE_RESULTS.COL_MATRICULE'),  sortable: true },
    { key: 'department', label: this.t('PAYROLL.ENGINE_RESULTS.COL_DEPARTMENT'), sortable: true },
    { key: 'contract',   label: this.t('PAYROLL.ENGINE_RESULTS.COL_CONTRACT'),   sortable: true },
    { key: 'pays',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_PAYS'),       sortable: true },
    { key: 'status',     label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_STATUS'), type: 'badge', sortable: true },
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

  private employeeSortParam(): string | null {
    const sort = this.employeeSort();
    const key = sort ? EmployeeConfigListComponent.EMPLOYEE_SORT_KEY[sort.key] : undefined;
    return sort && key ? `${key},${sort.dir}` : null;
  }

  readonly employeeRows = computed<TableRow[]>(() =>
    this.employees().map(e => ({
      id:         e.userId,
      name:       e.fullName,
      matricule:  e.employeeId ?? '—',
      department: e.department ?? '—',
      contract:   e.contractType ?? '—',
      pays:       e.paysLabel ?? '—',
      status:     e.lifecycleStatus
        ? {
            label: this.lifecycleLabel(e.lifecycleStatus),
            options: { variant: this.statusVariant(e.lifecycleStatus), size: 'sm', dot: true },
          } satisfies BadgeCell
        : '—',
    })),
  );

  readonly tableConfig = computed<TableConfig>(() => ({
    // Pas d'en-tête de carte : sans titre, la lib n'y dessine qu'une bande vide au-dessus du tableau.
    showHeader: false, hoverable: true,
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
