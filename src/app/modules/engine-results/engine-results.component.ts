import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PayrollEngineService, RunPayrollResponse } from '../../core/payroll-engine.service';
import { PayrollApiService, PaysDto } from '../../core/payroll-api.service';
import { EmployeeProfileDetail, HrProfileService, contractTypeLabel } from '../../core/hr-profile.service';
import { recallEmployee } from './engine-results-employee';
import { EngineResultDetailComponent } from './engine-result-detail.component';
import {
  AvatarComponent,
  CardComponent,
  DataTableComponent,
  EntityCardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  PaginationComponent,
  SearchToolbarComponent,
  SectionCardComponent,
  StatusBadgeComponent,
  type BreadcrumbItem,
  type BadgeVariant,
  type EntityCardOptions,
  type FilterField,
  type FilterResult,
  type MetricDelta,
  type SearchToolbarFilterConfig,
  type TableColumn,
  type TableConfig,
  type TableRow,
  type ToolbarToggleOption,
} from '@khalilrebhiitec/daf360';
import { dayRange, distinctSorted, inDayRange, monthName, pickValue, rangeSeed } from '../../shared/filter-utils';
import { TableSort, delegatedSort, sortTableRows, tableTools, toTableSort } from '../../shared/table-tools';

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

/**
 * `/payroll/engine-results/:employeeId` — historique des résultats de paie réels d'un
 * collaborateur (résultats calculés par le moteur, détail par rubrique — tout via les
 * vraies API). On y arrive depuis l'annuaire `/payroll/engine-results`
 * (`EngineResultsListComponent`), qui a remplacé l'ancien sélecteur employé du header.
 * Jusqu'au 2026-09-23 cette page portait aussi un second onglet "Simulations candidats",
 * déplacé vers `/payroll/candidate-simulation` : les deux volets sont désormais deux pages
 * distinctes de la sidebar plutôt que deux onglets d'un même écran (celle-ci en entrée
 * directe « Résultats de paie », l'autre dans le groupe « Simulation »).
 *
 * Le détail d'une période s'affiche dans la page, à la place de la liste
 * (`EngineResultDetailComponent`, `?result=<id>`) depuis le 2026-10-21 — plus de pop-up.
 */
@Component({
  selector: 'app-engine-results',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    AvatarComponent, CardComponent, DataTableComponent, EntityCardComponent,
    MetricCardComponent, PageComponent, PageHeaderComponent, PaginationComponent,
    SearchToolbarComponent, SectionCardComponent, StatusBadgeComponent,
    EngineResultDetailComponent,
  ],
  templateUrl: './engine-results.component.html',
  styleUrl: './engine-results.component.scss',
})
export class EngineResultsComponent {
  /** Vue tableau uniquement (undefined en vue cartes) — passé au `[table]` de la barre pour placer réinitialiser + choix des
   *  colonnes à droite de Filtres, au lieu d'au-dessus du tableau. */
  readonly table = viewChild(DataTableComponent);

  private readonly engineApi  = inject(PayrollEngineService);
  private readonly payrollApi = inject(PayrollApiService);
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

