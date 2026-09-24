import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  AvatarComponent,
  ButtonComponent,
  CardComponent,
  DataTableComponent,
  FormFieldComponent,
  MetricCardComponent,
  MultiDatePickerComponent,
  PageComponent,
  PageHeaderComponent,
  SearchToolbarComponent,
  SectionTitleComponent,
  SelectComponent,
  StatusBadgeComponent,
  TabsComponent,
  deriveInitials,
  type BadgeVariant,
  type BreadcrumbItem,
  type MetricDelta,
  type PageHeaderBadge,
  type SelectOption,
  type TabItem,
  type TableColumn,
  type TableRow,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, PaysDto } from '../../core/payroll-api.service';
import { PayrollEngineService, RunPayrollResponse } from '../../core/payroll-engine.service';
import { EmployeeSelectComponent } from '../../shared/employee-select/employee-select.component';
import { EmployeeListItem } from '../../core/hr-profile.service';
import { NotificationService } from '../../core/notification.service';

/** One tile in the input sidebar's "recent presets" strip — saved to `localStorage`
 *  after each successful run, not backed by any API (no preset endpoint exists). */
interface EnginePreset {
  key: string;
  chipLabel: string;
  paysId: number;
  employeeId: number;
  employeeLabel: string;
  periodYear: number;
  periodMonth: number;
  contractTypeCode: string;
  joursOuvresMois: number;
}

/** One slice of the loaded cost, for the stacked bar + legend — same shape as
 *  `simulator.component.ts`'s `BreakdownSegment`. */
interface CostBreakdownSegment {
  key:    string;
  label:  string;
  amount: number;
  /** Share of the loaded cost, 0–100. */
  pct:    number;
  /** Complete literal Tailwind classes — a runtime-built `bg-${x}` compiles to nothing. */
  bar:    string;
  dot:    string;
}

type RubriqueTab = 'all' | 'credit' | 'debit';

const PRESETS_STORAGE_KEY = 'payroll.engineRun.recentPresets';
const MAX_PRESETS = 5;

/** ISO 3166-1 alpha-2 → flag emoji, e.g. "FR" → 🇫🇷. Pure client-side computation, no
 *  flag asset/data needed — `PaysDto` only carries the two-letter code. */
function flagEmoji(isoCode: string | null | undefined): string {
  if (!isoCode || isoCode.length !== 2) return '';
  const points = [...isoCode.toUpperCase()].map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...points);
}

/**
 * `/payroll/engine-run` — "cockpit" layout: a persistent input sidebar (left) next to a
 * live results dashboard (right), so a payroll manager can tweak one parameter and re-run
 * without losing the result on screen (no more accordion that collapses the form away).
 *
 * A few things the redesign brief asked for have no backing data anywhere in this app yet
 * (contractual hourly base, personalized PAS rate, Navigo/meal-voucher amounts, collective-
 * agreement/IDCC code, employee grade/échelon, a per-rubrique employer-charges split) —
 * `RunPayrollResponse`/`PaysDto`/`EmployeeListItem` carry none of it. Rather than hardcode
 * placeholder numbers that would look real, those pieces (the "Hypothèses de calcul" panel,
 * the convention-collective subtitle, the employer/employee 3-way column split) are left out
 * until the backend has the fields; everything else in the brief is built from real data.
 */
