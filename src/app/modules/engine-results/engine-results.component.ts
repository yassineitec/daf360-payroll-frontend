import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PayrollEngineService, RunPayrollResponse } from '../../core/payroll-engine.service';
import { EmployeeProfileDetail, HrProfileService } from '../../core/hr-profile.service';
import { recallEmployee } from './engine-results-employee';
import {
  AvatarComponent,
  ButtonComponent,
  CardComponent,
  DataTableComponent,
  EntityCardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  PaginationComponent,
  SearchToolbarComponent,
  SectionCardComponent,
  SectionTitleComponent,
  StatusBadgeComponent,
  TabsComponent,
  type BadgeVariant,
  type BreadcrumbItem,
  type EntityCardOptions,
  type FilterField,
  type FilterResult,
  type SearchToolbarFilterConfig,
  type TableColumn,
  type TableRow,
  type ToolbarToggleOption,
} from '@khalilrebhiitec/daf360';

type RubriqueCategory = 'GAIN' | 'RETENUE' | 'AVANTAGE';

/** Une ligne libellé / valeur de la carte « Détails ». */
interface DetailRow { label: string; value: string; }
interface DetailSection { id: string; title: string; rows: DetailRow[]; }

/** Codes de la liste RH `MARITAL_STATUS` (configurable en base) → clé de traduction ;
 *  un code inconnu s'affiche tel quel. */
const MARITAL_KEYS: Record<string, string> = {
  SINGLE: 'SINGLE', CELIBATAIRE: 'SINGLE',
  MARRIED: 'MARRIED', MARIE: 'MARRIED',
  DIVORCED: 'DIVORCED', DIVORCE: 'DIVORCED',
  WIDOWED: 'WIDOWED', VEUF: 'WIDOWED',
};

const RUBRIQUE_TABS: { id: RubriqueCategory; label: string }[] = [
  { id: 'GAIN',     label: 'Rémunération de base & forfait' },
  { id: 'RETENUE',  label: 'Cotisations & retenues' },
  { id: 'AVANTAGE', label: 'Primes & avantages' },
];

/**
 * `/payroll/engine-results/:employeeId` — historique des résultats de paie réels d'un
 * collaborateur (résultats calculés par le moteur, détail par rubrique — tout via les
 * vraies API). On y arrive depuis l'annuaire `/payroll/engine-results`
 * (`EngineResultsListComponent`), qui a remplacé l'ancien sélecteur employé du header.
 * Jusqu'au 2026-09-23 cette page portait aussi un second onglet "Simulations candidats",
 * déplacé vers `/payroll/candidate-simulation` : les deux volets sont désormais deux pages
 * distinctes reliées dans le sous-menu "Historique de paie" de la sidebar plutôt que deux
 * onglets d'un même écran.
 *
 * Présentation du détail : carte "hero" (net à payer + convergence, même traitement que
 * `engine-run`) et décomposition par nature de rubrique en onglets, affichée en pleine
 * largeur sous la liste des périodes (plus de layout master-detail 35/65 — même mise en
 * page pleine page que `/payroll/candidate-simulation`, avec sa propre barre
 * recherche/filtre/carte-tableau).
 */
