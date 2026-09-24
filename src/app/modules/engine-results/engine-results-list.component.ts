import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, forkJoin, map, of } from 'rxjs';
import { HrProfileService, type EmployeeListItem } from '../../core/hr-profile.service';
import { PayrollEngineService, type PayrollResultsSummaryDto } from '../../core/payroll-engine.service';
import { UserStore } from '../../core/user.store';
import { CURRENCY_GLYPHS, CurrencyService, SUPPORTED_CURRENCIES } from '../../core/currency.service';
import {
  CardComponent,
  DataTableComponent,
  EntityCardComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  PaginationComponent,
  RadialMenuComponent,
  SearchToolbarComponent,
  type BreadcrumbItem,
  type RadialMenuConfig,
  type RadialMenuItem,
  type EntityCardOptions,
  type FilterField,
  type FilterResult,
  type MetricCardOptions,
  type SearchToolbarFilterConfig,
  type TableColumn,
  type TableRow,
  type ToolbarToggleOption,
} from '@khalilrebhiitec/daf360';
import { environment } from '../../../environments/environment';
import { rememberEmployee } from './engine-results-employee';

interface PaysItem { id: number; iso_code: string; french_label: string; }

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
    CardComponent, DataTableComponent, EntityCardComponent, MetricCardComponent, PageComponent,
    PageHeaderComponent, PaginationComponent, RadialMenuComponent, SearchToolbarComponent,
  ],
  templateUrl: './engine-results-list.component.html',
  styleUrl: './engine-results-list.component.scss',
})
export class EngineResultsListComponent implements OnInit {
  private readonly hrService = inject(HrProfileService);
  private readonly engineApi = inject(PayrollEngineService);
  private readonly userStore = inject(UserStore);
  private readonly currency  = inject(CurrencyService);
  private readonly http      = inject(HttpClient);
  private readonly router    = inject(Router);
  private readonly route     = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.ENGINE_RESULTS.BREADCRUMB') },
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

  private readonly paysList = signal<PaysItem[]>([]);

  ngOnInit(): void {
    this.http.get<PaysItem[]>(`${environment.hrApiUrl}/api/hr/config/hs/pays-list`)
      .pipe(catchError(() => of([] as PaysItem[])))
      .subscribe(list => this.paysList.set(list));
    // Pays du profil connecté par défaut, comme /payroll/candidate-simulation : les KPI
    // paie ont besoin d'un pays (une seule devise). Le filtre reste modifiable.
    this.paysFilter.set(this.userStore.currentUser()?.paysId ?? null);
    this.load();
    this.loadKpis();
  }

  // ── Bandeau KPI paie ─────────────────────────────────────────────────
  // Totaux du dernier mois calculé (`/engine/results/summary`) pour le pays filtré —
  // un montant n'a de sens que dans une seule devise, d'où l'absence de bandeau sur
  // "tous les pays". La couverture compare les collaborateurs calculés à l'effectif en
  // poste du service RH (même endpoint que la liste, `size=1` : seul `totalElements`
  // compte). Suit le filtre pays, pas la recherche texte.
  readonly summary  = signal<PayrollResultsSummaryDto | null>(null);
  readonly headcount = signal<number | null>(null);
  private kpiSeq = 0;

  loadKpis(): void {
    const current = ++this.kpiSeq;
    const paysId = this.paysFilter();
    this.summary.set(null);
    this.headcount.set(null);
    if (paysId == null) return;
    forkJoin({
      summary: this.engineApi.getResultsSummary(paysId).pipe(catchError(() => of(null))),
      headcount: this.hrService.listEmployees({ paysId, page: 0, size: 1 }).pipe(
        map(p => p.totalElements ?? 0),
        catchError(() => of(null)),
      ),
    }).subscribe(r => {
      if (current !== this.kpiSeq) return;
      this.summary.set(r.summary);
      this.headcount.set(r.headcount);
    });
  }

  // ── Devise d'affichage (daf-radial-menu, comme le sélecteur devise de finance) ──
  // Les totaux arrivent dans la devise du pays ; le menu les convertit au taux du jour.
  // `displayCurrency()` = devise réellement affichée (le choix, sinon celle du pays).
  readonly displayCurrency = computed(() =>
    this.currency.display() ?? this.summary()?.currencyCode ?? null);
  readonly isConverted = computed(() => {
    const src = this.summary()?.currencyCode;
    const shown = this.displayCurrency();
    return !!src && !!shown && src !== shown;
  });

  readonly currencyItems = computed<RadialMenuItem[]>(() =>
    SUPPORTED_CURRENCIES.map(code => ({
      id: code,
      glyph: CURRENCY_GLYPHS[code],
      label: this.t(`PAYROLL.ENGINE_RESULTS.CURRENCY.${code}`),
    })));