  /** Bulletin ouvert (`?result=`) : le nom du collaborateur devient un lien vers la même
   *  page SANS `?result` — c'est le retour à la liste des périodes — et la période ouverte
   *  s'ajoute en dernier élément. */
  readonly breadcrumbs = computed((): BreadcrumbItem[] => {
    const id = this.selectedResultId();
    const open = id != null ? this.results().find(r => r.resultId === id) : undefined;
    return [
      { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
      { label: this.t('PAYROLL.ENGINE_RESULTS.BREADCRUMB'), link: '/payroll/engine-results' },
      open
        ? { label: this.employeeName(), link: ['/payroll/engine-results', this.employeeId] }
        : { label: this.employeeName() },
      ...(open
        ? [{ label: `${monthName(open.periodMonth, this.translate.currentLang() ?? 'fr')} ${open.periodYear}` }]
        : []),
    ];
  });

  constructor() {
    if (Number.isFinite(this.employeeId) && this.employeeId > 0) {
      this.loadEmployeeResults();
      this.loadProfile();
      this.payrollApi.listPays().subscribe({ next: list => this.paysList.set(list), error: () => {} });
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
        row('CONTRACT_TYPE', this.contractLabel(p?.contractType ?? e?.contractType)),
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

  /** Contrat en clair (« CDI » pour PERMANENT…). */
  private contractLabel(code: string | null | undefined): string | null {
    return code ? contractTypeLabel(code, this.translate) : null;
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

  // ── Devise de l'historique — celle du pays des résultats (repli : pays du collaborateur) ──
  private readonly paysList = signal<PaysDto[]>([]);

  readonly currencyCode = computed<string | null>(() => {
    const paysId = this.results().find(r => r.paysId != null)?.paysId ?? this.employee()?.paysId ?? null;
    const devise = this.paysList().find(p => p.id === paysId)?.devise?.trim().toUpperCase();
    return devise && /^[A-Z]{3}$/.test(devise) ? devise : null;
  });

  /** Montant formaté, dans la devise quand on la connaît (« 959,840 TND »). */
  money(v: number | null | undefined): string {
    if (v == null) return '—';
    const locale = this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
    const currency = this.currencyCode();
    return new Intl.NumberFormat(locale, {
      ...(currency ? { style: 'currency', currency } : {}),
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(v);
  }

  /** « octobre 2026 ». */
  private periodText(r: RunPayrollResponse): string {
    return `${monthName(r.periodMonth, this.translate.currentLang() ?? 'fr')} ${r.periodYear}`;
  }

  // ── Doublons : le serveur AJOUTE un résultat à chaque lancement, il ne remplace pas ──
  // Pour chaque mois, le résultat le plus récent (plus grand id — insertion seule côté
  // serveur) est le « dernier calcul » ; les autres sont d'« anciens calculs », masqués par
  // défaut et exclus des indicateurs.

  /** Ids des derniers calculs, un par mois. */
  readonly latestIds = computed(() => {
    const byMonth = new Map<number, RunPayrollResponse>();
    for (const r of this.results()) {
      const key = r.periodYear * 100 + r.periodMonth;
      const cur = byMonth.get(key);
      if (!cur || r.resultId > cur.resultId) byMonth.set(key, r);
    }
    return new Set([...byMonth.values()].map(r => r.resultId));
  });

  /** Afficher aussi les anciens calculs — UNIQUEMENT par la case du panneau de filtres :
   *  `daf-filter` ne lit `initialValues` qu'une fois, un second bouton hors du panneau le
   *  désynchroniserait. */
  readonly showOld = signal(false);
  readonly oldCount = computed(() => this.results().length - this.latestIds().size);

  /**
   * Indicateurs : CUMUL d'une année, derniers calculs seulement (sans doublons). L'année
   * est celle du filtre, sinon la plus récente de l'historique. Plus de tuile « Convergence
   * OK » : le moteur ne passe jamais un calcul en échec.
   */
  readonly kpiYear = computed(() =>
    this.yearFilter() ?? (this.results().length ? Math.max(...this.results().map(r => r.periodYear)) : null));

  readonly employeeKpis = computed(() => {
    const year = this.kpiYear();
    const latest = this.latestIds();
    const rows = this.results().filter(r => latest.has(r.resultId) && r.periodYear === year);
    const totalGross = rows.reduce((sum, r) => sum + (r.aggregateGross ?? 0), 0);
    const totalNet = rows.reduce((sum, r) => sum + (r.strate5 ?? 0), 0);
    // Retenues salariales réelles : S3 = CNSS salariale + IRPP (S4).
    const totalDeductions = rows.reduce((sum, r) => sum + (r.strate3 ?? 0) + (r.aggregateIrpp ?? r.strate4 ?? 0), 0);
    // Mois manquants : de janvier jusqu'au mois en cours (toute l'année pour une année passée).
    const now = new Date();
    const upTo = year == null ? 0 : year < now.getFullYear() ? 12 : year === now.getFullYear() ? now.getMonth() + 1 : 0;
    const done = new Set(rows.map(r => r.periodMonth));
    const missing = Array.from({ length: upTo }, (_, i) => i + 1).filter(m => !done.has(m));
    return {
      year,
      totalGross,
      totalNet,
      totalDeductions,
      months: rows.length,
      avgGross: rows.length ? totalGross / rows.length : null,
      avgNet: rows.length ? totalNet / rows.length : null,
      deductionsPct: totalGross > 0 ? totalDeductions / totalGross * 100 : null,
      missing,
    };
  });

  /** Lignes sous les tuiles de cumul : moyennes mensuelles, taux de retenue, mois manquants. */
  readonly employeeKpiDeltas = computed(() => {
    const k = this.employeeKpis();
    const lang = this.translate.currentLang() ?? 'fr';
    const pct = k.deductionsPct == null ? null
      : new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: 1 }).format(k.deductionsPct);
    const d = (value: string | null): MetricDelta | null => value ? { value, direction: 'neutral' } : null;
    return {
      gross: d(k.avgGross == null ? null : this.t('PAYROLL.ENGINE_RESULTS.KPI_AVG_MONTH', { amount: this.money(k.avgGross) })),
      deductions: d(pct == null ? null : this.t('PAYROLL.ENGINE_RESULTS.KPI_DEDUCTIONS_PCT', { pct })),
      net: d(k.avgNet == null ? null : this.t('PAYROLL.ENGINE_RESULTS.KPI_AVG_MONTH', { amount: this.money(k.avgNet) })),
      months: d(k.missing.length
        ? this.t('PAYROLL.ENGINE_RESULTS.KPI_MONTHS_MISSING', { months: k.missing.map(m => monthName(m, lang)).join(', ') })
        : this.t('PAYROLL.ENGINE_RESULTS.KPI_MONTHS_NONE_MISSING')),
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
  readonly yearFilter  = signal<number | null>(null);
  readonly monthFilter = signal<number | null>(null);
  /** Plage « Date de calcul » telle qu'émise par le panneau (`Date[]`), pour le ré-amorcer. */
  readonly calculatedFilter = signal<Date[] | null>(null);
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
    const year = this.yearFilter();
    const month = this.monthFilter();
    const calculated = dayRange(this.calculatedFilter());
    const latest = this.latestIds();
    const showOld = this.showOld();
    return this.results().filter(r => {
      // « octobre 2026 », « 10/2026 » ou le n° du résultat.
      const period = `${this.periodText(r)} ${r.periodMonth}/${r.periodYear}`.toLowerCase();
      const matchesQuery = !query || period.includes(query) || String(r.resultId).includes(query);
      return matchesQuery
        && (showOld || latest.has(r.resultId))
        && (year == null || r.periodYear === year)
        && (month == null || r.periodMonth === month)
        && inDayRange(r.calculatedAt, calculated);
    });
  });

  readonly filterFields = computed<FilterField[]>(() => [{
    name: 'year',
    label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_YEAR'),
    type: 'select',
    placeholder: this.t('PAYROLL.ENGINE_RESULTS.FILTER_ALL'),
    options: distinctSorted(this.results().map(r => r.periodYear)).reverse()
      .map(y => ({ value: String(y), label: String(y) })),
  }, {
    name: 'month',
    label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_MONTH'),
    type: 'select',
    placeholder: this.t('PAYROLL.ENGINE_RESULTS.FILTER_ALL'),
    options: distinctSorted(this.results().map(r => r.periodMonth))
      .map(m => ({ value: String(m), label: monthName(m, this.translate.getCurrentLang() ?? 'fr') })),
  }, {
    name: 'calculatedAt',
    label: this.t('PAYROLL.ENGINE_RESULTS.COL_CALCULATED_AT'),
    type: 'daterange',
  }, {
    name: 'showOld',
    label: this.t('PAYROLL.ENGINE_RESULTS.SHOW_OLD', { count: this.oldCount() }),
    type: 'checkbox',
    hint: this.t('PAYROLL.ENGINE_RESULTS.SHOW_OLD_HINT'),
  }]);

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.ENGINE_RESULTS.FILTER_TITLE'),
    applyLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_RESET'),
    triggerLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_TRIGGER'),
    // `daf-filter` seeds `initialValues` once, in its own internal shape — a `select`
    // field is a `string[]` there (normalizes to a scalar only on `apply`).
    initialValues: {
      year:         this.yearFilter() != null ? [String(this.yearFilter())] : [],
      month:        this.monthFilter() != null ? [String(this.monthFilter())] : [],
      calculatedAt: this.calculatedFilter(),
      showOld:      this.showOld(),
    },
  }));

  applyFilters(result: FilterResult): void {
    this.showOld.set(result['showOld'] === true);
    const year = pickValue(result, 'year');
    const month = pickValue(result, 'month');
    this.yearFilter.set(year ? Number(year) : null);
    this.monthFilter.set(month ? Number(month) : null);
    this.calculatedFilter.set(rangeSeed(result['calculatedAt']));
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

  /** « Calculé le 22/10/2026 14:05 ». */
  private calculatedOnText(r: RunPayrollResponse): string {
    const d = new Date(r.calculatedAt);
    if (Number.isNaN(d.getTime())) return '';
    const date = d.toLocaleString(this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR',
      { dateStyle: 'short', timeStyle: 'short' });
    return this.t('PAYROLL.ENGINE_RESULTS.CALCULATED_ON', { date });
  }

  /** Vue carte — mêmes résultats/actions que le tableau, juste une autre présentation. */
  readonly resultCards = computed(() => {
    const latest = this.latestIds();
    return this.sortedResultRows().map(row => this.results().find(r => r.resultId === row['resultId'])!)
      .filter(Boolean)
      .map(r => {
        const isLatest = latest.has(r.resultId);
        return {
          id: r.resultId,
          options: {
            clickable: true,
            metadata: {
              title: this.periodText(r),
              subtitle: this.calculatedOnText(r),
              status: isLatest ? 'active' : 'inactive',
              statusLabel: this.t(isLatest ? 'PAYROLL.ENGINE_RESULTS.CALC_LATEST' : 'PAYROLL.ENGINE_RESULTS.CALC_OLD'),
            },
            metricsColumns: 2,
            metrics: [
              { label: this.t('PAYROLL.ENGINE_RESULTS.COL_GROSS'),   value: this.money(r.aggregateGross) },
              { label: this.t('PAYROLL.ENGINE_RESULTS.COL_NET_PAY'), value: this.money(r.strate5) },
            ],
            viewLabel: this.t('PAYROLL.ENGINE_RESULTS.DETAIL_LINK'),
          } satisfies EntityCardOptions,
        };
      });
  });

  exportResultsCsv(): void {
    const columns = this.resultColumns();
    const rows = this.sortedResultRows();
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = columns.map(c => escape(c.label)).join(';');
    const body = rows.map(row => columns.map(c => {
      const cell = row[c.key];
      return escape(c.key === 'calc' ? (cell as { label?: string })?.label : cell);
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

  loadEmployeeResults(): void {
    const employeeId = this.employeeId;
    this.empLoading.set(true);
    this.empError.set(null);
    this.empSearched.set(false);
    this.page.set(0);
    this.engineApi.getResults(employeeId).subscribe({
      next: r  => { this.results.set(r); this.empLoading.set(false); this.empSearched.set(true); },
      error: e => { this.empError.set(e?.error?.message ?? this.t('PAYROLL.ENGINE_RESULTS.ERROR_GENERIC')); this.empLoading.set(false); },
    });
  }

  // ── Bulletin ouvert dans la page (ex-pop-up `ModalService`) ──────────────────
  // Gardé dans l'URL (`?result=<id>`) : lien partageable, et le bouton Retour du
  // navigateur referme le bulletin au lieu de quitter la fiche.
  readonly selectedResultId = toSignal(
    this.route.queryParamMap.pipe(map(p => Number(p.get('result')) || null)),
    { initialValue: Number(this.route.snapshot.queryParamMap.get('result')) || null },
  );
  private readonly detailEl = viewChild(EngineResultDetailComponent, { read: ElementRef });

  /** Ligne du tableau, carte ou icône 👁 → bulletin affiché à la place de la liste. */
  openDetail(id: number): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { result: id }, queryParamsHandling: 'merge' }).then(() => setTimeout(() =>
      (this.detailEl()?.nativeElement as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  }

  closeDetail(): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { result: null }, queryParamsHandling: 'merge' });
  }

  /** Montant de colonne : en devise quand on la connaît (`type: 'currency'` de la lib). */
  private moneyColumn(): Pick<TableColumn, 'type' | 'format'> {
    const digits = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    const currency = this.currencyCode();
    return currency ? { type: 'currency', format: { currency, ...digits } } : { type: 'number', format: digits };
  }

  /**
   * Plus de colonnes « ID » ni « Convergence » (toujours « OK »). La colonne « Calcul »
   * (dernier / ancien) n'apparaît que quand les anciens calculs sont affichés — sinon
   * toutes les lignes diraient « Dernier calcul ».
   */
  readonly resultColumns = computed<TableColumn[]>(() => {
    const money = this.moneyColumn();
    return [
      { key: 'period',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_PERIOD'), sortable: true,
        sortAccessor: row => row['_periodKey'] as number },
      { key: 'gross',        label: this.t('PAYROLL.ENGINE_RESULTS.COL_GROSS'),            ...money, align: 'right', sortable: true },
      { key: 'employeeCharges', label: this.t('PAYROLL.ENGINE_RESULTS.COL_EMPLOYEE_CHARGES'), ...money, align: 'right', sortable: true },
      { key: 'irpp',         label: this.t('PAYROLL.ENGINE_RESULTS.COL_IRPP'),             ...money, align: 'right', sortable: true },
      { key: 'netPay',       label: this.t('PAYROLL.ENGINE_RESULTS.COL_NET_PAY'),          ...money, align: 'right', sortable: true },
      ...(this.showOld()
        ? [{ key: 'calc', label: this.t('PAYROLL.ENGINE_RESULTS.COL_CALC'), type: 'badge' as const, sortable: true }]
        : []),
      { key: 'calculatedAt', label: this.t('PAYROLL.ENGINE_RESULTS.COL_CALCULATED_AT'), type: 'date', format: { dateStyle: 'short', timeStyle: 'short' }, sortable: true },
    ];
  });

  readonly resultRows = computed<TableRow[]>(() => {
    const latest = this.latestIds();
    return this.filteredResults().map(r => {
      const isLatest = latest.has(r.resultId);
      return {
        id:           r.resultId,
        resultId:     r.resultId,
        period:       this.periodText(r),
        // L'année puis le mois, en un nombre ; à mois égal, le calcul le plus récent d'abord.
        _periodKey:   (r.periodYear * 100 + r.periodMonth) * 1e7 + r.resultId,
        gross:        r.aggregateGross,
        // Strates réelles : S3 = CNSS salariale, S4 = IRPP (le résultat ne porte ni net
        // imposable ni coût employeur).
        employeeCharges: r.strate3,
        irpp:         r.aggregateIrpp ?? r.strate4,
        netPay:       r.strate5,
        calc: {
          label: this.t(isLatest ? 'PAYROLL.ENGINE_RESULTS.CALC_LATEST' : 'PAYROLL.ENGINE_RESULTS.CALC_OLD'),
          options: { variant: (isLatest ? 'success' : 'neutral') as BadgeVariant, size: 'sm' as const },
        },
        calculatedAt: r.calculatedAt,
      };
    });
  });

  /** Toutes les lignes filtrées, triées — l'export et la vue cartes suivent le même ordre. */
  private readonly sortedResultRows = computed(() =>
    sortTableRows(this.resultRows(), this.resultColumns(), this.resultSort()));

  /** Page courante — ce que le tableau/la grille affichent réellement. L'export prend
   *  toutes les lignes filtrées (`sortedResultRows`), pas seulement la page visible. */
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.resultRows().length / this.pageSize())));
  readonly pagedResultRows = computed(() => {
    const start = this.page() * this.pageSize();
    return this.sortedResultRows().slice(start, start + this.pageSize());
  });

  /**
   * Tri d'en-tête. Les résultats arrivent entiers en un appel puis sont paginés ici : le
   * tri porte sur tout le jeu filtré AVANT la découpe (`sortTableRows`), et la config
   * passe `manualSort` pour que la lib ne retrie pas la seule page affichée. Par défaut :
   * le mois le plus récent en premier.
   */
  readonly resultSort = signal<TableSort | null>({ key: 'period', dir: 'desc' });

  onResultSort(event: Parameters<typeof toTableSort>[0]): void {
    this.resultSort.set(toTableSort(event));
    this.page.set(0);
  }

  /** Outils de tableau communs (`tableTools`), comme sur `/finance/affaires`. */
  readonly resultTableConfig = computed<TableConfig>(() => ({
    actions: this.resultActions(),
    emptyMessage: this.t('PAYROLL.ENGINE_RESULTS.EMPTY_FILTERED'),
    hoverable: true,
    ...tableTools(this.translate, 'resultId'),
    ...delegatedSort(untracked(this.resultSort)),
  }));
  readonly pagedResultCards = computed(() => {
    const start = this.page() * this.pageSize();
    return this.resultCards().slice(start, start + this.pageSize());
  });

  /** `id: 'view'` gets the library's `visibility` icon for free (`resolveActionIcon`,
   *  same convention as affaires/clients/suppliers) — the table renders the action icon
   *  only, never `label`, so the text belongs in `tooltip`. */
  readonly resultActions = computed(() => [
    { id: 'view', tooltip: this.t('PAYROLL.ENGINE_RESULTS.DETAIL_LINK'), onClick: (row: TableRow) => this.openDetail(row['resultId']) },
  ]);
}
