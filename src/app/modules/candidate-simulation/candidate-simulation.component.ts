import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { CandidateSimulationService, CandidateSimulationSummaryDto } from '../../core/candidate-simulation.service';
import { CandidateSimulationListStateService } from './candidate-simulation-list-state.service';
import {
  DataTableComponent,
  CardComponent,
  EntityCardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  PaginationComponent,
  SearchToolbarComponent,
  SkeletonComponent,
  type BadgeVariant,
  type EntityCardOptions,
  type FilterField,
  type FilterResult,
  type SearchToolbarFilterConfig,
  type SelectOption,
  type TableColumn,
  type TableConfig,
  type TableRow,
  type ToolbarToggleOption,
  type MetricDelta,
} from '@khalilrebhiitec/daf360';
import { environment } from '../../../environments/environment';
import { UserStore } from '../../core/user.store';
import { dayRange, distinctSorted, inDayRange, pickValue, rangeSeed } from '../../shared/filter-utils';
import { TableSort, delegatedSort, sortTableRows, tableTools, toTableSort } from '../../shared/table-tools';
import { PaysNamesService } from '../../core/pays-names.service';

interface PaysItem { id: number; iso_code: string; french_label: string; }

/**
 * `/payroll/candidate-simulation` — historique des simulations de rémunération soumises
 * pour des candidats (recherche par pays, liste, puis historique de négociation par
 * candidat), extrait de `engine-results` où il vivait comme second onglet ("Simulations
 * candidats") jusqu'au 2026-09-23 : les deux volets sont désormais deux pages distinctes,
 * celle-ci rangée dans le groupe « Simulation » de la sidebar. Mêmes données/API
 * réelles qu'avant, seul le point d'entrée change.
 */
