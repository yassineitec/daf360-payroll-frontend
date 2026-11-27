import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, untracked, viewChild } from '@angular/core';
import { catchError, of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent, DataTableComponent, FormFieldComponent, SearchToolbarComponent, SelectComponent,
  type BadgeCell, type FilterField, type FilterResult, type SearchToolbarFilterConfig, type SelectOption,
  type TableColumn, type TableConfig, type TableRow,
} from '@khalilrebhiitec/daf360';
import {
  PayrollApiService, type LeaveSettingsDto, type LeaveTypeRuleDto, type PaysDto,
} from '../../../core/payroll-api.service';
import { PAYROLL_LEAVE_SETTINGS_EDIT_PERMISSIONS } from '../../../core/payroll-nav';
import { UserStore } from '../../../core/user.store';
import { PaysNamesService } from '../../../core/pays-names.service';
import { pickValue } from '../../../shared/filter-utils';
import { delegatedSort, tableTools } from '../../../shared/table-tools';
import { flagDataUri } from '../../../shared/country-flags';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from './admin-section-header.component';
import { AdminPager, AdminSpinnerComponent, AdminTableFooterComponent } from './admin-section-kit';
import { rememberAdminState } from './admin-section-state';

/**
 * Section « Absences et période de paie » de l'administration paie (/payroll/admin, V42).
 * Pour un pays (pays de travail des collaborateurs) :
 *  - la période de paie : jour de début (dans le mois précédent) et jour de fin (dans le mois
 *    payé), par ex. 21 → 20 : novembre = du 21/10 au 20/11, décembre = du 21/11 au 20/12.
 *    Début 1 = mois civil. Le serveur n'accepte que fin = début − 1 (ni trou, ni chevauchement) ;
 *    les deux champs se suivent ici pour qu'on ne puisse pas saisir autre chose ;
 *  - la liste des types d'absence configurés dans RH (Administration RH › Types de congé, liste
 *    commune à tous les pays) avec, pour ce pays, « Déduit du salaire » oui / non.
 * Seuls les éléments variables suivent la période (heures sup, absences, autorisations,
 * entrée / sortie) ; le salaire de base, les primes et les avances restent sur le mois payé.
 */