@Component({
  selector: 'app-engine-run',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule, TranslatePipe, EmployeeSelectComponent,
    AvatarComponent, ButtonComponent, CardComponent, DataTableComponent, FormFieldComponent,
    MetricCardComponent, MultiDatePickerComponent, PageComponent, PageHeaderComponent, SearchToolbarComponent,
    SectionTitleComponent, SelectComponent, StatusBadgeComponent, TabsComponent,
  ],
  template: `
    <daf-page [loading]="pageLoading()" [kpis]="0" [breadcrumbs]="true" headerSize="md">
      <daf-page-header
        [title]="'PAYROLL.ENGINE_RUN.TITLE' | translate"
        [subtitle]="'PAYROLL.ENGINE_RUN.SUBTITLE' | translate"
        [breadcrumbs]="breadcrumbs()"
        [breadcrumbLabel]="'PAYROLL.ENGINE_RUN.BREADCRUMB_ARIA' | translate"
        [badges]="headerBadges()"
        size="md">
        <div pageActions class="topbar-actions">
          <daf-button
            [label]="'PAYROLL.ENGINE_RUN.COMPARE_BUTTON' | translate"
            variant="ghost"
            [options]="{ iconStart: 'trending_up', disabled: !result() || comparing(), loading: comparing() }"
            (onClick)="compareWithPreviousYear()">
          </daf-button>
          <daf-button
            [label]="'PAYROLL.ENGINE_RUN.EXPORT_CSV' | translate"
            variant="ghost"
            [options]="{ iconStart: 'download', disabled: !result() }"
            (onClick)="exportRubriquesCsv()">
          </daf-button>
        </div>
      </daf-page-header>

      <!-- ══════════════════════ BANDEAU KPI — pleine largeur, en haut de page ══════════════════════
           Comme /finance/affaires/1?tab=overview, dont les indicateurs dominent le haut de la
           colonne de contenu avant tout split : ces 4 cartes sortent de la zone .cockpit-main
           (où elles n'occupaient que la largeur de la colonne de résultats, à côté de la sidebar)
           pour s'afficher sur toute la largeur de la page, avant le split sidebar/résultats. -->
      @if (result(); as r) {
        <daf-card
          [options]="{ variant: 'flat', padding: 'lg', radius: 'xl', accent: r.convergenceOk ? 'success' : 'danger' }"
          class="kpi-banner kpi-banner--top">
          <div class="kpi-banner__status">
            <daf-badge
              [label]="(r.convergenceOk ? 'PAYROLL.ENGINE_RUN.CONVERGENCE_OK' : 'PAYROLL.ENGINE_RUN.CONVERGENCE_FAILED') | translate"
              [options]="{ variant: r.convergenceOk ? 'success' : 'danger', size: 'md' }">
            </daf-badge>
            @if (r.iterationsUsed) {
              <span class="kpi-banner__note">{{ 'PAYROLL.ENGINE_RUN.ITERATIONS_SUFFIX' | translate: { count: r.iterationsUsed } }}</span>
            }
            @if (compareResult(); as c) {
              <span class="kpi-banner__note">{{ 'PAYROLL.ENGINE_RUN.COMPARE_TAG' | translate: { year: c.periodYear } }}</span>
            }
          </div>
          <div class="kpi-grid">
            <daf-metric-card
              [label]="'PAYROLL.ENGINE_RUN.KPI_NET_PAY' | translate"
              [value]="(r.strate5 | number:'1.2-2') ?? ''"
              [delta]="netPayDelta()"
              [options]="{ valueColor: 'text-primary', icon: 'payments', iconBg: 'bg-primary/10', iconColor: 'text-primary' }">
            </daf-metric-card>
            <daf-metric-card
              [label]="'PAYROLL.ENGINE_RUN.KPI_EMPLOYER_COST' | translate"
              [value]="(r.loadedCost | number:'1.2-2') ?? ''"
              [delta]="loadedCostDelta()"
              [options]="{ icon: 'account_balance', iconBg: 'bg-teal/10', iconColor: 'text-teal' }">
            </daf-metric-card>
            <daf-metric-card
              [label]="'PAYROLL.ENGINE_RUN.KPI_TAXABLE_NET' | translate"
              [value]="(r.strate4 | number:'1.2-2') ?? ''"
              [delta]="taxableNetDelta()"
              [options]="{ icon: 'account_balance_wallet', iconBg: 'bg-tertiary/10', iconColor: 'text-tertiary' }">
            </daf-metric-card>
            <daf-metric-card
              [label]="'PAYROLL.ENGINE_RUN.STRATE_IRPP' | translate"
              [value]="(r.aggregateIrpp | number:'1.2-2') ?? ''"
              [delta]="irppDelta()"
              [options]="{ icon: 'request_quote', iconBg: 'bg-warning/10', iconColor: 'text-warning' }">
            </daf-metric-card>
          </div>
        </daf-card>
      }

      <div class="cockpit">
        <!-- ══════════════════════ SIDEBAR — PARAMÈTRES DE CALCUL ══════════════════════ -->
        <aside class="cockpit-sidebar">
          <daf-card [options]="{ variant: 'outlined', padding: 'lg', radius: 'xl' }" class="sidebar-card">

            <div class="sidebar-header">
              <div class="sidebar-header__top">
                <h2 class="sidebar-header__title">{{ 'PAYROLL.ENGINE_RUN.SIDEBAR_TITLE' | translate }}</h2>
                <daf-badge [label]="readyBadge().label" [options]="{ variant: readyBadge().variant, size: 'sm' }" />
              </div>
              <p class="sidebar-header__subtitle">{{ 'PAYROLL.ENGINE_RUN.SIDEBAR_SUBTITLE' | translate }}</p>
            </div>

            @if (recentPresets().length) {
              <div class="presets">
                <span class="presets__label">{{ 'PAYROLL.ENGINE_RUN.PRESETS_LABEL' | translate }}</span>
                <div class="presets__chips">
                  @for (p of recentPresets(); track p.key) {
                    <button type="button" class="preset-chip" (click)="loadPreset(p)">{{ p.chipLabel }}</button>
                  }
                </div>
              </div>
            }

            <div class="sidebar-field">
              <daf-select
                [options]="paysOptions()"
                [selected]="paysId() ? ['' + paysId()] : []"
                [config]="{ label: 'PAYROLL.ENGINE_RUN.PAYS' | translate, placeholder: 'PAYROLL.SELECT.PAYS_PLACEHOLDER' | translate, searchable: true, fullWidth: true }"
                (selectedChange)="paysId.set($event[0] ? +$event[0] : null)">
              </daf-select>
            </div>

            <div class="sidebar-field">
              <label class="sidebar-field__label">{{ 'PAYROLL.ENGINE_RUN.EMPLOYEE' | translate }}</label>
              <app-employee-select
                [formControl]="$any(employeeIdCtrl)"
                [paysId]="paysId()"
                (employeeSelected)="onEmployeeSelected($event)">
              </app-employee-select>

              @if (selectedEmployee(); as emp) {
                <div class="employee-summary">
                  <daf-avatar [data]="{ name: emp.fullName, subtitle: employeeSubtitle(emp) }" size="md" />
                  @if (employeeStatusBadge(); as b) {
                    <daf-badge [label]="b.label" [options]="{ variant: b.variant, size: 'sm' }" />
                  }
                </div>
              }
            </div>

            <div class="sidebar-field">
              <daf-multi-date-picker
                [config]="{ label: 'PAYROLL.ENGINE_RUN.PERIOD' | translate, selectionMode: 'single', fullWidth: true }"
                [value]="periodDate()"
                (valueChange)="onPeriodChange($event)">
              </daf-multi-date-picker>
              <span class="period-range">{{ periodRangeLabel() }}</span>
            </div>

            <div class="sidebar-row">
              <daf-select
                [options]="contractTypeOptions()"
                [selected]="[contractTypeCode()]"
                [config]="{ label: 'PAYROLL.ENGINE_RUN.CONTRACT_TYPE' | translate, fullWidth: true }"
                (selectedChange)="contractTypeCode.set($event[0])">
              </daf-select>
              <daf-form-field
                [options]="{ label: 'PAYROLL.ENGINE_RUN.WORKDAYS' | translate, type: 'number', prefixIcon: 'calendar_view_day', suffixText: 'j' }"
                [value]="joursOuvresMois()"
                (valueChange)="joursOuvresMois.set(+($event ?? 0))">
              </daf-form-field>
            </div>

            @if (error()) {
              <div class="alert alert--error">{{ error() }}</div>
            }

            <div class="sidebar-actions">
              <daf-button
                [label]="(running() ? 'PAYROLL.ENGINE_RUN.RUNNING' : 'PAYROLL.ENGINE_RUN.RUN_BUTTON') | translate"
                variant="teal"
                [options]="{ loading: running(), disabled: !canRun() || running(), iconStart: 'calculate', fullWidth: true }"
                (onClick)="run()">
              </daf-button>
              <div class="sidebar-actions__status">
                <button type="button" class="sidebar-reset" (click)="reset()">{{ 'PAYROLL.ENGINE_RUN.RESET_BUTTON' | translate }}</button>
                @if (result(); as r) {
                  <span class="sidebar-last-run">{{ 'PAYROLL.ENGINE_RUN.LAST_RUN_AT' | translate: { date: (r.calculatedAt | date:'dd/MM/yyyy HH:mm') } }}</span>
                }
              </div>
            </div>
          </daf-card>
        </aside>

        <!-- ══════════════════════ ZONE PRINCIPALE — RÉSULTATS ══════════════════════ -->
        <main class="cockpit-main">
          @if (!result() && !running()) {
            <daf-card [options]="{ variant: 'outlined', padding: 'lg', radius: 'xl' }">
              <p class="empty-state">{{ 'PAYROLL.ENGINE_RUN.EMPTY_RESULT_HINT' | translate }}</p>
            </daf-card>
          }

          @if (result()) {
            <!-- ── Décomposition du coût chargé — barre empilée + légende, même pattern
                 que /payroll/simulator (RESULT.BREAKDOWN_*) plutôt que 5 cartes déconnectées :
                 les segments sont de vraies parts indépendantes qui somment au coût chargé,
                 pas les strates cumulées (voir costBreakdown() ci-dessous). ── -->
            <daf-card [options]="{ variant: 'outlined', padding: 'lg', radius: 'xl' }">
              <daf-section-title [title]="'PAYROLL.ENGINE_RUN.COST_BREAKDOWN_TITLE' | translate" />
              <div class="flex flex-col gap-3">
                <div
                  class="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-container"
                  role="img"
                  [attr.aria-label]="'PAYROLL.ENGINE_RUN.COST_BREAKDOWN_ARIA' | translate">
                  @for (seg of costBreakdown(); track seg.key) {
                    <span class="block h-full" [class]="seg.bar" [style.width.%]="seg.pct"></span>
                  }
                </div>
                <div class="flex flex-col">
                  @for (seg of costBreakdown(); track seg.key) {
                    <div class="flex items-center gap-3 border-b border-outline-variant/40 py-2 last:border-0 text-[12px] tabular-nums">
                      <span class="h-2 w-2 shrink-0 rounded-full" [class]="seg.dot"></span>
                      <span class="flex-1 min-w-0 truncate text-on-surface-variant">{{ seg.label }}</span>
                      <span class="w-24 text-right tabular-nums">{{ seg.amount | number:'1.2-2' }}</span>
                      <span class="w-14 text-right text-outline">{{ seg.pct | number:'1.0-1' }} %</span>
                    </div>
                  }
                </div>
              </div>
            </daf-card>

            <!-- ── Détail des rubriques ────────────────────────────────────────────── -->
            <daf-card [options]="{ variant: 'outlined', padding: 'lg', radius: 'xl' }">
              <div class="rubrique-toolbar">
                <daf-tabs #rubriqueTabsRef
                  [tabs]="rubriqueTabItems()" [(active)]="rubriqueTab"
                  idPrefix="engine-run-rubriques"
                  [tabsLabel]="'PAYROLL.ENGINE_RUN.TABS_ARIA' | translate" />
                <daf-search-toolbar class="min-w-0 flex-1" [card]="false"
                  [placeholder]="'PAYROLL.ENGINE_RUN.SEARCH_PLACEHOLDER' | translate"
                  [(value)]="rubriqueSearch"
                  [debounce]="200">
                </daf-search-toolbar>
              </div>
              <div role="tabpanel"
                   [id]="rubriqueTabsRef.panelId(rubriqueTab())"
                   [attr.aria-labelledby]="rubriqueTabsRef.tabId(rubriqueTab())">
                <daf-data-table [columns]="rubriqueColumns()" [rows]="rubriqueRows()" />
              </div>
            </daf-card>
          }
        </main>
      </div>
    </daf-page>
  `,
  styles: [`
    .topbar-actions { display: flex; gap: .5rem; flex-wrap: wrap; }

    /* ── Bandeau KPI pleine largeur, en haut de page (avant le split cockpit) ────── */
    .kpi-banner--top { margin: 0 2rem 1.5rem; }

    /* ── Split-screen cockpit ─────────────────────────────────────────────── */
    .cockpit         { display: flex; align-items: flex-start; gap: 1.5rem; padding: 0 2rem 2rem; }
    .cockpit-sidebar { flex: 0 0 360px; position: sticky; top: 1.5rem; }
    .cockpit-main    { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 1.5rem; }
    @media (max-width: 1024px) {
      .cockpit          { flex-direction: column; }
      .cockpit-sidebar  { flex-basis: auto; width: 100%; position: static; }
    }

    /* ── Sidebar ──────────────────────────────────────────────────────────── */
    .sidebar-card    { display: flex; flex-direction: column; gap: 1.25rem; }
    .sidebar-header__top    { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
    .sidebar-header__title  { margin: 0; font-size: 1.0625rem; font-weight: 600; }
    .sidebar-header__subtitle { margin: .25rem 0 0; font-size: .8125rem; color: var(--color-on-surface-variant, #6b7280); }

    .presets         { display: flex; flex-direction: column; gap: .5rem; }
    .presets__label  { font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .03em;
                        color: var(--color-on-surface-variant, #6b7280); }
    .presets__chips  { display: flex; flex-wrap: wrap; gap: .5rem; }
    .preset-chip     { border: 1px solid var(--color-outline-variant, #c5c6cd); background: var(--color-surface-container-low, #f2f4f6);
                        border-radius: 999px; padding: .3rem .75rem; font-size: .75rem; font-weight: 500;
                        cursor: pointer; transition: background .15s, border-color .15s; }
    .preset-chip:hover { background: var(--color-tertiary-container, #d7f7f2); border-color: var(--color-tertiary, #00c1ad); }

    .sidebar-field        { display: flex; flex-direction: column; gap: .375rem; }
    .sidebar-field__label { font-size: .875rem; font-weight: 500; }
    .sidebar-row          { display: flex; gap: .75rem; }
    .sidebar-row > *      { flex: 1; min-width: 0; }

    .employee-summary { display: flex; align-items: center; justify-content: space-between; gap: .5rem;
                         margin-top: .5rem; padding: .625rem .75rem; border-radius: .625rem;
                         background: var(--color-surface-container-low, #f2f4f6); }

    .period-range     { font-size: .75rem; color: var(--color-on-surface-variant, #6b7280); }

    .sidebar-actions          { display: flex; flex-direction: column; gap: .625rem; margin-top: .25rem; }
    .sidebar-actions__status  { display: flex; align-items: center; justify-content: space-between; gap: .5rem; flex-wrap: wrap; }
    .sidebar-reset            { background: none; border: none; padding: 0; font-size: .8125rem; font-weight: 500;
                                 color: var(--color-on-surface-variant, #6b7280); cursor: pointer; text-decoration: underline; }
    .sidebar-reset:hover      { color: var(--color-on-surface, #191c1e); }
    .sidebar-last-run         { font-size: .75rem; color: var(--color-on-surface-variant, #6b7280); }

    .alert--error { background: #fee2e2; color: #991b1b; padding: .75rem 1rem; border-radius: 6px; font-size: .875rem; }

    /* ── Main / résultats ─────────────────────────────────────────────────── */
    .empty-state   { text-align: center; color: var(--color-on-surface-variant, #6b7280); margin: 2rem 0; }

    .kpi-banner            { display: flex; flex-direction: column; gap: 1rem; }
    .kpi-banner__status    { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
    .kpi-banner__note      { font-size: .8125rem; color: var(--color-on-surface-variant, #6b7280); }
    .kpi-grid              { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1.25rem; }

    .rubrique-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem;
                         flex-wrap: wrap; margin-bottom: 1rem; }
  `],
})
export class EngineRunComponent implements OnInit {
  private readonly api          = inject(PayrollEngineService);
  private readonly payrollApi   = inject(PayrollApiService);
  private readonly translate    = inject(TranslateService);
  private readonly notification = inject(NotificationService);

