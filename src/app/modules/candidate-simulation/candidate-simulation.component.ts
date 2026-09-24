import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { CandidateSimulationService, CandidateSimulationSummaryDto, CandidateCostApprovalDto } from '../../core/candidate-simulation.service';
import { UserStore } from '../../core/user.store';
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
  SelectComponent,
  StatusBadgeComponent,
  type BadgeVariant,
  type BreadcrumbItem,
  type EntityCardOptions,
  type FilterField,
  type FilterResult,
  type SearchToolbarFilterConfig,
  type SelectOption,
  type TableColumn,
  type TableRow,
  type ToolbarToggleOption,
} from '@khalilrebhiitec/daf360';
import { environment } from '../../../environments/environment';

interface PaysItem { id: number; iso_code: string; french_label: string; }

/**
 * `/payroll/candidate-simulation` — historique des simulations de rémunération soumises
 * pour des candidats (recherche par pays, liste, puis historique de négociation par
 * candidat), extrait de `engine-results` où il vivait comme second onglet ("Simulations
 * candidats") jusqu'au 2026-09-23 : les deux volets sont désormais deux pages distinctes,
 * regroupées dans le sous-menu "Historique de paie" de la sidebar. Mêmes données/API
 * réelles qu'avant, seul le point d'entrée change.
 */