@Component({
  selector: 'app-leave-settings-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe, AdminSectionHeaderComponent, AdminSpinnerComponent, AdminTableFooterComponent,
    ButtonComponent, DataTableComponent, FormFieldComponent, SearchToolbarComponent, SelectComponent,
  ],
  template: `
    <div class="admin-section">
      <app-admin-section-header
        [title]="'PAYROLL.ADMIN_HOME.CARDS.LEAVE_SETTINGS' | translate"
        [subtitle]="'PAYROLL.LEAVE_SETTINGS.HINT' | translate" />

      <!-- Pays -->
      <div class="admin-toolbar ls-pays">
        <daf-select
          [options]="paysOptions()"
          [selected]="paysId() ? ['' + paysId()] : []"
          [config]="{ label: ('PAYROLL.LEAVE_SETTINGS.PAYS' | translate), searchable: true, fullWidth: true,
                      placeholder: ('PAYROLL.SELECT.PAYS_PLACEHOLDER' | translate) }"
          (selectedChange)="selectPays($event[0])" />
      </div>

      @if (!paysId()) {
        <div class="admin-empty"><p>{{ 'PAYROLL.ADMIN_HOME.NO_PAYS' | translate }}</p></div>
      } @else if (loading()) {
        <app-admin-spinner />
      } @else if (loadError()) {
        <div class="admin-error-banner" role="alert">{{ 'PAYROLL.ADMIN_HOME.LOAD_ERROR' | translate }}</div>
      } @else if (settings(); as s) {

        <!-- Période de paie -->
        <section class="ls-block">
          <h3 class="ls-block__title">{{ 'PAYROLL.LEAVE_SETTINGS.PERIOD_TITLE' | translate }}</h3>
          <p class="ls-block__hint">{{ 'PAYROLL.LEAVE_SETTINGS.PERIOD_HINT' | translate }}</p>
          <div class="ls-period">
            <daf-form-field
              [value]="startDay()"
              (valueChange)="onStart($event)"
              [options]="{ type: 'number', align: 'end', required: true, fullWidth: true,
                           disabled: !canEdit(),
                           label: ('PAYROLL.LEAVE_SETTINGS.START_DAY' | translate),
                           hint: ('PAYROLL.LEAVE_SETTINGS.START_DAY_HINT' | translate) }" />
            <daf-form-field
              [value]="endDay()"
              (valueChange)="onEnd($event)"
              [options]="{ type: 'number', align: 'end', fullWidth: true,
                           disabled: !canEdit() || startDay() === 1,
                           label: ('PAYROLL.LEAVE_SETTINGS.END_DAY' | translate),
                           hint: ('PAYROLL.LEAVE_SETTINGS.END_DAY_HINT' | translate) }" />
          </div>
          <p class="ls-example">
            <span class="material-symbols-outlined">date_range</span>
            {{ periodExample() }}
          </p>
          @if (periodError()) {
            <div class="admin-error-banner" role="alert">{{ periodError() }}</div>
          }
          @if (canEdit()) {
            <div class="ls-actions">
              <daf-button
                [label]="'PAYROLL.LEAVE_SETTINGS.SAVE_PERIOD' | translate"
                variant="teal"
                [options]="{ iconStart: 'save', disabled: saving() || !periodDirty() }"
                (onClick)="savePeriod()" />
            </div>
          }
        </section>

        <!-- Types d'absence de RH : déduits du salaire ou payés, pour ce pays -->
        <section class="ls-block">
          <h3 class="ls-block__title">{{ 'PAYROLL.LEAVE_SETTINGS.TYPES_TITLE' | translate }}</h3>
          <p class="ls-block__hint">{{ 'PAYROLL.LEAVE_SETTINGS.TYPES_HINT' | translate }}</p>
          @if (!s.catalogueRead) {
            <div class="admin-error-banner" role="alert">{{ 'PAYROLL.LEAVE_SETTINGS.CATALOGUE_UNREACHABLE' | translate }}</div>
          }
          <div class="admin-toolbar">
            <daf-search-toolbar
              [card]="false"
              [placeholder]="'PAYROLL.LEAVE_SETTINGS.SEARCH' | translate"
              [value]="search()" [debounce]="200" (valueChange)="search.set($event)"
              [filterFields]="filterFields()"
              [filterConfig]="filterConfig()"
              (filterApply)="filters.set($event)"
              [table]="table() ?? null" />
          </div>
          @if (!rows().length) {
            <div class="admin-empty"><p>{{ (s.leaveTypes.length ? 'PAYROLL.ADMIN_HOME.NO_RESULT' : 'PAYROLL.LEAVE_SETTINGS.EMPTY') | translate }}</p></div>
          } @else {
            <div class="admin-table-scroll">
              <daf-data-table [columns]="columns()" [rows]="pager.rows()" [config]="tableConfig()"
                (sortChange)="pager.onSort($event)" (resetClick)="pager.onSort(null)" />
            </div>
            <app-admin-table-footer
              [total]="pager.total()" [page]="pager.current()" [totalPages]="pager.totalPages()"
              [unit]="'PAYROLL.LEAVE_SETTINGS.COUNT' | translate"
              (pageChange)="pager.go($event)" />
          }
          @if (ruleError()) {
            <div class="admin-error-banner" role="alert">{{ ruleError() }}</div>
          }
        </section>
      }
    </div>
  `,
  styles: [ADMIN_SECTION_STYLES, `
    .ls-pays { max-width: 420px; }
    .ls-block { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; }
    .ls-block__title { margin: 0; font-size: 1rem; font-weight: 600; color: var(--color-on-surface); }
    .ls-block__hint { margin: 0; font-size: 0.8125rem; color: var(--color-on-surface-variant); }
    .ls-period { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 260px)); gap: 16px; }
    .ls-example { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 0.875rem; font-weight: 600;
                  color: var(--color-on-surface); }
    .ls-example .material-symbols-outlined { font-size: 18px; color: var(--color-primary); }
    .ls-actions { display: flex; justify-content: flex-end; }
  `],
})
export class LeaveSettingsAdminComponent implements OnInit {
  readonly table = viewChild(DataTableComponent);

  private readonly api       = inject(PayrollApiService);
  private readonly translate = inject(TranslateService);
  private readonly userStore = inject(UserStore);
  private readonly paysNames = inject(PaysNamesService);

  readonly payrollPays = signal<PaysDto[]>([]);
  readonly paysId      = signal<number | null>(null);
  readonly settings    = signal<LeaveSettingsDto | null>(null);
  readonly loading     = signal(false);
  readonly loadError   = signal(false);
  readonly saving      = signal(false);
  readonly periodError = signal<string | null>(null);
  readonly ruleError   = signal<string | null>(null);

  /** Champs de la période (texte vide pendant la saisie = null). */
  readonly startDay = signal<number | null>(1);
  readonly endDay   = signal<number | null>(null);

  readonly search  = signal('');
  readonly filters = signal<FilterResult>({});

  readonly canEdit = computed(() =>
    PAYROLL_LEAVE_SETTINGS_EDIT_PERMISSIONS.some(code => this.userStore.hasPermission(code)));

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  private lang(): 'fr' | 'en' {
    return this.translate.currentLang() === 'en' ? 'en' : 'fr';
  }