@Component({
  selector: 'app-engine-results',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    AvatarComponent, ButtonComponent, CardComponent, DataTableComponent, EntityCardComponent,
    MetricCardComponent, PageComponent, PageHeaderComponent, PaginationComponent,
    SearchToolbarComponent, SectionCardComponent, SectionTitleComponent, StatusBadgeComponent, TabsComponent,
  ],
  templateUrl: './engine-results.component.html',
  styleUrl: './engine-results.component.scss',
})
export class EngineResultsComponent {
  private readonly engineApi  = inject(PayrollEngineService);
  private readonly translate  = inject(TranslateService);
  private readonly router     = inject(Router);
  private readonly route      = inject(ActivatedRoute);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  /** `userId` RH du collaborateur, pris dans l'URL — la même clé que `getResults`. */
  readonly employeeId = Number(this.route.snapshot.paramMap.get('employeeId'));
  /** Fiche transmise par la liste ; `null` si la page est ouverte directement par lien. */
  readonly employee = signal(recallEmployee(this.employeeId));
  readonly employeeName = computed(() =>
    this.employee()?.fullName ?? this.t('PAYROLL.ENGINE_RESULTS.EMPLOYEE_FALLBACK', { id: this.employeeId }));

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.ENGINE_RESULTS.BREADCRUMB'), link: '/payroll/engine-results' },
    { label: this.employeeName() },
  ]);

  constructor() {
    if (Number.isFinite(this.employeeId) && this.employeeId > 0) {
      this.loadEmployeeResults();
      this.loadProfile();
    } else {
      this.backToList();
    }
  }

  // ── Carte « Détails » (colonne gauche, comme /finance/affaires/:id) ──────
  // Fiche RH complète, lue par `profileId`. Celui-ci vient de la liste (sessionStorage) :
  // une page ouverte directement par lien n'en a pas, la carte se limite alors au nom.
  private readonly hrApi = inject(HrProfileService);
  readonly profile = signal<EmployeeProfileDetail | null>(null);
  readonly profileLoading = signal(false);

  private loadProfile(): void {
    const profileId = this.employee()?.profileId;
    if (!profileId) return;
    this.profileLoading.set(true);
    this.hrApi.getProfile(profileId).subscribe({
      next: p  => { this.profile.set(p); this.profileLoading.set(false); },
      // Carte en mode dégradé (données de la liste) — l'historique de paie reste utilisable.
      error: () => this.profileLoading.set(false),
    });
  }

  readonly photoSrc = computed(() => this.hrApi.photoSrc(this.profile()?.photoUrl));
  readonly matricule = computed(() => this.profile()?.matricule ?? this.employee()?.employeeId ?? null);

  readonly lifecycle = computed(() => {
    const s = this.profile()?.lifecycleStatus ?? this.employee()?.lifecycleStatus;
    if (!s) return null;
    const key = `PAYROLL.ENGINE_RESULTS.LIFECYCLE.${s}`;
    const label = this.t(key);
    const variant: BadgeVariant = s === 'ACTIVE' ? 'success'
      : (s === 'TERMINATED' || s === 'ARCHIVED') ? 'neutral' : 'warning';
    return { label: label === key ? s : label, variant };
  });

  readonly detailSections = computed<DetailSection[]>(() => {
    const p = this.profile();
    const e = this.employee();
    const row = (key: string, value: string | number | null | undefined): DetailRow | null =>
      value == null || value === '' ? null : { label: this.t(`PAYROLL.ENGINE_RESULTS.DETAILS.${key}`), value: String(value) };
    const section = (id: string, rows: (DetailRow | null)[]): DetailSection => ({
      id, title: this.t(`PAYROLL.ENGINE_RESULTS.DETAILS.SECTION_${id}`), rows: rows.filter((r): r is DetailRow => !!r),
    });

    return [
      section('CONTRACT', [
        row('CONTRACT_TYPE', p?.contractType ?? e?.contractType),
        row('HIRE_DATE', this.formatDate(p?.hireDate)),
        row('SENIORITY', this.seniority(p?.hireDate)),
        row('CONTRACT_END', this.formatDate(p?.contractEndDate)),
        row('PROBATION_END', p?.isOnProbation ? this.formatDate(p?.probationEndDate) : null),
        row('REGIME', p?.regimeLabelFr),
      ]),
      section('POSITION', [
        row('DEPARTMENT', p?.department ?? e?.department),
        row('GRADE', p?.grade),
        row('DISCIPLINE', p?.discipline),
        row('NOG_LEVEL', p?.nogLevel),
        row('PAYS', p?.paysLabel ?? e?.paysLabel),
      ]),
      section('PAYROLL', [
        row('MARITAL_STATUS', this.maritalLabel(p?.maritalStatus)),
        row('CHILDREN', p?.numberOfChildren),
        row('CNSS', p?.cnssNumber),
        row('CNSS_DATE', this.formatDate(p?.cnssAffiliationDate)),
      ]),
    ].filter(s => s.rows.length > 0);
  });

  private formatDate(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR',
      { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** « 3 ans 4 mois » depuis la date d'embauche. */
  private seniority(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const start = new Date(iso);
    if (Number.isNaN(start.getTime())) return null;
    const now = new Date();
    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (now.getDate() < start.getDate()) months--;
    if (months < 0) return null;
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const parts: string[] = [];
    if (years) parts.push(this.t('PAYROLL.ENGINE_RESULTS.DETAILS.YEARS', { count: years }));
    if (rest || !years) parts.push(this.t('PAYROLL.ENGINE_RESULTS.DETAILS.MONTHS', { count: rest }));
    return parts.join(' ');
  }

  private maritalLabel(code: string | null | undefined): string | null {
    if (!code) return null;
    const key = MARITAL_KEYS[code.toUpperCase()];
    return key ? this.t(`PAYROLL.ENGINE_RESULTS.DETAILS.MARITAL.${key}`) : code;
  }

  backToList(): void {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  // ── résultats du collaborateur ───────────────────────────────────────
  readonly empLoading  = signal(false);
  readonly empError    = signal<string | null>(null);
  readonly empSearched = signal(false);
  readonly results     = signal<RunPayrollResponse[]>([]);
  readonly expandedResult = signal<number | null>(null);

  readonly expandedResultDetail = computed(() =>
    this.results().find(r => r.resultId === this.expandedResult()) ?? null,
  );

  readonly employeeKpis = computed(() => {
    const rows = this.results();
    return {
      totalGross:        rows.reduce((sum, r) => sum + (r.aggregateGross ?? 0), 0),
      totalNet:          rows.reduce((sum, r) => sum + (r.strate5 ?? 0), 0),
      totalLoadedCost:   rows.reduce((sum, r) => sum + (r.loadedCost ?? 0), 0),
      convergenceOkCount: rows.filter(r => r.convergenceOk).length,
      total:             rows.length,
    };
  });

  // ── Barre de recherche / filtre / bascule carte-tableau, comme `daf-search-toolbar`
  // sur /finance/affaires et /payroll/candidate-simulation ────────────────────────────
  // Une seule requête par employé (`getResults`), sans pagination côté API — la recherche
  // et le filtre retravaillent `results()` déjà chargée en mémoire ; les KPI restent
  // calculés sur la liste complète, non filtrée. Remplace l'ancien `daf-toggle`
  // "Échecs de convergence uniquement" par un vrai champ de filtre, cohérent avec le
  // reste du bandeau.
  readonly searchText = signal('');
  readonly convergenceFilter = signal<'' | 'ok' | 'failed'>('');
  readonly viewMode = signal<'grid' | 'list'>('list');

  /** Pagination façon `daf-pagination` de la bibliothèque (`/finance/affaires`) —
   *  `currentPage` y est 0-indexé, même convention reprise ici. Purement côté client :
   *  la liste est déjà entière en mémoire, donc on tranche `resultRows()`/`resultCards()`
   *  (déjà filtrés) plutôt que de re-paginer une requête serveur. */
  readonly page = signal(0);
  readonly pageSize = signal(20);

  /** `value`/`filterApply` retombent tous les deux à la première page — comme
   *  `onSearchTextChange`/`applyFilters` sur `affaires-list.component.ts`. */
  onSearchTextChange(value: string): void {
    this.searchText.set(value);
    this.page.set(0);
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(0);
  }

  readonly filteredResults = computed(() => {
    const query = this.searchText().trim().toLowerCase();
    const status = this.convergenceFilter();
    return this.results().filter(r => {
      const period = `${r.periodMonth}/${r.periodYear}`;
      const matchesQuery = !query || period.includes(query) || String(r.resultId).includes(query);
      const matchesStatus = !status || (status === 'ok' ? r.convergenceOk : !r.convergenceOk);
      return matchesQuery && matchesStatus;
    });
  });

  readonly filterFields = computed<FilterField[]>(() => [{
    name: 'convergence',
    label: this.t('PAYROLL.ENGINE_RESULTS.COL_CONVERGENCE'),
    type: 'select',
    placeholder: this.t('PAYROLL.ENGINE_RESULTS.FILTER_ALL'),
    options: [
      { value: 'ok',     label: this.t('PAYROLL.ENGINE_RESULTS.CONVERGENCE_OK') },
      { value: 'failed', label: this.t('PAYROLL.ENGINE_RESULTS.CONVERGENCE_FAILED') },
    ],
  }]);

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.ENGINE_RESULTS.FILTER_TITLE'),
    applyLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_RESET'),
    triggerLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_TRIGGER'),
    // `daf-filter` seeds `initialValues` once, in its own internal shape — a `select`
    // field is a `string[]` there (normalizes to a scalar only on `apply`).
    initialValues: { convergence: this.convergenceFilter() ? [this.convergenceFilter()] : [] },
  }));

  applyFilters(result: FilterResult): void {
    this.convergenceFilter.set((result['convergence'] as 'ok' | 'failed' | null) ?? '');
    this.page.set(0);
  }

  readonly viewOptions = computed<ToolbarToggleOption[]>(() => [
    { id: 'list', icon: 'table_rows', tooltip: this.t('PAYROLL.ENGINE_RESULTS.VIEW_LIST') },
    { id: 'grid', icon: 'grid_view',  tooltip: this.t('PAYROLL.ENGINE_RESULTS.VIEW_GRID') },
  ]);

  /** The toolbar's own "Exporter CSV" action (`[actions]`/`(action)`), instead of a
   *  separate button row — same mechanism the type doc's canonical example uses. */
  onToolbarAction(id: string): void {
    if (id === 'export-csv') this.exportResultsCsv();
  }

  /** Vue carte — mêmes résultats/actions que le tableau, juste une autre présentation. */
  readonly resultCards = computed(() =>
    this.filteredResults().map(r => ({
      id: r.resultId,
      options: {
        clickable: true,
        metadata: {
          title: `${r.periodMonth}/${r.periodYear}`,
          subtitle: `${this.t('PAYROLL.ENGINE_RESULTS.COL_ID')} ${r.resultId}`,
          status: r.convergenceOk ? 'active' : 'inactive',
          statusLabel: this.t(r.convergenceOk ? 'PAYROLL.ENGINE_RESULTS.CONVERGENCE_OK' : 'PAYROLL.ENGINE_RESULTS.CONVERGENCE_FAILED'),
        },
        metricsColumns: 2,
        metrics: [
          { label: this.t('PAYROLL.ENGINE_RESULTS.COL_NET_PAY'),     value: (r.strate5 ?? 0).toFixed(2) },
          { label: this.t('PAYROLL.ENGINE_RESULTS.COL_LOADED_COST'), value: (r.loadedCost ?? 0).toFixed(2) },
        ],
        viewLabel: this.t('PAYROLL.ENGINE_RESULTS.DETAIL_LINK'),
      } satisfies EntityCardOptions,
    })),
  );

  exportResultsCsv(): void {
    const columns = this.resultColumns();
    const rows = this.resultRows();
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = columns.map(c => escape(c.label)).join(';');
    const body = rows.map(row => columns.map(c => {
      const cell = row[c.key];
      return escape(c.key === 'convergence' ? (cell as { label?: string })?.label : cell);
    }).join(';')).join('\n');
    const csv = String.fromCharCode(0xFEFF) + header + '\n' + body;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `engine-results-${this.employee()?.employeeId ?? this.employeeId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /** Impression navigateur du résultat actuellement déplié — pas de générateur PDF
   *  dédié, même approche que `simulator.component.ts::print()`. */
  exportResultPdf(): void { window.print(); }

  loadEmployeeResults(): void {
    const employeeId = this.employeeId;
    this.empLoading.set(true);
    this.empError.set(null);
    this.empSearched.set(false);
    this.expandedResult.set(null);
    this.page.set(0);
    this.engineApi.getResults(employeeId).subscribe({
      next: r  => { this.results.set(r); this.empLoading.set(false); this.empSearched.set(true); },
      error: e => { this.empError.set(e?.error?.message ?? this.t('PAYROLL.ENGINE_RESULTS.ERROR_GENERIC')); this.empLoading.set(false); },
    });
  }

  toggleDetail(id: number): void {
    this.expandedResult.set(this.expandedResult() === id ? null : id);
  }

  readonly resultColumns = computed<TableColumn[]>(() => [
    { key: 'resultId',     label: this.t('PAYROLL.ENGINE_RESULTS.COL_ID'), width: '70px' },
    { key: 'period',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_PERIOD') },
    { key: 'gross',        label: this.t('PAYROLL.ENGINE_RESULTS.COL_GROSS'),        type: 'number', align: 'right', format: { minimumFractionDigits: 2, maximumFractionDigits: 2 } },
    { key: 'taxableNet',   label: this.t('PAYROLL.ENGINE_RESULTS.COL_TAXABLE_NET'),  type: 'number', align: 'right', format: { minimumFractionDigits: 2, maximumFractionDigits: 2 } },
    { key: 'netPay',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_NET_PAY'),      type: 'number', align: 'right', format: { minimumFractionDigits: 2, maximumFractionDigits: 2 } },
    { key: 'irpp',         label: this.t('PAYROLL.ENGINE_RESULTS.COL_IRPP'),         type: 'number', align: 'right', format: { minimumFractionDigits: 2, maximumFractionDigits: 2 } },
    { key: 'loadedCost',   label: this.t('PAYROLL.ENGINE_RESULTS.COL_LOADED_COST'),  type: 'number', align: 'right', format: { minimumFractionDigits: 2, maximumFractionDigits: 2 } },
    { key: 'convergence',  label: this.t('PAYROLL.ENGINE_RESULTS.COL_CONVERGENCE'),  type: 'badge' },
    { key: 'calculatedAt', label: this.t('PAYROLL.ENGINE_RESULTS.COL_CALCULATED_AT'), type: 'date', format: { dateStyle: 'short', timeStyle: 'short' } },
  ]);

  readonly resultRows = computed<TableRow[]>(() =>
    this.filteredResults().map(r => ({
      id:           r.resultId,
      resultId:     r.resultId,
      period:       `${r.periodMonth}/${r.periodYear}`,
      gross:        r.aggregateGross,
      taxableNet:   r.strate4,
      netPay:       r.strate5,
      irpp:         r.aggregateIrpp,
      loadedCost:   r.loadedCost,
      convergence:  {
        label: this.t(r.convergenceOk ? 'PAYROLL.ENGINE_RESULTS.CONVERGENCE_OK' : 'PAYROLL.ENGINE_RESULTS.CONVERGENCE_FAILED'),
        options: { variant: (r.convergenceOk ? 'success' : 'danger') as BadgeVariant, size: 'sm' as const },
      },
      calculatedAt: r.calculatedAt,
    })),
  );

  /** Page courante — ce que le tableau/la grille affichent réellement. `resultRows()`
   *  reste la liste filtrée complète (pas de troncature) : `exportResultsCsv()` exporte
   *  tout ce qui correspond à la recherche/au filtre, pas seulement la page visible. */
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.resultRows().length / this.pageSize())));
  readonly pagedResultRows = computed(() => {
    const start = this.page() * this.pageSize();
    return this.resultRows().slice(start, start + this.pageSize());
  });
  readonly pagedResultCards = computed(() => {
    const start = this.page() * this.pageSize();
    return this.resultCards().slice(start, start + this.pageSize());
  });

  /** `id: 'view'` gets the library's `visibility` icon for free (`resolveActionIcon`,
   *  same convention as affaires/clients/suppliers) — the table renders the action icon
   *  only, never `label`, so the text belongs in `tooltip`. */
  readonly resultActions = computed(() => [
    { id: 'view', tooltip: this.t('PAYROLL.ENGINE_RESULTS.DETAIL_LINK'), onClick: (row: TableRow) => this.toggleDetail(row['resultId']) },
  ]);

  // ── Détail redessiné : carte hero (net à payer + convergence) + décomposition par
  // nature de rubrique en onglets — mêmes données réelles (`rubriqueDetails`), juste
  // regroupées au lieu d'un tableau plat. ──
  readonly activeRubriqueCategory = signal<RubriqueCategory>('GAIN');
  readonly rubriqueTabs = RUBRIQUE_TABS;

  readonly rubriqueLinesByCategory = computed(() => {
    const details = this.expandedResultDetail()?.rubriqueDetails ?? [];
    const bucket = (cat: RubriqueCategory) => details.filter(d => d.nature === cat);
    return {
      GAIN:     bucket('GAIN'),
      RETENUE:  bucket('RETENUE'),
      AVANTAGE: bucket('AVANTAGE'),
    };
  });

  readonly activeRubriqueLines = computed(() =>
    this.rubriqueLinesByCategory()[this.activeRubriqueCategory()] ?? []);

  natureVariant(nature: string): BadgeVariant {
    switch (nature) {
      case 'GAIN':     return 'success';
      case 'RETENUE':  return 'danger';
      case 'AVANTAGE': return 'info';
      default:         return 'neutral';
    }
  }

  natureLabel(nature: string): string {
    return this.t(`PAYROLL.ENGINE_RUN.NATURE.${nature}`);
  }
}