@Component({
  selector: 'app-candidate-simulation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    CardComponent, DataTableComponent, EntityCardComponent,
    MetricCardComponent, PageComponent, PageHeaderComponent, PaginationComponent,
    SearchToolbarComponent, SkeletonComponent,
  ],
  templateUrl: './candidate-simulation.component.html',
  styleUrl: './candidate-simulation.component.scss',
})
export class CandidateSimulationComponent implements OnInit {
  private readonly candSvc   = inject(CandidateSimulationService);
  private readonly http      = inject(HttpClient);
  private readonly translate = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);
  private readonly userStore = inject(UserStore);
  private readonly listState = inject(CandidateSimulationListStateService);
  private readonly router    = inject(Router);
  private readonly route     = inject(ActivatedRoute);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly candidatePaysId   = signal<number | null>(null);
  readonly candLoading       = signal(false);
  readonly candError         = signal<string | null>(null);
  readonly candSearched      = signal(false);
  readonly candidateList     = signal<CandidateSimulationSummaryDto[]>([]);
  private readonly paysList  = signal<PaysItem[]>([]);
  /** TOUS les pays du référentiel RH ; celui du profil est pré-sélectionné (`ngOnInit`). */
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.french_label)} (${p.iso_code})` })),
  );
  /** Chiffres des 4 tuiles — sur la liste complète du pays (pas la recherche / les filtres). */
  readonly candidateKpis = computed(() => {
    const list = this.candidateList();
    const total = list.length;
    const approved = list.filter(c => c.latestStatus === 'APPROVED').length;
    const pendingList = list.filter(c => c.latestStatus === 'PENDING');
    // Plus ancienne proposition encore en attente : depuis combien de jours.
    const oldest = pendingList.map(c => Date.parse(c.latestSubmittedAt)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    // Écart demandé / proposé : seulement les candidats qui ont les deux nets.
    const gaps = list
      .filter(c => c.salaireNetCandidat != null && c.salaireNetRh != null && c.salaireNetRh > 0)
      .map(c => (c.salaireNetCandidat! - c.salaireNetRh!) / c.salaireNetRh! * 100);
    return {
      total,
      approved,
      totalSimulations: list.reduce((sum, c) => sum + (c.simulationCount ?? 0), 0),
      approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
      pending: pendingList.length,
      oldestPendingDays: oldest == null ? null : Math.max(0, Math.floor((Date.now() - oldest) / 86_400_000)),
      gapPct: gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null,
      gapCount: gaps.length,
    };
  });

  /** « la plus ancienne : il y a 9 jours » — depuis quand la DAF a du travail en attente. */
  readonly pendingDelta = computed((): MetricDelta => {
    const k = this.candidateKpis();
    const value = !k.pending ? this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_KPI_PENDING_NONE')
      : k.oldestPendingDays == null ? ''
      : k.oldestPendingDays === 0 ? this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_KPI_PENDING_TODAY')
      : this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_KPI_PENDING_OLDEST', { days: k.oldestPendingDays });
    return { value, direction: 'neutral' };
  });

  /** « 8 sur 13 candidats » — la base du pourcentage. */
  readonly approvalDelta = computed((): MetricDelta | null => {
    const k = this.candidateKpis();
    return k.total ? { value: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_KPI_APPROVAL_BASE', { approved: k.approved, total: k.total }), direction: 'neutral' } : null;
  });

  /** Écart moyen entre le net demandé et le net proposé par la RH, en %. */
  readonly gapValue = computed(() => {
    const g = this.candidateKpis().gapPct;
    if (g == null) return '—';
    const n = new Intl.NumberFormat(this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: 1 }).format(Math.abs(g));
    return `${g > 0 ? '+' : g < 0 ? '−' : ''}${n} %`;
  });
  readonly gapDelta = computed((): MetricDelta => {
    const k = this.candidateKpis();
    return {
      value: k.gapCount
        ? this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_KPI_GAP_BASE', { count: k.gapCount })
        : this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_KPI_GAP_NONE'),
      direction: 'neutral',
    };
  });

  /** « 21 propositions envoyées » sous le nombre de candidats. */
  readonly totalDelta = computed((): MetricDelta | null => {
    const k = this.candidateKpis();
    return k.total ? { value: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_KPI_SIMULATIONS_SUB', { count: k.totalSimulations }), direction: 'neutral' } : null;
  });

  // ── Barre de recherche / filtre / bascule carte-tableau, comme `daf-search-toolbar` sur
  // /finance/affaires ──────────────────────────────────────────────────────────────────
  // Une seule requête par pays (`getCandidatesWithHistory`), sans pagination côté API —
  // contrairement à affaires-list (recherche/filtre server-side avec re-fetch), la
  // recherche et le filtre ici retravaillent `candidateList()` déjà chargée en mémoire ;
  // les KPI restent calculés sur la liste complète, non filtrée.
  readonly searchText = signal('');
  readonly statusFilter = signal('');
  readonly positionFilter = signal<string | null>(null);
  readonly locationFilter = signal<string | null>(null);
  /** Plage « Dernière soumission » telle qu'émise par le panneau (`Date[]`). */
  readonly submittedFilter = signal<Date[] | null>(null);
  /** Cartes par défaut, comme /finance/affaires et /payroll/simulator ; le tableau reste
   *  au choix dans la barre de recherche. */
  readonly viewMode = signal<'grid' | 'list'>('grid');

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
    const position = this.positionFilter();
    const location = this.locationFilter();
    const submitted = dayRange(this.submittedFilter());
    return this.candidateList().filter(c => {
      const matchesQuery = !query
        || `${c.firstName} ${c.lastName}`.toLowerCase().includes(query)
        || (c.appliedPosition ?? '').toLowerCase().includes(query);
      const matchesStatus = !status || c.latestStatus === status;
      return matchesQuery && matchesStatus
        && (!position || c.appliedPosition === position)
        && (!location || c.candidateLocation === location)
        && inDayRange(c.latestSubmittedAt, submitted);
    });
  });

  /** Pays + statut + poste/localisation/date dans le même bouton filtre. Le pays est chargé
   *  côté serveur (un changement relance `loadCandidates()`), le reste filtre la liste déjà
   *  en mémoire — poste et localisation proposent les valeurs présentes dans cette liste. */
  readonly filterFields = computed<FilterField[]>(() => [{
    name: 'pays',
    label: this.t('PAYROLL.CANDIDATE_SIMULATION.PAYS_SELECT_LABEL'),
    type: 'select',
    searchable: true,
    placeholder: this.t('PAYROLL.CANDIDATE_SIMULATION.PAYS_SELECT_PLACEHOLDER'),
    options: this.paysOptions(),
  }, {
    name: 'status',
    label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_STATUS'),
    type: 'select',
    placeholder: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_ALL'),
    options: (['PENDING', 'APPROVED', 'REJECTED'] as const).map(s => ({ value: s, label: this.statusLabel(s) })),
  }, {
    name: 'position',
    label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_POSITION'),
    type: 'select',
    searchable: true,
    placeholder: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_ALL'),
    options: distinctSorted(this.candidateList().map(c => c.appliedPosition)).map(p => ({ value: p, label: p })),
  }, {
    name: 'location',
    label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_ENTITY'),
    type: 'select',
    searchable: true,
    placeholder: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_ALL'),
    options: distinctSorted(this.candidateList().map(c => c.candidateLocation)).map(l => ({ value: l, label: l })),
  }, {
    name: 'submitted',
    label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_LATEST'),
    type: 'daterange',
  }]);

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_TITLE'),
    applyLabel: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_RESET'),
    triggerLabel: this.t('PAYROLL.CANDIDATE_SIMULATION.FILTER_TRIGGER'),
    // `daf-filter` seeds `initialValues` once, in its own internal shape — a `select`
    // field is a `string[]` there (normalizes to a scalar only on `apply`).
    initialValues: {
      pays:   this.candidatePaysId() ? [String(this.candidatePaysId())] : [],
      status: this.statusFilter() ? [this.statusFilter()] : [],
      position:  this.positionFilter() ? [this.positionFilter()!] : [],
      location:  this.locationFilter() ? [this.locationFilter()!] : [],
      submitted: this.submittedFilter(),
    },
  }));

  applyFilters(result: FilterResult): void {
    this.statusFilter.set((result['status'] as string | null) ?? '');
    this.positionFilter.set(pickValue(result, 'position'));
    this.locationFilter.set(pickValue(result, 'location'));
    this.submittedFilter.set(rangeSeed(result['submitted']));
    this.page.set(0);
    const raw = result['pays'] as string | null;
    const paysId = raw ? Number(raw) : null;
    if (paysId !== this.candidatePaysId()) {
      this.candidatePaysId.set(paysId);
      this.loadCandidates();
    }
  }

  /** Message de la liste vide : pas encore de pays, chargement, ou pays sans candidat. */
  readonly emptyMessage = computed(() => {
    if (!this.candidatePaysId()) return this.t('PAYROLL.CANDIDATE_SIMULATION.NO_PAYS_SELECTED');
    if (this.candLoading())      return this.t('PAYROLL.COMMON.LOADING');
    if (this.candidateList().length === 0) return this.t('PAYROLL.CANDIDATE_SIMULATION.EMPTY_CANDIDATES');
    return this.t('PAYROLL.CANDIDATE_SIMULATION.EMPTY_FILTERED');
  });

  /** Cartes puis tableau — même ordre que toutes les listes de la facturation. */
  readonly viewOptions = computed<ToolbarToggleOption[]>(() => [
    { id: 'grid', icon: 'grid_view',  tooltip: this.t('PAYROLL.CANDIDATE_SIMULATION.VIEW_GRID') },
    { id: 'list', icon: 'table_rows', tooltip: this.t('PAYROLL.CANDIDATE_SIMULATION.VIEW_LIST') },
  ]);

  /** Vue carte — mêmes candidats/actions que le tableau, juste une autre présentation. */
  readonly candidateCards = computed(() =>
    this.filteredCandidates().map(c => ({
      id: c.candidateId,
      options: {
        // Même carte que /finance/affaires : vitrée et sans `image` — la lib ne dessine
        // alors pas de pastille d'avatar et le titre prend toute la largeur.
        variant: 'glass',
        clickable: true,
        metadata: {
          title: `${c.firstName} ${c.lastName}`,
          subtitle: [c.appliedPosition, c.candidateLocation].filter(Boolean).join(' · '),
          status: this.entityStatus(c.latestStatus),
          statusLabel: this.statusLabel(c.latestStatus),
        },
        // 1re rangée : la négociation (net RH, net demandé, écart) ; 2e : le suivi.
        metricsColumns: 3,
        metrics: [
          { label: this.t('PAYROLL.CANDIDATE_SIMULATION.CARD_NET_RH'),    value: this.amount(c.salaireNetRh) },
          { label: this.t('PAYROLL.CANDIDATE_SIMULATION.CARD_NET_ASKED'), value: this.amount(c.salaireNetCandidat) },
          { label: this.t('PAYROLL.CANDIDATE_SIMULATION.CARD_GAP'),       value: this.gap(c.salaireNetRh, c.salaireNetCandidat) },
          { label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_SIMULATIONS'), value: String(c.simulationCount) },
          { label: this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.LAST_SUBMISSION'), value: this.shortDate(c.latestSubmittedAt) },
        ],
        viewLabel: this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL_LINK'),
      } satisfies EntityCardOptions,
    })),
  );

  private numberLocale(): string {
    return (this.translate.currentLang() ?? '').startsWith('en') ? 'en-US' : 'fr-FR';
  }

  /** Montant sans décimales (« 1 600 ») ; « — » si absent. La devise n'est pas dans le
   *  résumé : c'est celle du pays filtré, la même pour toute la liste. */
  private amount(v: number | null | undefined): string {
    return v == null ? '—' : new Intl.NumberFormat(this.numberLocale(), { maximumFractionDigits: 0 }).format(v);
  }

  /** Écart demandé / proposé en % du net RH, en phrase : « Demande +12,5 % » (le candidat
   *  veut plus), « Demande −5 % » (moins) ; « — » s'il manque un des deux. */
  private gap(netRh: number | null | undefined, asked: number | null | undefined): string {
    const pct = this.gapPct(netRh, asked);
    if (pct == null) return '—';
    const fmt = new Intl.NumberFormat(this.numberLocale(), { maximumFractionDigits: 1 }).format(Math.abs(pct));
    return this.t('PAYROLL.CANDIDATE_SIMULATION.GAP_TEXT', { sign: pct > 0 ? '+' : pct < 0 ? '−' : '', pct: fmt });
  }

  private gapPct(netRh: number | null | undefined, asked: number | null | undefined): number | null {
    return !netRh || asked == null ? null : (asked - netRh) / netRh * 100;
  }

  /** Date courte dans la langue active (jj/mm/aaaa en français) ; « — » si absente. */
  private shortDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const locale = (this.translate.currentLang() ?? '').startsWith('en') ? 'en-US' : 'fr-FR';
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(d);
  }

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

    // Retour depuis une fiche : on retrouve la liste telle qu'on l'a laissée (pays, filtres,
    // tri, page, vue). La liste est réaffichée tout de suite puis rechargée, au cas où une
    // décision serait tombée entre-temps.
    const saved = this.listState.restore();
    if (saved) {
      this.candidatePaysId.set(saved.paysId);
      this.searchText.set(saved.searchText);
      this.statusFilter.set(saved.statusFilter);
      this.positionFilter.set(saved.positionFilter);
      this.locationFilter.set(saved.locationFilter);
      this.submittedFilter.set(saved.submittedFilter);
      this.candidateSort.set(saved.sort);
      this.pageSize.set(saved.pageSize);
      this.viewMode.set(saved.viewMode);
      this.candidateList.set(saved.candidates);
      this.loadCandidates();
      this.page.set(saved.page);
      return;
    }

    // Pays pré-sélectionné = celui du profil de l'utilisateur connecté (ex. admin Tunisie →
    // Tunisie) et la recherche part aussitôt ; il reste modifiable dans le bouton filtre
    // (`applyFilters`). Sans pays sur le profil, la page reste à l'état vide.
    const userPaysId = this.userStore.currentUser()?.paysId;
    if (userPaysId) {
      this.candidatePaysId.set(userPaysId);
      this.loadCandidates();
    }
  }

  loadCandidates(): void {
    const paysId = this.candidatePaysId();
    if (!paysId) {
      // Pays retiré du filtre : la page revient à son état vide (KPI à 0, liste vide).
      this.candidateList.set([]);
      this.candSearched.set(false);
      this.candError.set(null);
      return;
    }
    this.candLoading.set(true);
    this.candError.set(null);
    this.candSearched.set(false);
    this.page.set(0);
    this.candSvc.getCandidatesWithHistory(paysId).subscribe({
      next: list => { this.candidateList.set(list); this.candLoading.set(false); this.candSearched.set(true); },
      error: e   => {
        this.candidateList.set([]);
        this.candError.set(e?.error?.message ?? this.t('PAYROLL.CANDIDATE_SIMULATION.ERROR_CANDIDATES'));
        this.candLoading.set(false);
      },
    });
  }

  readonly candidateColumns = computed<TableColumn[]>(() => [
    // Colonne candidat en `avatar` (initiales + nom), comme l'exemple de la bibliothèque.
    { key: 'name',        label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_NAME'), type: 'avatar', sortable: true },
    { key: 'position',    label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_POSITION'), sortable: true },
    { key: 'entity',      label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_ENTITY'), sortable: true },
    // La négociation, comme sur les cartes : net proposé, net demandé, écart.
    { key: 'netRh',       label: this.t('PAYROLL.CANDIDATE_SIMULATION.CARD_NET_RH'), align: 'right', sortable: true,
      sortAccessor: row => row['_netRh'] as number },
    { key: 'asked',       label: this.t('PAYROLL.CANDIDATE_SIMULATION.CARD_NET_ASKED'), align: 'right', sortable: true,
      sortAccessor: row => row['_asked'] as number },
    { key: 'gap',         label: this.t('PAYROLL.CANDIDATE_SIMULATION.CARD_GAP'), sortable: true,
      sortAccessor: row => row['_gap'] as number },
    { key: 'simulations', label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_SIMULATIONS'), type: 'number', sortable: true },
    { key: 'latest',      label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_LATEST'), type: 'date', format: { dateStyle: 'short' }, sortable: true },
    { key: 'status',      label: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_STATUS'), type: 'badge', sortable: true },
  ]);

  /**
   * Tri d'en-tête. La liste arrive entière en un appel puis est paginée ici : le tri porte
   * sur tout le jeu filtré AVANT la découpe (`sortTableRows`), et la config passe
   * `manualSort` pour que la lib ne retrie pas la seule page affichée.
   */
  readonly candidateSort = signal<TableSort | null>(null);

  onCandidateSort(event: Parameters<typeof toTableSort>[0]): void {
    this.candidateSort.set(toTableSort(event));
    this.page.set(0);
  }

  /** Outils de tableau communs (`tableTools`), comme sur `/finance/affaires`. */
  /** Vue tableau uniquement (undefined en vue cartes) — passé au `[table]` de la barre pour placer
   *  réinitialiser + choix des colonnes à droite de Filtres. */
  readonly candidateTable = viewChild(DataTableComponent);

  readonly candidateTableConfig = computed<TableConfig>(() => ({
    actions: this.candidateActions(),
    emptyMessage: this.emptyMessage(),
    hoverable: true,
    ...tableTools(this.translate, 'candidateId'),
    ...delegatedSort(untracked(this.candidateSort)),
  }));

  readonly candidateRows = computed<TableRow[]>(() =>
    this.filteredCandidates().map(c => ({
      id:            c.candidateId,
      candidateId:   c.candidateId,
      name:          { name: `${c.firstName} ${c.lastName}` },
      position:      c.appliedPosition || '—',
      entity:        c.candidateLocation || '—',
      netRh:         this.amount(c.salaireNetRh),
      _netRh:        c.salaireNetRh ?? null,
      asked:         this.amount(c.salaireNetCandidat),
      _asked:        c.salaireNetCandidat ?? null,
      gap:           this.gap(c.salaireNetRh, c.salaireNetCandidat),
      _gap:          this.gapPct(c.salaireNetRh, c.salaireNetCandidat),
      simulations:   c.simulationCount,
      latest:        c.latestSubmittedAt,
      status:        { label: this.statusLabel(c.latestStatus), options: { variant: this.statusVariant(c.latestStatus), size: 'sm' as const } },
    })),
  );

  /** Page courante — ce que le tableau/la grille affichent réellement. */
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.candidateRows().length / this.pageSize())));
  readonly pagedCandidateRows = computed(() => {
    const start = this.page() * this.pageSize();
    return sortTableRows(this.candidateRows(), this.candidateColumns(), this.candidateSort())
      .slice(start, start + this.pageSize());
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
   *  to the table's `candidateActions`. Ouvre la fiche `/payroll/candidate-simulation/:id`
   *  après avoir mémorisé la liste, que « Retour à la liste » retrouve telle quelle. */
  openCandidateById(candidateId: number): void {
    this.listState.save({
      paysId:          this.candidatePaysId(),
      searchText:      this.searchText(),
      statusFilter:    this.statusFilter(),
      positionFilter:  this.positionFilter(),
      locationFilter:  this.locationFilter(),
      submittedFilter: this.submittedFilter(),
      sort:            this.candidateSort(),
      page:            this.page(),
      pageSize:        this.pageSize(),
      viewMode:        this.viewMode(),
      candidates:      this.candidateList(),
    });
    this.router.navigate([candidateId], { relativeTo: this.route });
  }

  statusLabel(s: string): string { return this.t(`PAYROLL.CANDIDATE_SIMULATION.STATUS.${s}`); }

  statusVariant(s: string): BadgeVariant {
    switch (s) {
      case 'APPROVED': return 'success';
      case 'REJECTED': return 'danger';
      default:         return 'warning';
    }
  }
}