  /** Même pattern que les autres pages : traduction synchrone pour ce qui ne passe pas
   *  par le pipe `| translate` du template. */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly running = signal(false);
  readonly error   = signal<string | null>(null);
  readonly result  = signal<RunPayrollResponse | null>(null);

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.ENGINE_RUN.BREADCRUMB_GROUP') },
    { label: this.t('PAYROLL.ENGINE_RUN.BREADCRUMB') },
  ]);

  readonly headerBadges = computed((): PageHeaderBadge[] => {
    const r = this.result();
    if (!r) return [];
    return [{
      label: this.t(r.convergenceOk ? 'PAYROLL.ENGINE_RUN.CONVERGENCE_OK' : 'PAYROLL.ENGINE_RUN.CONVERGENCE_FAILED'),
      variant: r.convergenceOk ? 'success' : 'danger',
    }];
  });

  // ── Pays ──────────────────────────────────────────────────────────────
  // `daf-page`'s `[loading]` skeleton, like every other payroll/finance page, guards
  // the ONE blocking initial fetch (the pays list) — not `running()`, which must leave
  // the sidebar on screen (see the cockpit's whole point: adjust a parameter without
  // losing the result).
  readonly pageLoading = signal(true);
  private readonly paysList = signal<PaysDto[]>([]);
  readonly paysId = signal<number | null>(null);
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({
      value: String(p.id),
      label: `${flagEmoji(p.isoCode)} ${p.frenchLabel} (${p.isoCode})`.trim(),
    })),
  );

  ngOnInit(): void {
    this.payrollApi.listPays().subscribe({
      next: list => { this.paysList.set(list); this.pageLoading.set(false); },
      error: () => this.pageLoading.set(false),
    });
    this.recentPresets.set(this.loadPresetsFromStorage());
  }

  // ── Salarié ───────────────────────────────────────────────────────────
  readonly employeeIdCtrl = new FormControl<number | null>(null);
  readonly selectedEmployee = signal<EmployeeListItem | null>(null);

  onEmployeeSelected(e: EmployeeListItem | null): void {
    this.selectedEmployee.set(e);
  }

  employeeSubtitle(emp: EmployeeListItem): string {
    return [emp.contractType, emp.department].filter(Boolean).join(' · ');
  }

  private static readonly LIFECYCLE_VARIANT: Record<string, BadgeVariant> = {
    ACTIVE: 'success', ON_MISSION: 'success', ON_LEAVE: 'warning',
    PRE_ONBOARDING: 'info', OFFBOARDING: 'warning', TERMINATED: 'danger', ARCHIVED: 'neutral',
  };

  readonly employeeStatusBadge = computed(() => {
    const status = this.selectedEmployee()?.lifecycleStatus;
    if (!status) return null;
    return {
      label: this.t(`PAYROLL.ENGINE_RUN.LIFECYCLE.${status}`),
      variant: EngineRunComponent.LIFECYCLE_VARIANT[status] ?? 'neutral',
    };
  });

  // ── Période : Année + Mois fusionnés en un seul sélecteur de date — seuls l'année et
  //    le mois du jour choisi comptent, le moteur de paie n'a pas de notion de jour.
  readonly periodDate = signal<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly periodYear  = computed(() => this.periodDate().getFullYear());
  readonly periodMonth = computed(() => this.periodDate().getMonth() + 1);

  readonly periodRangeLabel = computed(() => {
    const y = this.periodYear(), m = this.periodMonth();
    const locale = this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
    const fmt = (d: Date) => d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
    return `${fmt(new Date(y, m - 1, 1))} – ${fmt(new Date(y, m, 0))}/${y}`;
  });

  onPeriodChange(value: Date | Date[] | null): void {
    if (value instanceof Date) this.periodDate.set(value);
  }

  readonly joursOuvresMois = signal(22);
  readonly contractTypeCode = signal('CDI');

  readonly contractTypeOptions = computed<SelectOption[]>(() => [
    { value: 'CDI',   label: 'CDI' },
    { value: 'CDD',   label: 'CDD' },
    { value: 'STAGE', label: this.t('PAYROLL.ENGINE_RUN.CONTRACT_STAGE') },
    { value: 'CIVP',  label: 'CIVP' },
  ]);

  readonly readyBadge = computed(() => this.canRun()
    ? { label: this.t('PAYROLL.ENGINE_RUN.STATUS_READY'), variant: 'success' as BadgeVariant }
    : { label: this.t('PAYROLL.ENGINE_RUN.STATUS_NOT_READY'), variant: 'neutral' as BadgeVariant });

  canRun(): boolean {
    const jours = this.joursOuvresMois();
    return !!this.paysId() && !!this.employeeIdCtrl.value && jours >= 1;
  }

  reset(): void {
    this.employeeIdCtrl.setValue(null);
    this.selectedEmployee.set(null);
    this.paysId.set(null);
    this.periodDate.set(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    this.joursOuvresMois.set(22);
    this.contractTypeCode.set('CDI');
    this.result.set(null);
    this.compareResult.set(null);
    this.error.set(null);
  }

  run(): void {
    if (!this.canRun()) return;
    this.running.set(true);
    this.error.set(null);
    this.result.set(null);
    this.compareResult.set(null);
    this.api.runPayroll({
      employeeId:       this.employeeIdCtrl.value!,
      paysId:           this.paysId()!,
      periodYear:       this.periodYear(),
      periodMonth:      this.periodMonth(),
      contractTypeCode: this.contractTypeCode(),
      joursOuvresMois:  this.joursOuvresMois(),
    }).subscribe({
      next: r  => { this.result.set(r); this.running.set(false); this.savePreset(); },
      error: e => { this.error.set(e?.error?.message ?? this.t('PAYROLL.ENGINE_RUN.ERROR')); this.running.set(false); },
    });
  }

  // ── Préréglages récents — localStorage uniquement, aucun endpoint de préréglages
  //    n'existe côté backend. Alimenté par les calculs réellement lancés.
  readonly recentPresets = signal<EnginePreset[]>([]);

  private loadPresetsFromStorage(): EnginePreset[] {
    try {
      const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private savePreset(): void {
    const employee = this.selectedEmployee();
    const paysId = this.paysId();
    if (!employee || paysId == null) return;
    const locale = this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
    const monthShort = this.periodDate().toLocaleDateString(locale, { month: 'short' });
    const preset: EnginePreset = {
      key:              `${employee.userId}-${this.periodYear()}-${this.periodMonth()}`,
      chipLabel:        `${deriveInitials(employee.fullName)} • ${monthShort} ${this.periodYear()}`,
      paysId,
      employeeId:       employee.userId,
      employeeLabel:    employee.fullName,
      periodYear:       this.periodYear(),
      periodMonth:      this.periodMonth(),
      contractTypeCode: this.contractTypeCode(),
      joursOuvresMois:  this.joursOuvresMois(),
    };
    const next = [preset, ...this.recentPresets().filter(p => p.key !== preset.key)].slice(0, MAX_PRESETS);
    this.recentPresets.set(next);
    try { localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(next)); } catch { /* private browsing — non-blocking */ }
  }

  loadPreset(p: EnginePreset): void {
    this.paysId.set(p.paysId);
    this.employeeIdCtrl.setValue(p.employeeId);
    // Placeholder until `EmployeeSelectComponent` resolves the id against a fetched page
    // and re-emits the full record (see its `fetch()`).
    this.selectedEmployee.set({
      userId: p.employeeId, profileId: null, fullName: p.employeeLabel,
      employeeId: null, paysId: p.paysId, paysLabel: null,
      contractType: null, department: null, lifecycleStatus: null,
    });
    this.periodDate.set(new Date(p.periodYear, p.periodMonth - 1, 1));
    this.contractTypeCode.set(p.contractTypeCode);
    this.joursOuvresMois.set(p.joursOuvresMois);
  }

  // ── Comparaison N-1 — réutilise `getResults()` (historique déjà exposé par l'API),
  //    pas de nouvel endpoint : on cherche simplement le même mois l'année précédente.
  readonly compareResult = signal<RunPayrollResponse | null>(null);
  readonly comparing     = signal(false);

  compareWithPreviousYear(): void {
    const r = this.result();
    if (!r) return;
    this.comparing.set(true);
    this.api.getResults(r.employeeId).subscribe({
      next: list => {
        this.comparing.set(false);
        const prior = list.find(x => x.periodYear === r.periodYear - 1 && x.periodMonth === r.periodMonth);
        if (!prior) {
          this.notification.info(this.t('PAYROLL.ENGINE_RUN.COMPARE_NONE'));
          return;
        }
        this.compareResult.set(prior);
      },
      error: () => {
        this.comparing.set(false);
        this.notification.error(this.t('PAYROLL.ENGINE_RUN.COMPARE_ERROR'));
      },
    });
  }

  private delta(current: number | null, previous: number | null): MetricDelta | null {
    if (current == null || previous == null || previous === 0) return null;
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    return {
      value: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
      direction: pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'neutral',
    };
  }

  readonly netPayDelta      = computed(() => this.delta(this.result()?.strate5 ?? null, this.compareResult()?.strate5 ?? null));
  readonly loadedCostDelta  = computed(() => this.delta(this.result()?.loadedCost ?? null, this.compareResult()?.loadedCost ?? null));
  readonly taxableNetDelta  = computed(() => this.delta(this.result()?.strate4 ?? null, this.compareResult()?.strate4 ?? null));
  readonly irppDelta        = computed(() => this.delta(this.result()?.aggregateIrpp ?? null, this.compareResult()?.aggregateIrpp ?? null));

  // ── Décomposition du coût chargé ─────────────────────────────────────
  // Indépendant des 5 strates (des totaux cumulés, pas des parts additives) : reconstruit
  // ici à partir de leurs écarts, en 4 segments qui somment exactement à `loadedCost` —
  //   loadedCost = strate1 + strate2 + strate3   (backend: SystemVariableAggregator)
  //   employeeCharges = (strate1+strate2) - strate4   (brut → net imposable)
  //   irpp            = strate4 - strate5             (net imposable → net à payer)
  //   employerCharges = strate3                        (déjà agrégé isolément côté backend)
  readonly costBreakdown = computed((): CostBreakdownSegment[] => {
    const r = this.result();
    if (!r || !r.loadedCost) return [];

    const gross            = (r.strate1 ?? 0) + (r.strate2 ?? 0);
    const net               = r.strate5 ?? 0;
    const irpp              = (r.strate4 ?? 0) - net;
    const employeeCharges   = gross - (r.strate4 ?? 0);
    const employerCharges   = r.strate3 ?? 0;
    const total              = r.loadedCost;
    const pct = (v: number) => (total ? (v / total) * 100 : 0);

    return [
      { key: 'NET',              label: this.t('PAYROLL.ENGINE_RUN.SEG_NET'),              amount: net,             pct: pct(net),             bar: 'bg-primary',   dot: 'bg-primary' },
      { key: 'EMPLOYEE_CHARGES', label: this.t('PAYROLL.ENGINE_RUN.SEG_EMPLOYEE_CHARGES'), amount: employeeCharges, pct: pct(employeeCharges), bar: 'bg-secondary', dot: 'bg-secondary' },
      { key: 'IRPP',             label: this.t('PAYROLL.ENGINE_RUN.STRATE_IRPP'),          amount: irpp,            pct: pct(irpp),            bar: 'bg-warning',   dot: 'bg-warning' },
      { key: 'EMPLOYER_CHARGES', label: this.t('PAYROLL.ENGINE_RUN.STRATE_EMPLOYER_CHARGES'), amount: employerCharges, pct: pct(employerCharges), bar: 'bg-teal',    dot: 'bg-teal' },
    ].filter(s => s.amount > 0.005);
  });

  // ── Détail des rubriques : onglets par nature réelle (aucune catégorie "Fiscalité /
  //    PAS" n'existe dans les données — seules AVANTAGE/INDEMNITE/PRIME/RETENUE le sont). ──
  readonly rubriqueSearch = signal('');
  readonly rubriqueTab    = signal<RubriqueTab>('all');

  private readonly rubriqueTabCounts = computed(() => {
    const details = this.result()?.rubriqueDetails ?? [];
    const debit = details.filter(d => d.nature === 'RETENUE').length;
    return { all: details.length, credit: details.length - debit, debit };
  });

  readonly rubriqueTabItems = computed((): TabItem[] => {
    const c = this.rubriqueTabCounts();
    return [
      { id: 'all',    label: this.t('PAYROLL.ENGINE_RUN.TAB_ALL'),    count: c.all || null },
      { id: 'credit', label: this.t('PAYROLL.ENGINE_RUN.TAB_CREDIT'), count: c.credit || null },
      { id: 'debit',  label: this.t('PAYROLL.ENGINE_RUN.TAB_DEBIT'),  count: c.debit || null },
    ];
  });

  natureVariant(nature: string): BadgeVariant {
    switch (nature) {
      case 'RETENUE':   return 'danger';
      case 'AVANTAGE':  return 'info';
      case 'INDEMNITE': return 'secondary';
      case 'PRIME':     return 'success';
      default:          return 'neutral';
    }
  }

  natureLabel(nature: string): string {
    return this.t(`PAYROLL.ENGINE_RUN.NATURE.${nature}`);
  }

  readonly rubriqueColumns = computed<TableColumn[]>(() => [
    { key: 'code',     label: this.t('PAYROLL.ENGINE_RUN.COL_CODE') },
    { key: 'label',    label: this.t('PAYROLL.ENGINE_RUN.COL_LABEL') },
    { key: 'strate',   label: this.t('PAYROLL.ENGINE_RUN.COL_STRATE'),   type: 'badge' },
    { key: 'nature',   label: this.t('PAYROLL.ENGINE_RUN.COL_NATURE'),   type: 'badge' },
    { key: 'assiette', label: this.t('PAYROLL.ENGINE_RUN.COL_ASSIETTE'), type: 'number', align: 'right', format: { minimumFractionDigits: 2, maximumFractionDigits: 2 } },
    { key: 'amount',   label: this.t('PAYROLL.ENGINE_RUN.COL_AMOUNT'),   type: 'number', align: 'right', format: { minimumFractionDigits: 2, maximumFractionDigits: 2 } },
    { key: 'mode',     label: this.t('PAYROLL.ENGINE_RUN.COL_MODE') },
  ]);

  readonly rubriqueRows = computed<TableRow[]>(() => {
    const tab = this.rubriqueTab();
    const search = this.rubriqueSearch().trim().toLowerCase();
    return (this.result()?.rubriqueDetails ?? [])
      .filter(r => tab === 'all' || (tab === 'debit' ? r.nature === 'RETENUE' : r.nature !== 'RETENUE'))
      .filter(r => !search || r.rubriqueCode.toLowerCase().includes(search) || r.labelFr.toLowerCase().includes(search))
      .map(r => ({
        id:       r.rubriqueCode,
        code:     r.rubriqueCode,
        label:    r.labelFr,
        strate:   { label: 'S' + r.strate, options: { variant: 'neutral' as BadgeVariant, size: 'sm' as const } },
        nature:   { label: this.natureLabel(r.nature), options: { variant: this.natureVariant(r.nature), size: 'sm' as const } },
        assiette: r.assiette,
        amount:   r.amount,
        mode:     r.modeCalcul,
      }));
  });

  exportRubriquesCsv(): void {
    const columns = this.rubriqueColumns();
    const rows = this.rubriqueRows();
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = columns.map(c => escape(c.label)).join(';');
    const body = rows.map(row => columns.map(c => {
      const cell = row[c.key];
      return escape((c.key === 'strate' || c.key === 'nature') ? (cell as { label?: string })?.label : cell);
    }).join(';')).join('\n');
    const csv = String.fromCharCode(0xFEFF) + header + '\n' + body;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rubriques-${this.result()?.employeeId ?? 'export'}-${this.periodYear()}-${this.periodMonth()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
