import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { type Observable, type Subscription, catchError, forkJoin, from, map, mergeMap, of, switchMap } from 'rxjs';
import { NotificationService } from '../../core/notification.service';
import { UserStore } from '../../core/user.store';
import {
  HrProfileService, LIFECYCLE_STATUSES, contractTypeLabel, departmentFilterOptions,
  type EmployeeFilterOptions, type EmployeeListItem,
} from '../../core/hr-profile.service';
import { dayRange, rangeSeed } from '../../shared/filter-utils';
import { PayrollEngineService, type PayrollResultsSummaryDto } from '../../core/payroll-engine.service';
import { CurrencyService } from '../../core/currency.service';
import {
  ButtonComponent,
  CardComponent,
  CheckboxComponent,
  DataTableComponent,
  FormFieldComponent,
  ModalService,
  SelectComponent,
  type ModalRef,
  type SelectOption,
  EntityCardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  PaginationComponent,
  SearchToolbarComponent,
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
import { PayrollApiService, type PaysDto } from '../../core/payroll-api.service';
import { rememberEmployee } from './engine-results-employee';
import { TableSort, delegatedSort, tableTools, toTableSort } from '../../shared/table-tools';
import { EngineResultsListStateService } from './engine-results-list-state.service';
import { readBlobError, saveBlob } from '../../shared/blob-download';
import { PaysNamesService } from '../../core/pays-names.service';
import { PageGuideComponent } from '../../shared/guide/page-guide.component';
import type { GuideStep } from '../../shared/guide/page-guide.types';

/** Guide de la page — `target` = un `data-guide` du gabarit. */
const guideStep = (key: string, icon: string, target?: string): GuideStep => ({
  icon, titleKey: `GUIDE.ENGINE_RESULTS.${key}_TITLE`, textKey: `GUIDE.ENGINE_RESULTS.${key}_TEXT`, target,
});
const GUIDE_STEPS: GuideStep[] = [
  guideStep('WELCOME',    'account_balance_wallet', 'res-list-header'),
  guideStep('BATCH',      'calculate',              'res-list-batch'),
  guideStep('KPIS',       'monitoring',             'res-list-kpis'),
  guideStep('TOOLBAR',    'filter_list',            'res-list-toolbar'),
  guideStep('RESULTS',    'groups',                 'res-list-results'),
  guideStep('PAGINATION', 'last_page',              'res-list-pagination'),
];

/** Return shape of `total()` — the summed amount plus whether it relied on a fallback rate. */
interface TotalResult { value: number; approximate: boolean; }

/** Une page de la liste, qu'elle vienne du service RH ou du découpage local (filtres Période / Collaborateurs). */
interface ListPage { content: EmployeeListItem[]; totalElements: number; totalPages: number; }

/**
 * Taille demandée au service RH quand la liste doit être recoupée localement (Période ou
 * Collaborateurs actifs) : tout le périmètre filtré en une page — le plafond par défaut de
 * Spring Data. Au-delà, les collaborateurs suivants ne seraient pas recoupés.
 */
const ALL_EMPLOYEES = 2000;

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
    ButtonComponent, CardComponent, CheckboxComponent, DataTableComponent, EntityCardComponent,
    FormFieldComponent, MetricCardComponent, PageComponent, PageHeaderComponent, PaginationComponent,
    SearchToolbarComponent, SelectComponent, PageGuideComponent,
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
  private readonly payrollApi = inject(PayrollApiService);
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
  /** Filtre « Période » (daterange, au mois près) : collaborateurs ayant un résultat sur la
   *  période, et KPI additionnés sur ses mois au lieu du dernier mois calculé. */
  readonly periodFilter     = signal<Date[] | null>(null);
  /** Filtre « Collaborateurs » (sélection multiple, userId) : liste et KPI limités à eux. */
  readonly employeeFilter   = signal<number[]>([]);
  readonly viewMode   = signal<'grid' | 'list'>('grid');
  /** 0-indexé, comme `daf-pagination`. */
  readonly page     = signal(0);
  readonly pageSize = signal(20);

  /** Pays actifs de « Pays de paie » (/payroll/admin) — choix du filtre « Pays ». */
  private readonly paysList = signal<PaysDto[]>([]);
  private readonly filterOptions = signal<EmployeeFilterOptions | null>(null);
  /** Choix du filtre « Collaborateurs » : le personnel en poste du pays filtré (ou de tous). */
  private readonly employeeOptions = signal<EmployeeListItem[]>([]);

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
      periodFilter:     this.periodFilter(),
      employeeFilter:   this.employeeFilter(),
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
    this.periodFilter.set(s.periodFilter);
    this.employeeFilter.set(s.employeeFilter);
    this.viewMode.set(s.viewMode);
    this.employeeSort.set(s.employeeSort);
    this.page.set(s.page);
    this.pageSize.set(s.pageSize);
  }

  ngOnInit(): void {
    this.restoreState();
    this.payrollApi.listPayrollPays()
      .pipe(catchError(() => of([] as PaysDto[])))
      .subscribe(list => this.paysList.set(list));
    // Aucun filtre pays par défaut : la liste affiche tout le personnel et le bandeau KPI
    // les totaux de tous les pays ; choisir un pays recharge ces mêmes tuiles pour lui.
    this.hrService.getFilterOptions().subscribe(o => this.filterOptions.set(o));
    this.loadEmployeeOptions();
    this.load();
    this.loadKpis();
  }

  /** Personnel proposé par le filtre « Collaborateurs », suivant le filtre pays. */
  private loadEmployeeOptions(): void {
    this.hrService.listEmployees({ paysId: this.paysFilter(), page: 0, size: ALL_EMPLOYEES, sort: 'fullName,asc' })
      .pipe(catchError(() => of({ content: [] as EmployeeListItem[] })))
      .subscribe(p => this.employeeOptions.set(p.content ?? []));
  }

  /** Une période est choisie : le titre des KPI dit « période » au lieu de « dernier mois calculé ». */
  readonly hasPeriodFilter = computed(() => !!this.periodFilter()?.length);

  /** Bornes `YYYY-MM-DD` du filtre « Période » (null sans filtre). */
  private periodBounds(): [string | null, string | null] {
    return dayRange(this.periodFilter());
  }

  /** Période ou collaborateurs choisis : la liste est recoupée localement (voir `load()`). */
  private isRestricted(): boolean {
    const [from, to] = this.periodBounds();
    return !!(from || to) || this.employeeFilter().length > 0;
  }

  /**
   * userId admis par les filtres Période et Collaborateurs (intersection des deux) ; `null`
   * quand aucun ne s'applique. La période interroge la paie : qui a un résultat sur ses mois.
   */
  private allowedIds(): Observable<Set<number> | null> {
    const [from, to] = this.periodBounds();
    const picked = this.employeeFilter();
    const withResults$: Observable<number[] | null> = from || to
      ? this.engineApi.getEmployeesWithResults({ paysId: this.paysFilter(), from, to })
      : of(null);
    return withResults$.pipe(map(ids => {
      if (!ids) return picked.length ? new Set(picked) : null;
      const set = new Set(ids);
      return picked.length ? new Set(picked.filter(id => set.has(id))) : set;
    }));
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
    const [from, to] = this.periodBounds();
    const picked = this.employeeFilter();
    const scope = { from, to, employeeIds: picked };
    const summaries$ = paysId != null
      ? this.engineApi.getResultsSummary(paysId, scope).pipe(map(s => [s]))
      : this.engineApi.getAllResultsSummaries(scope).pipe(map(list => list.filter(s => s.employeeCount > 0)));
    forkJoin({
      summaries: summaries$.pipe(catchError(() => of(null))),
      // Collaborateurs choisis : la couverture se rapporte à eux, pas à tout l'effectif.
      headcount: picked.length ? of(picked.length) : this.hrService.listEmployees({ paysId, page: 0, size: 1 }).pipe(
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

  // ── Devise d'affichage (choisie via le sélecteur global du shell paie) ──
  // Les totaux arrivent dans la devise de chaque pays ; `CurrencyService.convert()` les
  // convertit au taux du jour. `displayCurrency()` = devise réellement affichée : le choix
  // du sélecteur, sinon la devise commune des pays affichés, sinon EUR quand plusieurs
  // devises se mélangent.
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

  /** Somme d'un montant sur tous les pays, chacun converti dans la devise d'affichage. Flags the
   *  result as approximate when any contributing country's currency (or the display target
   *  itself) needed CurrencyService's fallback rate rather than a live one. */
  private total(field: 'totalGross' | 'totalNet' | 'totalLoadedCost'): TotalResult {
    const target = this.displayCurrency();
    let approximate = !!target && this.currency.needsFallbackRate(target);
    const value = (this.summaries() ?? []).reduce((acc, s) => {
      const v = s[field] ?? 0;
      if (!s.currencyCode || !target) return acc + v;
      if (s.currencyCode !== target && this.currency.needsFallbackRate(s.currencyCode)) {
        approximate = true;
      }
      return acc + this.currency.convert(v, s.currencyCode, target);
    }, 0);
    return { value, approximate };
  }

  private money(amount: number, approximate = false): string {
    const target = this.displayCurrency();
    const locale = this.translate.getCurrentLang() === 'en' ? 'en-US' : 'fr-FR';
    const prefix = approximate ? '≈ ' : '';
    if (target) {
      try {
        return prefix + new Intl.NumberFormat(locale, { style: 'currency', currency: target, maximumFractionDigits: 0 })
          .format(amount);
      } catch { /* code ISO inconnu d'Intl — repli ci-dessous */ }
    }
    const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
    return target ? `${prefix}${n} ${target}` : `${prefix}${n}`;
  }

  /** Avec le filtre « Période » : la période choisie. Sans : le DERNIER mois calculé, en
   *  toutes lettres (« décembre 2026 ») — les cartes additionnent alors tous les calculs
   *  jusqu'à ce mois-là (en-tête « tous les calculs, jusqu'à … »). */
  private periodLabel(list: PayrollResultsSummaryDto[]): string {
    // Filtre « Période » : c'est lui qui borne les totaux, on l'affiche tel quel (au mois près).
    const [from, to] = this.periodBounds();
    if (from || to) {
      const locale = this.translate.getCurrentLang() === 'en' ? 'en-GB' : 'fr-FR';
      const fmt = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, 1)
        .toLocaleDateString(locale, { month: 'long', year: 'numeric' });
      const a = from ? fmt(from) : '…', b = to ? fmt(to) : '…';
      return a === b ? a : `${a} – ${b}`;
    }
    const keys = list
      .filter(s => s.periodYear && s.periodMonth)
      .map(s => s.periodYear! * 100 + s.periodMonth!)
      .sort((a, b) => a - b);
    if (keys.length === 0) return this.t('PAYROLL.ENGINE_RESULTS.KPI_NO_PERIOD');
    const locale = this.translate.getCurrentLang() === 'en' ? 'en-GB' : 'fr-FR';
    const fmt = (k: number) => new Date(Math.floor(k / 100), (k % 100) - 1, 1)
      .toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    return fmt(keys[keys.length - 1]);
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
      totalGross:      this.total('totalGross'),
      totalNet:        this.total('totalNet'),
      totalLoadedCost: this.total('totalLoadedCost'),
      employeeCount:   list.reduce((acc, x) => acc + x.employeeCount, 0),
    };
    const period = this.periodLabel(list);
    // Aides des tuiles : la période filtrée, sinon « l'ensemble des mois calculés » (sans
    // filtre, les totaux couvrent tout l'historique, pas seulement le dernier mois).
    const helpPeriod = this.hasPeriodFilter() ? period : this.t('PAYROLL.ENGINE_RESULTS.KPI_ALL_PERIOD');
    const headcount = this.headcount();
    // Collaborateurs en poste sans résultat sur la période. ⚠ `employeeCount` compte les
    // RÉSULTATS (un recalcul du même mois compte deux fois) tant que le résumé serveur ne
    // dédoublonne pas : le nombre est borné à 0 pour ne jamais devenir négatif.
    const missing = headcount != null ? Math.max(0, headcount - s.employeeCount) : null;
    // Retenues = ce qui sépare la masse brute de la masse nette (cotisations salariales + IRPP).
    const withheld = Math.max(0, s.totalGross.value - s.totalNet.value);
    const withheldPct = s.totalGross.value > 0
      ? new Intl.NumberFormat(this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: 1 })
          .format(withheld / s.totalGross.value * 100)
      : null;
    // Info-bulles sans titre : il redirait le libellé de la tuile, juste au-dessus.
    return {
      period,
      tiles: [
        {
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_GROSS_PAYROLL'),
          value: this.money(s.totalGross.value, s.totalGross.approximate),
          delta: null,
          options: {
            icon: 'account_balance_wallet',
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_GROSS_PAYROLL_HELP', { period: helpPeriod }),
          },
        },
        {
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_NET_TOTAL'),
          value: this.money(s.totalNet.value, s.totalNet.approximate),
          delta: null,
          options: {
            valueColor: 'text-primary', icon: 'payments',
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_NET_TOTAL_HELP', { period: helpPeriod }),
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
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_WITHHELD_HELP', { period: helpPeriod }),
          },
        },
        {
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_EMPLOYER_COST'),
          value: this.money(s.totalLoadedCost.value, s.totalLoadedCost.approximate),
          delta: s.totalLoadedCost.value > s.totalGross.value
            ? { value: this.t('PAYROLL.ENGINE_RESULTS.KPI_EMPLOYER_COST_SUB', { amount: this.money(s.totalLoadedCost.value - s.totalGross.value) }), direction: 'neutral' as const }
            : null,
          options: {
            icon: 'account_balance', valueColor: 'text-primary',
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_EMPLOYER_COST_HELP', { period: helpPeriod }),
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
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_COVERAGE_HELP', { period: helpPeriod }),
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

  /** Recherche, filtres RH et tri courants — paramètres de `listEmployees`. */
  private employeeQuery() {
    return {
      search: this.searchText(),
      paysId: this.paysFilter(),
      status: this.statusFilter() ?? undefined,
      department: this.departmentFilter(),
      contract: this.contractFilter(),
      sort: this.employeeSortParam(),
    };
  }

  /** Tout le périmètre filtré (toutes les pages), dans l'ordre du tri, Période et
   *  Collaborateurs recoupés — la liste complète que la pagination découpe. */
  private allFilteredEmployees(): Observable<EmployeeListItem[]> {
    return this.allowedIds().pipe(
      switchMap(ids => this.hrService.listEmployees({ ...this.employeeQuery(), page: 0, size: ALL_EMPLOYEES }).pipe(
        map(p => (p.content ?? []).filter(e => !ids || ids.has(e.userId))),
      )),
    );
  }

  load(): void {
    const current = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    const size = this.pageSize();
    // Sans Période ni Collaborateurs : pagination serveur, comme avant. Avec : le service RH
    // ne sait pas filtrer sur une liste d'identifiants, donc tout le périmètre (autres
    // filtres et tri appliqués côté RH) est demandé d'un coup, recoupé avec les userId admis,
    // puis découpé en pages ici.
    const page$: Observable<ListPage> = !this.isRestricted()
      ? this.hrService.listEmployees({ ...this.employeeQuery(), page: this.page(), size })
      : this.allFilteredEmployees().pipe(
          map(all => {
            const start = this.page() * size;
            return {
              content: all.slice(start, start + size),
              totalElements: all.length,
              totalPages: Math.ceil(all.length / size),
            };
          }),
        );
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

  // ── « Exporter Excel » : la liste filtrée entière (toutes les pages), générée par le serveur ──
  readonly exportingXlsx = signal(false);

  exportXlsx(): void {
    if (this.exportingXlsx() || this.totalElements() === 0) return;
    this.exportingXlsx.set(true);
    const lang = this.translate.currentLang() || 'fr';
    // Filtre « Période » : le serveur cumule la paie de chaque collaborateur sur ses mois ;
    // sans filtre, sur son année la plus récente (comme sa page historique).
    const [from, to] = this.periodBounds();
    this.allFilteredEmployees().pipe(
      switchMap(list => this.engineApi.exportEmployeesXlsx(list.map(e => ({
        userId:     e.userId,
        fullName:   e.fullName,
        employeeId: e.employeeId ?? null,
        department: e.department ?? null,
        contract:   e.contractType ? this.contractLabel(e.contractType) : null,
        pays:       e.paysLabel ?? null,
        status:     e.lifecycleStatus ? this.lifecycleLabel(e.lifecycleStatus) : null,
      })), lang, { from, to })),
    ).subscribe({
      next: blob => {
        this.exportingXlsx.set(false);
        const day = new Date().toISOString().slice(0, 10);
        saveBlob(blob, `${lang.startsWith('en') ? 'Payroll_employees' : 'Collaborateurs_paie'}_${day}.xlsx`);
      },
      error: err => {
        this.exportingXlsx.set(false);
        readBlobError(err, this.t('PAYROLL.ENGINE_RESULTS.EXPORT_ERROR')).then(msg => this.notification.error(msg));
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
    name: 'period',
    label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_PERIOD'),
    type: 'daterange',
    hint: this.t('PAYROLL.ENGINE_RESULTS.FILTER_PERIOD_HINT'),
  }, {
    name: 'employees',
    label: this.t('PAYROLL.ENGINE_RESULTS.FILTER_EMPLOYEES'),
    type: 'multiselect',
    searchable: true,
    placeholder: this.t('PAYROLL.ENGINE_RESULTS.FILTER_ALL'),
    options: this.employeeOptions().map(e => ({
      value: String(e.userId),
      label: e.employeeId ? `${e.fullName} (${e.employeeId})` : e.fullName,
    })),
  }, {
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
    // `daf-filter` seeds `initialValues` in its own shape — a `select` is a `string[]`.
    initialValues: {
      period:     this.periodFilter(),
      employees:  this.employeeFilter().map(String),
      pays:      this.paysFilter() != null ? [String(this.paysFilter())] : [],
      status:     this.statusFilter() ? [this.statusFilter()!] : [],
      department: this.departmentFilter() ? [this.departmentFilter()!] : [],
      contract:   this.contractFilter() ? [this.contractFilter()!] : [],
    },
  }));

  applyFilters(result: FilterResult): void {
    const raw = result['pays'] as string | null;
    const paysChanged = (raw ? Number(raw) : null) !== this.paysFilter();
    this.paysFilter.set(raw ? Number(raw) : null);
    this.periodFilter.set(rangeSeed(result['period']));
    const picked = result['employees'];
    this.employeeFilter.set((Array.isArray(picked) ? picked : picked ? [picked] : [])
      .map(v => Number(v)).filter(n => Number.isFinite(n)));
    if (paysChanged) this.loadEmployeeOptions();
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

  // ── « Calculer la paie du pays » : calcul groupé, en formulaire pop-up ─────────────────
  // Le serveur n'a pas de lancement groupé (seulement `/engine/run`, un collaborateur à la
  // fois) : la pop-up enchaîne les mêmes appels que /payroll/engine-run pour chaque
  // collaborateur en poste du pays, 3 à la fois, avec avancement et bilan. Contrat : celui
  // de la fiche RH quand le jeu de paramètres actif du pays le tarifie (CDI sans contrat
  // RH) ; sinon le collaborateur est signalé, pas calculé avec un contrat deviné. Par
  // défaut, les collaborateurs déjà calculés pour le mois sont laissés de côté (relancer
  // AJOUTE un résultat, il ne remplace pas l'existant).
  private readonly modal        = inject(ModalService);
  private readonly notification = inject(NotificationService);
  private readonly destroyRef   = inject(DestroyRef);
  private readonly userStore    = inject(UserStore);
  /** Calcul groupé réservé à qui peut lancer le moteur (même droit que `POST /engine/run`). */
  readonly canRunEngine = computed(() => this.userStore.hasPermission('PAYROLL_RUN_ENGINE'));
  /** Guide (« Aide & guides ») : sans le droit de lancer le moteur, pas de bouton de calcul groupé à montrer. */
  readonly guideSteps = computed(() => GUIDE_STEPS.filter(s => s.target !== 'res-list-batch' || this.canRunEngine()));
  private readonly batchTpl = viewChild<TemplateRef<unknown>>('batchTpl');
  private batchRef: ModalRef | null = null;
  private batchSub: Subscription | null = null;
  /** Page quittée pendant un lot : les calculs pas encore partis ne partent pas. */
  private readonly stopBatchOnDestroy = this.destroyRef.onDestroy(() => this.batchSub?.unsubscribe());

  private static readonly LEGACY_CONTRACT: Record<string, string> = {
    PERMANENT: 'CDI', FIXED_TERM: 'CDD', INTERN: 'STAGE',
  };
  private static readonly BATCH_CONCURRENCY = 3;

  readonly batchPaysId   = signal<number | null>(null);
  readonly batchMonth    = signal(new Date().getMonth() + 1);
  readonly batchYear     = signal(new Date().getFullYear());
  readonly batchJours    = signal(22);
  readonly batchSkipDone = signal(true);

  /** Données du pays et du mois choisis : personnel en poste, déjà calculés, contrats tarifés. */
  private readonly batchStaff     = signal<EmployeeListItem[]>([]);
  private readonly batchDoneIds   = signal<Set<number>>(new Set());
  private readonly batchContracts = signal<string[]>([]);
  readonly batchPsMissing = signal(false);
  readonly batchPrepLoading = signal(false);

  readonly batchRunning  = signal(false);
  readonly batchFinished = signal(false);
  readonly batchProgress = signal({ done: 0, total: 0, ok: 0, failed: 0 });
  readonly batchFailures = signal<{ name: string; reason: string }[]>([]);

  readonly batchPaysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})` })));

  readonly batchMonthOptions = computed<SelectOption[]>(() => {
    const locale = this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
    return Array.from({ length: 12 }, (_, i) => {
      const name = new Date(2000, i, 1).toLocaleDateString(locale, { month: 'long' });
      return { value: String(i + 1), label: name.charAt(0).toUpperCase() + name.slice(1) };
    });
  });

  readonly batchYearOptions = computed<SelectOption[]>(() => {
    const now = new Date().getFullYear();
    const years = new Set<number>([now - 3, now - 2, now - 1, now, now + 1, this.batchYear()]);
    return [...years].sort((a, b) => b - a).map(y => ({ value: String(y), label: String(y) }));
  });

  /** Contrat appliqué à un collaborateur, ou `null` si son contrat n'est pas tarifé. */
  private batchContractOf(e: EmployeeListItem): string | null {
    const types = this.batchContracts();
    const code = e.contractType?.trim().toUpperCase();
    const hr = code ? (EngineResultsListComponent.LEGACY_CONTRACT[code] ?? code) : 'CDI';
    return types.includes(hr) ? hr : null;
  }

  /** Collaborateurs à calculer, et ceux laissés de côté (déjà calculés / contrat non tarifé). */
  readonly batchPlan = computed(() => {
    const done = this.batchDoneIds();
    const skipDone = this.batchSkipDone();
    const targets: { e: EmployeeListItem; contract: string }[] = [];
    let alreadyDone = 0;
    const unpriced: EmployeeListItem[] = [];
    for (const e of this.batchStaff()) {
      if (skipDone && done.has(e.userId)) { alreadyDone++; continue; }
      const contract = this.batchContractOf(e);
      if (contract) targets.push({ e, contract }); else unpriced.push(e);
    }
    return { targets, alreadyDone, unpriced, staff: this.batchStaff().length, doneCount: done.size };
  });

  readonly batchPeriodText = computed(() => {
    const locale = this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
    return new Date(this.batchYear(), this.batchMonth() - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  });

  readonly batchPercent = computed(() => {
    const p = this.batchProgress();
    return p.total ? Math.round(p.done / p.total * 100) : 0;
  });

  canBatch(): boolean {
    return !!this.batchPaysId() && !this.batchPrepLoading() && !this.batchRunning() && !this.batchFinished()
      && this.batchJours() >= 1 && this.batchPlan().targets.length > 0;
  }

  openBatch(): void {
    if (this.batchRunning()) { this.batchRef = this.openBatchModal(); return; }
    this.batchFinished.set(false);
    this.batchFailures.set([]);
    this.batchProgress.set({ done: 0, total: 0, ok: 0, failed: 0 });
    this.batchMonth.set(new Date().getMonth() + 1);
    this.batchYear.set(new Date().getFullYear());
    this.batchJours.set(22);
    this.batchSkipDone.set(true);
    // Pays filtré de la liste, s'il y en a un.
    this.batchPaysId.set(this.paysFilter());
    this.prepareBatch();
    this.batchRef = this.openBatchModal();
  }

  /** Boutons dans le corps du formulaire (template) : ceux de la pop-up ne sont pas réactifs,
   *  ils ne pourraient ni se griser pendant le calcul ni devenir « Fermer » à la fin. */
  private openBatchModal(): ModalRef {
    return this.modal.open({
      resizable: true,
      maximizable: true,
      minWidth: '360px',
      minHeight: '260px',
      title: this.t('PAYROLL.ENGINE_RESULTS.BATCH_TITLE'),
      subtitle: this.t('PAYROLL.ENGINE_RESULTS.BATCH_SUBTITLE'),
      icon: 'calculate',
      body: this.batchTpl()!,
      size: 'md',
      closeOnBackdrop: false,
      buttons: [],
    });
  }

  closeBatch(): void {
    this.batchRef?.close();
    this.batchRef = null;
  }

  onBatchPaysChange(selected: string[]): void {
    const id = selected[0] ? +selected[0] : null;
    if (id === this.batchPaysId()) return;
    this.batchPaysId.set(id);
    this.prepareBatch();
  }

  setBatchMonth(selected: string[]): void {
    if (!selected[0] || +selected[0] === this.batchMonth()) return;
    this.batchMonth.set(+selected[0]);
    this.prepareBatch();
  }

  setBatchYear(selected: string[]): void {
    if (!selected[0] || +selected[0] === this.batchYear()) return;
    this.batchYear.set(+selected[0]);
    this.prepareBatch();
  }

  private prepSeq = 0;
  /** Recharge le personnel du pays, les déjà-calculés du mois et les contrats tarifés. */
  private prepareBatch(): void {
    const seq = ++this.prepSeq;
    const paysId = this.batchPaysId();
    this.batchFinished.set(false);
    this.batchFailures.set([]);
    this.batchStaff.set([]);
    this.batchDoneIds.set(new Set());
    this.batchContracts.set([]);
    this.batchPsMissing.set(false);
    if (paysId == null) { this.batchPrepLoading.set(false); return; }
    this.batchPrepLoading.set(true);
    const y = this.batchYear(), m = this.batchMonth();
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    forkJoin({
      staff: this.hrService.listEmployees({ paysId, page: 0, size: ALL_EMPLOYEES, sort: 'fullName,asc' })
        .pipe(map(p => p.content ?? []), catchError(() => of([] as EmployeeListItem[]))),
      done: this.engineApi.getEmployeesWithResults({ paysId, from: first, to: last })
        .pipe(catchError(() => of([] as number[]))),
      ps: this.payrollApi.getActiveParameterSet(paysId).pipe(catchError(() => of(null))),
    }).subscribe(r => {
      if (seq !== this.prepSeq) return;
      this.batchStaff.set(r.staff);
      this.batchDoneIds.set(new Set(r.done));
      this.batchContracts.set([...new Set((r.ps?.socialChargeRates ?? []).map(x => x.contractType))]);
      this.batchPsMissing.set(!r.ps);
      this.batchPrepLoading.set(false);
    });
  }

  runBatch(): void {
    if (!this.canBatch()) return;
    const paysId = this.batchPaysId()!;
    const periodYear = this.batchYear(), periodMonth = this.batchMonth(), jours = this.batchJours();
    const plan = this.batchPlan();
    this.batchRunning.set(true);
    this.batchFinished.set(false);
    // Contrats non tarifés : signalés d'emblée dans le bilan, sans appel au moteur.
    this.batchFailures.set(plan.unpriced.map(e => ({
      name: e.fullName,
      reason: this.t('PAYROLL.ENGINE_RESULTS.BATCH_UNPRICED', {
        contract: e.contractType ? contractTypeLabel(e.contractType, this.translate) : '—',
      }),
    })));
    this.batchProgress.set({ done: 0, total: plan.targets.length, ok: 0, failed: 0 });

    this.batchSub = from(plan.targets).pipe(
      mergeMap(({ e, contract }) => this.engineApi.runPayroll({
        employeeId: e.userId, paysId, periodYear, periodMonth, contractTypeCode: contract, joursOuvresMois: jours,
      }).pipe(
        map(() => ({ e, error: null as string | null })),
        catchError(err => of({ e, error: (err?.error?.detail as string) ?? (err?.error?.message as string) ?? this.t('PAYROLL.ENGINE_RUN.ERROR') })),
      ), EngineResultsListComponent.BATCH_CONCURRENCY),
    ).subscribe({
      next: r => {
        this.batchProgress.update(p => ({
          ...p, done: p.done + 1, ok: p.ok + (r.error ? 0 : 1), failed: p.failed + (r.error ? 1 : 0),
        }));
        if (r.error) this.batchFailures.update(list => [...list, { name: r.e.fullName, reason: r.error! }]);
      },
      complete: () => this.finishBatch(),
    });
  }

  /** Arrête le lot : les calculs déjà partis vont au bout côté serveur, les suivants non. */
  stopBatch(): void {
    this.batchSub?.unsubscribe();
    this.finishBatch();
  }

  private finishBatch(): void {
    if (!this.batchRunning()) return;
    this.batchSub = null;
    this.batchRunning.set(false);
    this.batchFinished.set(true);
    const p = this.batchProgress();
    this.notification.success(this.t('PAYROLL.ENGINE_RESULTS.BATCH_DONE', { ok: p.ok, period: this.batchPeriodText() }));
    // Liste et bandeau KPI à jour avec les nouveaux résultats.
    this.load();
    this.loadKpis();
  }
}
