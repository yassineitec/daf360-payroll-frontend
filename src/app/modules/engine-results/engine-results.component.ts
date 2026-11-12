import { ChangeDetectionStrategy, Component, ElementRef, TemplateRef, afterNextRender, computed, inject, signal, untracked, viewChild } from '@angular/core';
import { UserStore } from '../../core/user.store';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';
import { NotificationService } from '../../core/notification.service';
import { readBlobError, saveBlob } from '../../shared/blob-download';
import { PaysNamesService } from '../../core/pays-names.service';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PayrollEngineService, RunPayrollResponse } from '../../core/payroll-engine.service';
import { PayrollApiService, PaysDto } from '../../core/payroll-api.service';
import { CurrencyService } from '../../core/currency.service';
import { EmployeeProfileDetail, HrProfileService, contractTypeLabel } from '../../core/hr-profile.service';
import { recallEmployee } from './engine-results-employee';
import { EmployeeConfigService } from '../employee-config/employee-config.service';
import { EngineResultDetailComponent } from './engine-result-detail.component';
import { PageGuideComponent } from '../../shared/guide/page-guide.component';
import type { GuideStep } from '../../shared/guide/page-guide.types';
import {
  ButtonComponent,
  CardComponent,
  FormFieldComponent,
  ModalRef,
  ModalService,
  SelectComponent,
  type SelectOption,
  DataTableComponent,
  EntityCardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  PaginationComponent,
  SearchToolbarComponent,
  SectionCardComponent,
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
import { EmployeeDetailsCardComponent } from '../../shared/employee-details/employee-details-card.component';

/** Net à payer d'un résultat : `aggregateNet` (brut − cotisations salariales − impôts). Plus
 *  `strate5` : depuis le 2026-11-06 la strate 5 porte les impôts, plus le net — un pays sans
 *  rubrique d'impôt affichait 0. Repli sur `strate5` seulement si `aggregateNet` manque
 *  (avant, le serveur y recopiait déjà la strate 5, alors le net). */
function netOf(r: RunPayrollResponse): number | null {
  return r.aggregateNet ?? r.strate5 ?? null;
}

/** Une ligne libellé / valeur de la carte « Détails ». */

/** Codes de la liste RH `MARITAL_STATUS` (configurable en base) → clé de traduction ;
 *  un code inconnu s'affiche tel quel. */
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
/** Guide de la page — `target` = un `data-guide` du gabarit. */
const guideStep = (key: string, icon: string, target?: string): GuideStep => ({
  icon, titleKey: `GUIDE.ENGINE_RESULTS_DETAIL.${key}_TITLE`, textKey: `GUIDE.ENGINE_RESULTS_DETAIL.${key}_TEXT`, target,
});
const GUIDE_WELCOME = guideStep('WELCOME', 'badge',        'res-detail-header');
const GUIDE_CARD    = guideStep('CARD',    'contact_page', 'res-detail-card');
const GUIDE_ACTIONS = guideStep('ACTIONS', 'bolt',         'res-detail-actions');
const GUIDE_KPIS    = guideStep('KPIS',    'monitoring',   'res-detail-kpis');
const GUIDE_TOOLBAR = guideStep('TOOLBAR', 'filter_list',  'res-detail-toolbar');
const GUIDE_PERIODS = guideStep('PERIODS', 'calendar_month', 'res-detail-periods');
const GUIDE_PAYSLIP = guideStep('PAYSLIP', 'receipt_long', 'res-detail-payslip');

@Component({
  selector: 'app-engine-results',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    EmployeeDetailsCardComponent, ButtonComponent, CardComponent, DataTableComponent, EntityCardComponent,
    FormFieldComponent, SelectComponent,
    MetricCardComponent, PageComponent, PageHeaderComponent, PaginationComponent,
    SearchToolbarComponent, SectionCardComponent,
    EngineResultDetailComponent, PageGuideComponent,
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

  // ── Devise d'affichage : sélecteur rond du shell, comme la liste /payroll/engine-results ──
  // Sans choix, la devise du pays. Les montants enregistrés restent dans la devise du pays :
  // seule cette copie d'affichage (`shownResults`) est convertie, au taux du jour.
  private readonly fx = inject(CurrencyService);

  readonly displayCurrency = computed<string | null>(() => this.fx.display() ?? this.currencyCode());

  /** 1 unité de la devise du pays exprimée dans la devise d'affichage (1 sans conversion). */
  private readonly fxRate = computed(() => {
    const from = this.currencyCode(), to = this.displayCurrency();
    return from && to && from !== to ? this.fx.convert(1, from, to) : 1;
  });

  /** Résultats tels qu'affichés : tous les montants convertis dans `displayCurrency()`. Les
   *  indicateurs, le tableau, les cartes et le bulletin les lisent ; les exports serveur et la
   *  logique (dernier calcul, filtres) restent sur `results()`. */
  readonly shownResults = computed<RunPayrollResponse[]>(() => {
    const k = this.fxRate();
    if (k === 1) return this.results();
    const m = (v: number | null | undefined) => (v == null ? (v as null) : v * k);
    return this.results().map(r => ({
      ...r,
      strate1: m(r.strate1), strate2: m(r.strate2), strate3: m(r.strate3),
      strate4: m(r.strate4), strate5: m(r.strate5),
      aggregateGross: m(r.aggregateGross), aggregateEmployerCharges: m(r.aggregateEmployerCharges),
      aggregateNet: m(r.aggregateNet), aggregateIrpp: m(r.aggregateIrpp), loadedCost: m(r.loadedCost),
      rubriqueDetails: (r.rubriqueDetails ?? []).map(d => ({ ...d, amount: d.amount * k, assiette: m(d.assiette) })),
    }));
  });

  /** Montant formaté, dans la devise quand on la connaît (« 959,840 TND »). */
  money(v: number | null | undefined): string {
    if (v == null) return '—';
    const locale = this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
    const currency = this.displayCurrency();
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
    const rows = this.shownResults().filter(r => latest.has(r.resultId) && r.periodYear === year);
    const totalGross = rows.reduce((sum, r) => sum + (r.aggregateGross ?? 0), 0);
    const totalNet = rows.reduce((sum, r) => sum + (netOf(r) ?? 0), 0);
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
    return this.shownResults().filter(r => {
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
    return this.sortedResultRows().map(row => this.shownResults().find(r => r.resultId === row['resultId'])!)
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
              { label: this.t('PAYROLL.ENGINE_RESULTS.COL_NET_PAY'), value: this.money(netOf(r)) },
            ],
            viewLabel: this.t('PAYROLL.ENGINE_RESULTS.DETAIL_LINK'),
          } satisfies EntityCardOptions,
        };
      });
  });

  // ── « Exporter Excel » / « Exporter PDF » (carte Actions), générés par le serveur ──────
  // Bulletin ouvert (`?result=`) : export du bulletin (lignes de sa recherche) — ses anciens
  // boutons de barre ont été retirés. Sinon : l'historique, lignes de la liste (recherche,
  // filtres et tri appliqués), toutes pages.
  private readonly historyExportingXlsx = signal(false);
  private readonly historyExportingPdf  = signal(false);
  private readonly openBulletin = viewChild(EngineResultDetailComponent);

  readonly exportingXlsx = computed(() =>
    this.historyExportingXlsx() || (this.openBulletin()?.exportingXlsx() ?? false));
  readonly exportingPdf = computed(() =>
    this.historyExportingPdf() || (this.openBulletin()?.exportingPdf() ?? false));

  /** Rien à exporter : aucun résultat, ou bulletin ouvert dont la recherche ne garde aucune ligne. */
  readonly exportDisabled = computed(() => {
    const b = this.openBulletin();
    return b && this.selectedResultId() ? b.nothingToExport() : this.resultRows().length === 0;
  });

  private historyIds(): number[] {
    return this.sortedResultRows().map(row => row['resultId'] as number);
  }

  private historyFileName(ext: string): string {
    const name = (this.employee()?.employeeId ?? String(this.employeeId)).replace(/[^A-Za-z0-9-]+/g, '_');
    return `Charge_salariale_${name}.${ext}`;
  }

  exportResultsXlsx(): void {
    if (this.exportingXlsx() || this.exportDisabled()) return;
    const bulletin = this.openBulletin();
    if (bulletin && this.selectedResultId()) { bulletin.exportXlsx(); return; }
    this.historyExportingXlsx.set(true);
    this.engineApi.exportResultsHistoryXlsx(this.employeeId, this.historyIds(), this.translate.currentLang() || 'fr').subscribe({
      next: blob => { this.historyExportingXlsx.set(false); saveBlob(blob, this.historyFileName('xlsx')); },
      error: err => this.historyExportFailed(err, this.historyExportingXlsx),
    });
  }

  exportResultsPdf(): void {
    if (this.exportingPdf() || this.exportDisabled()) return;
    const bulletin = this.openBulletin();
    if (bulletin && this.selectedResultId()) { bulletin.exportPdf(); return; }
    this.historyExportingPdf.set(true);
    this.engineApi.exportResultsHistoryPdf(this.employeeId, this.historyIds(), this.translate.currentLang() || 'fr', this.employeeName())
      .subscribe({
        next: blob => { this.historyExportingPdf.set(false); saveBlob(blob, this.historyFileName('pdf')); },
        error: err => this.historyExportFailed(err, this.historyExportingPdf),
      });
  }

  private historyExportFailed(err: unknown, busy: { set(v: boolean): void }): void {
    busy.set(false);
    readBlobError(err, this.t('PAYROLL.ENGINE_RUN.EXPORT_ERROR')).then(msg => this.notification.error(msg));
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
    const currency = this.displayCurrency();
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
        netPay:       netOf(r),
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

  // ── « Calculer la paie » : le calcul de /payroll/engine-run, en formulaire pop-up ──────
  // Même modèle que les formulaires de /payroll/salary-advances (`ModalService` + template).
  // Le collaborateur est celui de la page : restent le pays, la période, le contrat et les
  // jours travaillés. Mêmes règles que /payroll/engine-run : contrats tarifés par le jeu de
  // paramètres actif du pays, contrat de la fiche RH repris d'office, avertissement quand le
  // mois est déjà calculé (un nouveau lancement AJOUTE un résultat).
  private readonly modal        = inject(ModalService);
  private readonly notification = inject(NotificationService);
  private readonly paysNames    = inject(PaysNamesService);
  private readonly userStore    = inject(UserStore);
  private readonly calcTpl = viewChild<TemplateRef<unknown>>('calcTpl');
  private calcRef: ModalRef | null = null;

  /** Anciens codes RH (assistant d'intégration d'avant migration) → codes de la paie. */
  private static readonly LEGACY_CONTRACT: Record<string, string> = {
    PERMANENT: 'CDI', FIXED_TERM: 'CDD', INTERN: 'STAGE',
  };

  private readonly calcPaysList = signal<PaysDto[]>([]);
  readonly calcPaysId     = signal<number | null>(null);
  readonly calcMonth      = signal(new Date().getMonth() + 1);
  readonly calcYear       = signal(new Date().getFullYear());
  readonly calcContract   = signal('');
  readonly calcJours      = signal(22);
  readonly calcContracts  = signal<string[]>([]);
  readonly calcContractsLoading = signal(false);
  readonly calcPsMissing  = signal(false);
  readonly calcRunning    = signal(false);
  readonly calcError      = signal<string | null>(null);

  readonly calcPaysOptions = computed<SelectOption[]>(() =>
    this.calcPaysList().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})` })));

  readonly calcMonthOptions = computed<SelectOption[]>(() => {
    const locale = this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
    return Array.from({ length: 12 }, (_, i) => {
      const name = new Date(2000, i, 1).toLocaleDateString(locale, { month: 'long' });
      return { value: String(i + 1), label: name.charAt(0).toUpperCase() + name.slice(1) };
    });
  });

  readonly calcYearOptions = computed<SelectOption[]>(() => {
    const now = new Date().getFullYear();
    const years = new Set<number>([now - 3, now - 2, now - 1, now, now + 1, this.calcYear()]);
    return [...years].sort((a, b) => b - a).map(y => ({ value: String(y), label: String(y) }));
  });

  readonly calcContractOptions = computed<SelectOption[]>(() =>
    this.calcContracts().map(ct => ({ value: ct, label: contractTypeLabel(ct, this.translate) })));

  readonly calcContractPlaceholder = computed(() =>
    !this.calcPaysId()             ? this.t('PAYROLL.ENGINE_RUN.CONTRACT_NO_PAYS')
    : this.calcContractsLoading()  ? this.t('PAYROLL.COMMON.LOADING')
    : this.calcPsMissing()         ? this.t('PAYROLL.ENGINE_RUN.CONTRACT_NO_PS')
    :                                this.t('PAYROLL.ENGINE_RUN.CONTRACT_PLACEHOLDER'));

  private readonly employeeConfigs = inject(EmployeeConfigService);

  /** Contrat de la configuration paie ENREGISTRÉE (« Salaires des collaborateurs ») — celui
   *  avec lequel le net de cette configuration a été calculé ; `null` si jamais enregistrée
   *  ou sans droit de lecture de la configuration. */
  private readonly savedContract = signal<string | null>(null);
  /** Contrat proposé avant de connaître celui de la configuration enregistrée : s'il est
   *  toujours sélectionné à l'arrivée de ce dernier, l'utilisateur n'en a pas choisi d'autre. */
  private calcDefaultBeforeSaved = '';

  /** Contrat de la fiche RH, en code de la paie (« CDI », « CIVP »…). */
  private readonly hrContract = computed(() => {
    const code = (this.profile()?.contractType ?? this.employee()?.contractType)?.trim().toUpperCase();
    return code ? (EngineResultsComponent.LEGACY_CONTRACT[code] ?? code) : null;
  });

  readonly calcContractHint = computed(() => {
    const hr = this.hrContract();
    if (!hr || !this.calcContracts().length) return '';
    const contract = contractTypeLabel(hr, this.translate);
    if (!this.calcContracts().includes(hr)) return this.t('PAYROLL.ENGINE_RUN.CONTRACT_HR_NOT_PRICED', { contract });
    return this.calcContract() === hr
      ? this.t('PAYROLL.ENGINE_RUN.CONTRACT_FROM_HR')
      : this.t('PAYROLL.ENGINE_RUN.CONTRACT_HR_DIFFERS', { contract });
  });

  /** Collaborateur sorti ou archivé : le calcul reste possible, mais signalé. */
  readonly calcExitWarning = computed(() => {
    const s = this.profile()?.lifecycleStatus ?? this.employee()?.lifecycleStatus;
    if (s !== 'TERMINATED' && s !== 'ARCHIVED') return null;
    return this.t('PAYROLL.ENGINE_RUN.EXIT_WARNING', { status: this.t(`PAYROLL.ENGINE_RUN.LIFECYCLE.${s}`).toLowerCase() });
  });

  /** Mois déjà calculé : le relancer enregistre un résultat de plus. */
  readonly calcExistingWarning = computed(() => {
    const y = this.calcYear(), m = this.calcMonth();
    const r = this.results().filter(x => x.periodYear === y && x.periodMonth === m)
      .sort((a, b) => b.resultId - a.resultId)[0];
    return r ? this.t('PAYROLL.ENGINE_RUN.EXISTING_WARNING', { period: this.periodText(r), id: r.resultId }) : null;
  });

  canCalc(): boolean {
    return !!this.calcPaysId() && !!this.calcContract() && this.calcJours() >= 1 && !this.calcRunning();
  }

  /** Calcul réservé à qui peut lancer le moteur (même droit que `POST /engine/run`). */
  readonly canRunEngine = computed(() => this.userStore.hasPermission('PAYROLL_RUN_ENGINE'));

  /** Guide (« Aide & guides ») : le bulletin ouvert, sinon la liste des mois — ce qui est à l'écran. */
  readonly guideSteps = computed<GuideStep[]>(() => {
    const head = [GUIDE_WELCOME, GUIDE_CARD, GUIDE_ACTIONS];
    if (!this.results().length) return head;
    return this.selectedResultId() ? [...head, GUIDE_PAYSLIP] : [...head, GUIDE_KPIS, GUIDE_TOOLBAR, GUIDE_PERIODS];
  });

  /** Arrivée avec `?calc=1` (« Calculer sa paie » de /payroll/employee-config) : pop-up
   *  ouverte dès le premier rendu, `?pays=` pré-sélectionné ; les deux paramètres sont
   *  ensuite retirés de l'adresse (un F5 ne rouvre pas la pop-up). */
  private readonly openCalcFromUrl = afterNextRender(() => {
    const q = this.route.snapshot.queryParamMap;
    if (q.get('calc') !== '1') return;
    const pays = Number(q.get('pays'));
    this.router.navigate([], { relativeTo: this.route, queryParams: { calc: null, pays: null },
      queryParamsHandling: 'merge', replaceUrl: true });
    if (this.canRunEngine()) this.openCalc(pays > 0 ? pays : null);
  });

  openCalc(paysOverride: number | null = null): void {
    if (!this.canRunEngine()) return;
    this.calcError.set(null);
    this.calcRunning.set(false);
    this.calcMonth.set(new Date().getMonth() + 1);
    this.calcYear.set(new Date().getFullYear());
    this.calcJours.set(22);
    // Pays du collaborateur (liste), sinon celui de ses résultats.
    const paysId = paysOverride ?? this.employee()?.paysId ?? this.results().find(r => r.paysId != null)?.paysId ?? null;
    this.calcPaysId.set(null);
    this.savedContract.set(null);
    this.employeeConfigs.getSavedContractTypes([this.employeeId])
      .pipe(catchError(() => of({} as Record<number, string>)))
      .subscribe(map => {
        const saved = map[this.employeeId]?.trim().toUpperCase() ?? null;
        this.savedContract.set(saved);
        // Contrats déjà chargés et contrat encore celui proposé par défaut : on bascule sur
        // celui de la configuration enregistrée s'il est tarifé.
        if (saved && this.calcContracts().includes(saved) && this.calcContract() === this.calcDefaultBeforeSaved) {
          this.calcContract.set(saved);
        }
      });
    this.onCalcPaysChange(paysId != null ? [String(paysId)] : []);
    if (!this.calcPaysList().length) {
      this.payrollApi.listPayrollPays().pipe(catchError(() => of([] as PaysDto[])))
        .subscribe(list => this.calcPaysList.set(list));
    }
    this.calcRef = this.modal.open({
      resizable: true,
      maximizable: true,
      minWidth: '360px',
      minHeight: '260px',
      title: this.t('PAYROLL.ENGINE_RESULTS.CALC_TITLE'),
      subtitle: this.employeeName(),
      icon: 'calculate',
      body: this.calcTpl()!,
      size: 'md',
      closeOnBackdrop: false,
      buttons: [
        { label: this.t('PAYROLL.ENGINE_RUN.EXISTING_CONFIRM_CANCEL'), variant: 'secondary', action: r => r.close() },
        { label: this.t('PAYROLL.ENGINE_RUN.RUN_BUTTON'), variant: 'primary', icon: 'calculate', action: () => this.submitCalc() },
      ],
    });
  }

  onCalcPaysChange(selected: string[]): void {
    const id = selected[0] ? +selected[0] : null;
    if (id === this.calcPaysId()) return;
    this.calcPaysId.set(id);
    this.loadCalcContracts(id);
  }

  private contractSeq = 0;
  private loadCalcContracts(paysId: number | null): void {
    const seq = ++this.contractSeq;
    this.calcContracts.set([]);
    this.calcPsMissing.set(false);
    this.calcContract.set('');
    if (paysId == null) { this.calcContractsLoading.set(false); return; }
    this.calcContractsLoading.set(true);
    this.payrollApi.getActiveParameterSet(paysId).pipe(catchError(() => of(null))).subscribe(ps => {
      if (seq !== this.contractSeq) return;
      const types = [...new Set((ps?.socialChargeRates ?? []).map(r => r.contractType))].sort();
      this.calcContracts.set(types);
      this.calcPsMissing.set(!ps);
      this.calcContractsLoading.set(false);
      // Contrat de la configuration paie enregistrée s'il est tarifé (même contrat que le net
      // affiché dans « Salaires des collaborateurs »), sinon celui de la fiche RH, sinon CDI,
      // sinon le premier.
      const saved = this.savedContract();
      const hr = this.hrContract();
      this.calcDefaultBeforeSaved = hr && types.includes(hr) ? hr : types.includes('CDI') ? 'CDI' : types[0] ?? '';
      this.calcContract.set(saved && types.includes(saved) ? saved : this.calcDefaultBeforeSaved);
    });
  }

  /** Bouton « Lancer le calcul » de la pop-up — gardé ici aussi : un ModalButton n'a pas de
   *  `disabled` réactif. Succès : pop-up fermée, historique rechargé, bulletin ouvert. */
  private submitCalc(): void {
    if (this.calcRunning()) return;
    if (!this.canCalc()) {
      this.calcError.set(this.t('PAYROLL.ENGINE_RESULTS.CALC_INCOMPLETE'));
      return;
    }
    this.calcRunning.set(true);
    this.calcError.set(null);
    this.engineApi.runPayroll({
      employeeId:       this.employeeId,
      paysId:           this.calcPaysId()!,
      periodYear:       this.calcYear(),
      periodMonth:      this.calcMonth(),
      contractTypeCode: this.calcContract(),
      joursOuvresMois:  this.calcJours(),
    }).subscribe({
      next: r => {
        this.calcRunning.set(false);
        this.calcRef?.close();
        this.results.update(list => [...list, r]);
        this.empSearched.set(true);
        this.notification.success(this.t('PAYROLL.ENGINE_RESULTS.CALC_SUCCESS', { period: this.periodText(r), id: r.resultId }));
        this.openDetail(r.resultId);
      },
      error: e => {
        this.calcRunning.set(false);
        this.calcError.set(e?.error?.detail ?? e?.error?.message ?? this.t('PAYROLL.ENGINE_RUN.ERROR'));
      },
    });
  }
}