  ngOnInit(): void {
    this.api.listPayrollPays().pipe(catchError(() => of([] as PaysDto[]))).subscribe(list => {
      this.payrollPays.set(list);
      const keep = this.paysId();
      const first = keep ?? list[0]?.id ?? null;
      if (first != null) this.selectPays(String(first));
    });
  }

  readonly paysOptions = computed<SelectOption[]>(() =>
    this.payrollPays().map(p => ({
      value: String(p.id), label: this.paysNames.name(p.id, p.frenchLabel), imageUrl: flagDataUri(p.isoCode),
    })));

  selectPays(value: string | undefined): void {
    const id = value ? Number(value) : null;
    this.paysId.set(id);
    this.settings.set(null);
    this.periodError.set(null);
    this.ruleError.set(null);
    if (id == null) return;
    this.loading.set(true);
    this.loadError.set(false);
    this.api.getLeaveSettings(id).subscribe({
      next: s => { if (this.paysId() === id) this.apply(s); this.loading.set(false); },
      error: () => { this.loadError.set(true); this.loading.set(false); },
    });
  }

  private apply(s: LeaveSettingsDto): void {
    this.settings.set(s);
    this.startDay.set(s.periodStartDay);
    this.endDay.set(s.periodEndDay);
  }

  // ── Période ───────────────────────────────────────────────────────────────

  private toDay(v: unknown): number | null {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  }

  /** Le début change : la fin suit (veille du début), ou disparaît en mois civil. */
  onStart(v: unknown): void {
    const s = this.toDay(v);
    this.startDay.set(s);
    this.endDay.set(s != null && s > 1 && s <= 28 ? s - 1 : null);
    this.periodError.set(null);
  }

  /** La fin change : le début suit (lendemain de la fin). */
  onEnd(v: unknown): void {
    const e = this.toDay(v);
    this.endDay.set(e);
    if (e != null && e >= 1 && e <= 27) this.startDay.set(e + 1);
    this.periodError.set(null);
  }

  readonly periodDirty = computed(() => {
    const s = this.settings();
    return !!s && (s.periodStartDay !== this.startDay() || (s.periodEndDay ?? null) !== (this.endDay() ?? null));
  });

  /** « Novembre = du 21/10 au 20/11 · Décembre = du 21/11 au 20/12 » avec les valeurs saisies. */
  readonly periodExample = computed(() => {
    const start = this.startDay();
    if (start == null || start < 1 || start > 28) return this.t('PAYROLL.LEAVE_SETTINGS.EXAMPLE_INVALID');
    const today = new Date();
    const locale = this.lang() === 'en' ? 'en-GB' : 'fr-FR';
    const monthName = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString(locale, { month: 'long' });
    const dm = (d: Date) => d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
    const one = (y: number, m: number) => {
      const from = start === 1 ? new Date(y, m, 1) : new Date(y, m - 1, start);
      const to = start === 1 ? new Date(y, m + 1, 0) : new Date(y, m, start - 1);
      return this.t('PAYROLL.LEAVE_SETTINGS.EXAMPLE', { month: monthName(y, m), from: dm(from), to: dm(to) });
    };
    const y = today.getFullYear(), m = today.getMonth();
    return one(y, m) + ' · ' + one(m === 11 ? y + 1 : y, (m + 1) % 12);
  });

  savePeriod(): void {
    const id = this.paysId();
    const start = this.startDay();
    if (id == null || this.saving()) return;
    if (start == null || start < 1 || start > 28) {
      this.periodError.set(this.t('PAYROLL.LEAVE_SETTINGS.ERR_START'));
      return;
    }
    const end = start === 1 ? null : this.endDay();
    if (start > 1 && end !== start - 1) {
      this.periodError.set(this.t('PAYROLL.LEAVE_SETTINGS.ERR_END', { end: start - 1 }));
      return;
    }
    this.saving.set(true);
    this.periodError.set(null);
    this.api.saveLeavePeriod(id, start, end).subscribe({
      next: s => { this.saving.set(false); this.apply(s); },
      error: err => { this.saving.set(false); this.periodError.set(errorText(err) ?? this.t('PAYROLL.ADMIN.ERROR')); },
    });
  }

  // ── Types d'absence ───────────────────────────────────────────────────────

  private label(r: LeaveTypeRuleDto): string {
    return (this.lang() === 'en' ? r.labelEn : r.labelFr) || r.code;
  }

  private yesNo(): SelectOption[] {
    return [
      { value: 'yes', label: this.t('PAYROLL.LEAVE_SETTINGS.DEDUCTED') },
      { value: 'no',  label: this.t('PAYROLL.LEAVE_SETTINGS.PAID') },
    ];
  }