@Component({
  selector: 'app-candidate-simulation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    AvatarComponent, ButtonComponent, CardComponent, DataTableComponent, EntityCardComponent,
    MetricCardComponent, PageComponent, PageHeaderComponent, PaginationComponent,
    SearchToolbarComponent, SelectComponent, StatusBadgeComponent,
  ],
  templateUrl: './candidate-simulation.component.html',
  styleUrl: './candidate-simulation.component.scss',
})
export class CandidateSimulationComponent implements OnInit {
  private readonly candSvc   = inject(CandidateSimulationService);
  private readonly http      = inject(HttpClient);
  private readonly translate = inject(TranslateService);
  private readonly userStore = inject(UserStore);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.CANDIDATE_SIMULATION.BREADCRUMB') },
  ]);

  /** Pays du profil de l'utilisateur connecté — pré-sélectionne le select en haut de page
   *  et déclenche la première recherche, comme dans daf360-rh-frontend (ex.
   *  `candidate-form.component.ts`, `candidates.component.ts`) où le même
   *  `userStore.currentUser()?.paysId` filtre déjà par défaut sur le pays de l'utilisateur. */
  readonly myPaysId = computed(() => this.userStore.currentUser()?.paysId ?? null);

  readonly candidatePaysId   = signal<number | null>(null);
  readonly candLoading       = signal(false);
  readonly candError         = signal<string | null>(null);
  readonly candSearched      = signal(false);
  readonly candidateList     = signal<CandidateSimulationSummaryDto[]>([]);
  readonly selectedCandidate = signal<CandidateSimulationSummaryDto | null>(null);
  readonly histLoading       = signal(false);
  readonly history           = signal<CandidateCostApprovalDto[]>([]);
  private readonly paysList  = signal<PaysItem[]>([]);
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${p.french_label} (${p.iso_code})` })),
  );
  /**
   * Compact, bordered "button-style" trigger — same idea as the country picker on
   * `/finance/admin` (`app-pays-flag-select`), without flags: `fullWidth: false` drops
   * the trigger's forced full-width sizing (see `pays-trigger` in the template, which no
   * longer stretches the select via `flex-1`), so it sits at content width like the page's
   * other buttons instead of spanning the filter row. No `imageUrl` on `paysOptions()` —
   * flags are a real, supported `SelectOption` field, deliberately left unset.
   *
   * No `label`: the select now lives in `daf-page-header`'s `pageActions` slot, next to
   * the title — same spot as "Nouvelle affaire" on `/finance/affaires` — where a floating
   * caption above the trigger would look out of place next to a plain action button. The
   * label text still reaches screen readers via `[ariaLabel]` on the template's `<daf-select>`.
   */
  readonly paysSelectConfig = computed(() => ({
    placeholder: this.t('PAYROLL.CANDIDATE_SIMULATION.PAYS_SELECT_PLACEHOLDER'),
    searchable: true,
    fullWidth: false,
    // Pas de bouton "Rechercher" pour empêcher un second choix pendant que la requête
    // du précédent est encore en vol — le select se réactive une fois la réponse reçue.
    disabled: this.candLoading(),
  }));

  readonly candidateKpis = computed(() => {
    const list = this.candidateList();
    const total = list.length;
    const approved = list.filter(c => c.latestStatus === 'APPROVED').length;
    return {
      total,
      totalSimulations: list.reduce((sum, c) => sum + (c.simulationCount ?? 0), 0),
      approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
      pending: list.filter(c => c.latestStatus === 'PENDING').length,
    };
  });

  // ── Barre de recherche / filtre / bascule carte-tableau, comme `daf-search-toolbar` sur
  // /finance/affaires ──────────────────────────────────────────────────────────────────
  // Une seule requête par pays (`getCandidatesWithHistory`), sans pagination côté API —
  // contrairement à affaires-list (recherche/filtre server-side avec re-fetch), la
  // recherche et le filtre ici retravaillent `candidateList()` déjà chargée en mémoire ;
  // les KPI restent calculés sur la liste complète, non filtrée.
  readonly searchText = signal('');
  readonly statusFilter = signal('');
  readonly viewMode = signal<'grid' | 'list'>('list');

  /** Pagination façon `daf-pagination` de la bibliothèque (`/finance/affaires`) —
   *  `currentPage` y est 0-indexé (`goToPage`/`pageChange.emit` n'appliquent aucun
   *  décalage), même convention reprise ici. Purement côté client : la liste est déjà
   *  entière en mémoire, donc on tranche `candidateRows()`/`candidateCards()` (déjà
   *  filtrés) plutôt que de re-paginer une requête serveur. */
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

  readonly filteredCandidates = computed(() => {
    const query = this.searchText().trim().toLowerCase();
    const status = this.statusFilter();
    return this.candidateList().filter(c => {
      const matchesQuery = !query
        || `${c.firstName} ${c.lastName}`.toLowerCase().includes(query)
        || (c.appliedPosition ?? '').toLowerCase().includes(query);
      const matchesStatus = !status || c.latestStatus === status;
      return matchesQuery && matchesStatus;
    });
  });

  readonly filterFields = computed<FilterField[]>(() => [{
    name: 'status',
    label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_STATUS'),
    type: 'select',
    placeholder: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_ALL'),
    options: (['PENDING', 'APPROVED', 'REJECTED'] as const).map(s => ({ value: s, label: this.statusLabel(s) })),
  }]);

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_TITLE'),
    applyLabel: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_RESET'),
    triggerLabel: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_TRIGGER'),
    // `daf-filter` seeds `initialValues` once, in its own internal shape — a `select`
    // field is a `string[]` there (normalizes to a scalar only on `apply`).
    initialValues: { status: this.statusFilter() ? [this.statusFilter()] : [] },
  }));

  applyFilters(result: FilterResult): void {
    this.statusFilter.set((result['status'] as string | null) ?? '');
    this.page.set(0);
  }

  readonly viewOptions = computed<ToolbarToggleOption[]>(() => [
    { id: 'list', icon: 'table_rows', tooltip: this.t('PAYROLL.CANDIDATE_SIMULATION.VIEW_LIST') },
    { id: 'grid', icon: 'grid_view',  tooltip: this.t('PAYROLL.CANDIDATE_SIMULATION.VIEW_GRID') },
  ]);

  /** Vue carte — mêmes candidats/actions que le tableau, juste une autre présentation. */
  readonly candidateCards = computed(() =>
    this.filteredCandidates().map(c => ({
      id: c.candidateId,
      options: {
        clickable: true,
        image: { initials: `${c.firstName?.[0] ?? ''}${c.lastName?.[0] ?? ''}`.toUpperCase() || '?' },
        metadata: {
          title: `${c.firstName} ${c.lastName}`,
          subtitle: [c.appliedPosition, c.candidateLocation].filter(Boolean).join(' · '),
          status: this.entityStatus(c.latestStatus),
          statusLabel: this.statusLabel(c.latestStatus),
        },
        metricsColumns: 2,
        metrics: [
          { label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_SIMULATIONS'), value: String(c.simulationCount) },
        ],
        viewLabel: this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL_LINK'),
      } satisfies EntityCardOptions,
    })),
  );

  private entityStatus(s: string): 'active' | 'inactive' | 'pending' {
    switch (s) {
      case 'APPROVED': return 'active';
      case 'REJECTED': return 'inactive';
      default:         return 'pending';
    }
  }

  ngOnInit(): void {
    this.http.get<PaysItem[]>(`${environment.hrApiUrl}/api/hr/config/hs/pays-list`)
      .pipe(catchError(() => of([] as PaysItem[])))
      .subscribe(list => this.paysList.set(list));

    // Pré-sélectionne le pays du profil connecté et lance la recherche tout de suite —
    // le select reste modifiable pour consulter un autre pays ensuite.
    const myPaysId = this.myPaysId();
    if (myPaysId) {
      this.candidatePaysId.set(myPaysId);
      this.loadCandidates();
    }
  }

  /** Pas de bouton "Rechercher" : choisir un pays dans le select déclenche la recherche
   *  directement. */
  onPaysChange(selected: string[]): void {
    const paysId = selected[0] ? Number(selected[0]) : null;
    this.candidatePaysId.set(paysId);
    if (paysId) this.loadCandidates();
  }

  loadCandidates(): void {
    const paysId = this.candidatePaysId();
    if (!paysId) return;
    this.candLoading.set(true);
    this.candError.set(null);
    this.candSearched.set(false);
    this.selectedCandidate.set(null);
    this.page.set(0);
    this.candSvc.getCandidatesWithHistory(paysId).subscribe({
      next: list => { this.candidateList.set(list); this.candLoading.set(false); this.candSearched.set(true); },
      error: e   => {
        this.candError.set(e?.error?.message ?? this.t('PAYROLL.CANDIDATE_SIMULATION.ERROR_CANDIDATES'));
        this.candLoading.set(false);
      },
    });
  }

  readonly candidateColumns = computed<TableColumn[]>(() => [
    { key: 'name',        label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_NAME') },
    { key: 'position',    label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_POSITION') },
    { key: 'entity',      label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_ENTITY') },
    { key: 'simulations', label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_SIMULATIONS'), align: 'center' },
    { key: 'latest',      label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_LATEST'), type: 'date', format: { dateStyle: 'short' } },
    { key: 'status',      label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_STATUS'), type: 'badge' },
  ]);

  readonly candidateRows = computed<TableRow[]>(() =>
    this.filteredCandidates().map(c => ({
      id:            c.candidateId,
      candidateId:   c.candidateId,
      name:          `${c.firstName} ${c.lastName}`,
      position:      c.appliedPosition || '—',
      entity:        c.candidateLocation || '—',
      simulations:   c.simulationCount,
      latest:        c.latestSubmittedAt,
      status:        { label: this.statusLabel(c.latestStatus), options: { variant: this.statusVariant(c.latestStatus), size: 'sm' as const } },
    })),
  );

  /** Page courante — ce que le tableau/la grille affichent réellement. */
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.candidateRows().length / this.pageSize())));
  readonly pagedCandidateRows = computed(() => {
    const start = this.page() * this.pageSize();
    return this.candidateRows().slice(start, start + this.pageSize());
  });
  readonly pagedCandidateCards = computed(() => {
    const start = this.page() * this.pageSize();
    return this.candidateCards().slice(start, start + this.pageSize());
  });

  /** `id: 'view'` gets the library's `visibility` icon for free (`resolveActionIcon`,
   *  same convention as affaires/clients/suppliers) — the table renders the action icon
   *  only, never `label`, so the text belongs in `tooltip`. */
  readonly candidateActions = computed(() => [
    { id: 'view', tooltip: this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL_LINK'), onClick: (row: TableRow) => this.openCandidateById(row['candidateId']) },
  ]);

  /** Public: bound directly from the card grid's `(cardClick)`/`(viewClick)`, in addition
   *  to the table's `candidateActions`. */
  openCandidateById(candidateId: number): void {
    const c = this.candidateList().find(x => x.candidateId === candidateId);
    if (c) this.openCandidate(c);
  }

  openCandidate(c: CandidateSimulationSummaryDto): void {
    this.selectedCandidate.set(c);
    this.history.set([]);
    this.histLoading.set(true);
    this.candSvc.getCandidateHistory(c.candidateId).subscribe({
      next: h  => { this.history.set(h); this.histLoading.set(false); },
      error: () => this.histLoading.set(false),
    });
  }

  snap(sim: CandidateCostApprovalDto) {
    return this.candSvc.parseSnapshot(sim.simulationSnapshot);
  }

  statusLabel(s: string): string { return this.t(`PAYROLL.CANDIDATE_SIMULATION.STATUS.${s}`); }

  statusVariant(s: string): BadgeVariant {
    switch (s) {
      case 'APPROVED': return 'success';
      case 'REJECTED': return 'danger';
      default:         return 'warning';
    }
  }

  dotClass(s: string): string {
    switch (s) {
      case 'APPROVED': return 'bg-secondary';
      case 'REJECTED': return 'bg-danger';
      default:         return 'bg-tertiary';
    }
  }
}