  readonly currencyMenuConfig = computed<RadialMenuConfig>(() => ({
    label: this.t('PAYROLL.ENGINE_RESULTS.CURRENCY.TITLE'),
    maxVisible: SUPPORTED_CURRENCIES.length,
    // Rien à convertir sans totaux (pas de pays filtré, ou service en échec).
    disabled: !this.summary()?.currencyCode,
  }));

  onCurrencyPick(item: RadialMenuItem): void {
    this.currency.setDisplay(item.id);
  }

  private money(v: number, source: string | null): string {
    const target = this.displayCurrency();
    const amount = source && target ? this.currency.convert(v ?? 0, source, target) : (v ?? 0);
    const locale = this.translate.getCurrentLang() === 'en' ? 'en-US' : 'fr-FR';
    if (target) {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: target, maximumFractionDigits: 0 })
          .format(amount);
      } catch { /* code ISO inconnu d'Intl — repli ci-dessous */ }
    }
    const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
    return target ? `${n} ${target}` : n;
  }

  /** Les quatre tuiles, prêtes pour le template — `null` sans pays ou sans réponse. */
  readonly kpiTiles = computed(() => {
    const s = this.summary();
    if (!s) return null;
    const period = s.periodMonth && s.periodYear
      ? `${String(s.periodMonth).padStart(2, '0')}/${s.periodYear}`
      : this.t('PAYROLL.ENGINE_RESULTS.KPI_NO_PERIOD');
    const headcount = this.headcount();
    const failures = s.convergenceFailures;
    return {
      period,
      tiles: [
        {
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_GROSS_PAYROLL'),
          value: this.money(s.totalGross, s.currencyCode),
          options: {
            icon: 'account_balance_wallet',
            helpTitle: this.t('PAYROLL.ENGINE_RESULTS.KPI_GROSS_PAYROLL'),
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_GROSS_PAYROLL_HELP', { period }),
          },
        },
        {
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_LOADED_COST'),
          value: this.money(s.totalLoadedCost, s.currencyCode),
          options: {
            valueColor: 'text-primary', icon: 'account_balance',
            helpTitle: this.t('PAYROLL.ENGINE_RESULTS.KPI_LOADED_COST'),
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_LOADED_COST_HELP', { period }),
          },
        },
        {
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_COVERAGE'),
          value: headcount != null ? `${s.employeeCount} / ${headcount}` : String(s.employeeCount),
          options: {
            icon: 'fact_check',
            ...(headcount != null && s.employeeCount >= headcount && headcount > 0
              ? { valueColor: 'text-success', iconColor: 'text-success', iconBg: 'bg-success/10' }
              : {}),
            helpTitle: this.t('PAYROLL.ENGINE_RESULTS.KPI_COVERAGE'),
            help: this.t('PAYROLL.ENGINE_RESULTS.KPI_COVERAGE_HELP', { period }),
          },
        },
        {
          label: this.t('PAYROLL.ENGINE_RESULTS.KPI_CONVERGENCE_FAILURES'),
          value: failures,
          options: failures > 0
            ? { valueColor: 'text-danger', icon: 'error', iconColor: 'text-danger', iconBg: 'bg-danger/10',
                helpTitle: this.t('PAYROLL.ENGINE_RESULTS.KPI_CONVERGENCE_FAILURES'),
                help: this.t('PAYROLL.ENGINE_RESULTS.KPI_CONVERGENCE_FAILURES_HELP', { period }) }
            : { valueColor: 'text-success', icon: 'verified', iconColor: 'text-success', iconBg: 'bg-success/10',
                helpTitle: this.t('PAYROLL.ENGINE_RESULTS.KPI_CONVERGENCE_FAILURES'),
                help: this.t('PAYROLL.ENGINE_RESULTS.KPI_CONVERGENCE_FAILURES_HELP', { period }) },
        },
      ] satisfies { label: string; value: string | number; options: MetricCardOptions }[],
    };
  });

  /** Une requête à chaque changement de recherche/filtre/page. Les réponses d'une
   *  requête dépassée sont ignorées (`seq`), pour qu'une frappe rapide ne ré-affiche
   *  pas une page plus ancienne arrivée en retard. */
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
        this.error.set(e?.error?.message ?? this.t('PAYROLL.ENGINE_RESULTS.ERROR_EMPLOYEES'));
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
    placeholder: this.t('PAYROLL.ENGINE_RESULTS.FILTER_ALL'),
    options: this.paysList().map(p => ({ value: String(p.id), label: `${p.french_label} (${p.iso_code})` })),
  }]);

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.ENGINE_RESULTS.FILTER_EMPLOYEES_TITLE'),
    applyLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_RESET'),
    triggerLabel: this.t('PAYROLL.ENGINE_RESULTS.FILTER_TRIGGER'),
    // `daf-filter` seeds `initialValues` in its own shape — a `select` is a `string[]`.
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
        viewLabel: this.t('PAYROLL.ENGINE_RESULTS.VIEW_HISTORY'),
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
}