  readonly filterFields = computed<FilterField[]>(() => {
    const all = this.t('PAYROLL.SALARY_ADVANCES.FILTER.ALL');
    return [
      { name: 'deducts', label: this.t('PAYROLL.LEAVE_SETTINGS.COL_DEDUCTS'), type: 'select', placeholder: all, options: this.yesNo() },
    ];
  });

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.SALARY_ADVANCES.FILTER.TITLE'),
    triggerLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.TRIGGER'),
    applyLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.APPLY'),
    cancelLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.CANCEL'),
    resetLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.RESET'),
    align: 'right',
    initialValues: { deducts: pickValue(this.filters(), 'deducts') ? [pickValue(this.filters(), 'deducts')!] : [] },
  }));

  readonly columns = computed<TableColumn[]>(() => [
    { key: 'type',    label: this.t('PAYROLL.LEAVE_SETTINGS.COL_TYPE'), sortable: true },
    { key: 'code',    label: this.t('PAYROLL.LEAVE_SETTINGS.COL_CODE'), sortable: true },
    { key: 'balance', label: this.t('PAYROLL.LEAVE_SETTINGS.COL_BALANCE'), sortable: true },
    { key: 'rh',      label: this.t('PAYROLL.LEAVE_SETTINGS.COL_RH'), type: 'badge', sortable: true },
    { key: 'deducts', label: this.t('PAYROLL.LEAVE_SETTINGS.COL_DEDUCTS'), type: 'badge', sortable: true },
  ]);

  readonly rows = computed<TableRow[]>(() => {
    const list = this.settings()?.leaveTypes ?? [];
    const q = this.search().trim().toLowerCase();
    const deducts = pickValue(this.filters(), 'deducts');
    return list
      .filter(r => (!q || this.label(r).toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
        && (!deducts || r.deductsSalary === (deducts === 'yes')))
      .map(r => ({
        type: this.label(r),
        code: r.code,
        balance: r.tracksBalance && r.balanceField
          ? this.t('PAYROLL.LEAVE_SETTINGS.BALANCE_' + r.balanceField.toUpperCase())
          : '—',
        rh: {
          label: this.t(!r.inCatalogue ? 'PAYROLL.LEAVE_SETTINGS.RH_REMOVED'
            : r.active ? 'PAYROLL.LEAVE_SETTINGS.RH_ACTIVE' : 'PAYROLL.LEAVE_SETTINGS.RH_INACTIVE'),
          options: { variant: !r.inCatalogue ? 'danger' : r.active ? 'success' : 'neutral', size: 'sm', dot: true },
        } satisfies BadgeCell,
        deducts: {
          label: this.t(r.deductsSalary ? 'PAYROLL.LEAVE_SETTINGS.DEDUCTED' : 'PAYROLL.LEAVE_SETTINGS.PAID'),
          options: { variant: r.deductsSalary ? 'warning' : 'neutral', size: 'sm', dot: true },
        } satisfies BadgeCell,
        _source: r,
      }));
  });

  readonly pager = new AdminPager(() => this.rows(), () => this.columns());

  private readonly memory = rememberAdminState('leave-settings', {
    search: this.search, filters: this.filters, page: this.pager.page, sort: this.pager.sort,
  });

  readonly tableConfig = computed<TableConfig>(() => ({
    showHeader: false, hoverable: true,
    ...tableTools(this.translate),
    ...delegatedSort(untracked(this.pager.sort)),
    rowId: row => (row['_source'] as LeaveTypeRuleDto).code,
    emptyMessage: this.t('PAYROLL.LEAVE_SETTINGS.EMPTY'),
    actions: this.canEdit() ? [
      {
        id: 'deduct', icon: 'money_off', tooltip: this.t('PAYROLL.LEAVE_SETTINGS.SET_DEDUCTED'),
        hidden: row => (row['_source'] as LeaveTypeRuleDto).deductsSalary,
        onClick: row => this.toggle(row['_source'] as LeaveTypeRuleDto),
      },
      {
        id: 'pay', icon: 'paid', tooltip: this.t('PAYROLL.LEAVE_SETTINGS.SET_PAID'),
        hidden: row => !(row['_source'] as LeaveTypeRuleDto).deductsSalary,
        onClick: row => this.toggle(row['_source'] as LeaveTypeRuleDto),
      },
    ] : [],
  }));

  toggle(r: LeaveTypeRuleDto): void {
    const id = this.paysId();
    if (id == null || this.saving()) return;
    this.saving.set(true);
    this.ruleError.set(null);
    this.api.saveLeaveRule(id, r.code, !r.deductsSalary).subscribe({
      next: s => {
        this.saving.set(false);
        // Only the saved settings are replaced: period fields being typed are left as they are.
        this.settings.set(s);
      },
      error: err => { this.saving.set(false); this.ruleError.set(errorText(err) ?? this.t('PAYROLL.ADMIN.ERROR')); },
    });
  }
}

function errorText(err: unknown): string | null {
  const body = (err as { error?: { detail?: string; message?: string } } | null)?.error;
  return body?.detail ?? body?.message ?? null;
}
