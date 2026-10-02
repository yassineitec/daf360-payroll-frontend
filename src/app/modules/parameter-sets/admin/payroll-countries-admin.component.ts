import { ChangeDetectionStrategy, Component, OnInit, TemplateRef, computed, inject, signal, viewChild, untracked } from '@angular/core';
import { catchError, of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent, DataTableComponent, FieldMessageComponent, FormFieldComponent, ModalService, SearchToolbarComponent,
  SelectComponent,
  type BadgeCell, type FilterField, type FilterResult, type ModalRef, type SearchToolbarFilterConfig, type SelectOption,
  type TableColumn, type TableConfig, type TableRow,
} from '@khalilrebhiitec/daf360';
import {
  PayrollApiService, type PayrollCountryDto, type PaysDto, type SavePayrollCountryRequest,
} from '../../../core/payroll-api.service';
import { PAYROLL_MANAGE_COUNTRIES_PERMISSIONS } from '../../../core/payroll-nav';
import { UserStore } from '../../../core/user.store';
import { monthName, pickValue } from '../../../shared/filter-utils';
import { delegatedSort, tableTools } from '../../../shared/table-tools';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from './admin-section-header.component';
import {
  AdminModalFooterComponent, AdminPager, AdminSpinnerComponent, AdminTableFooterComponent,
} from './admin-section-kit';
import { PaysNamesService } from '../../../core/pays-names.service';

/**
 * Section « Pays de paie » de l'administration paie : la configuration du moteur par pays
 * (`payroll_countries`) — devise, premier mois de l'exercice, sources de taux de change,
 * pays actif ou non. Un pays absent ou inactif ici n'a ni rubriques moteur ni calcul.
 *
 * Lecture pour tous ceux qui voient la carte ; ajout et modification avec
 * `PAYROLL_MANAGE_COUNTRIES` (ou super-admin), dans le périmètre pays de l'utilisateur —
 * mêmes contrôles côté serveur (`POST` / `PUT /admin/countries`).
 */
@Component({
  selector: 'app-payroll-countries-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe, AdminModalFooterComponent, AdminSectionHeaderComponent, AdminSpinnerComponent,
    AdminTableFooterComponent, ButtonComponent, DataTableComponent, FieldMessageComponent, FormFieldComponent,
    SearchToolbarComponent, SelectComponent,
  ],
  // Comme une section de /rh/admin : en-tête (titre, aide, recherche + bouton vert
  // « Ajouter » à droite), puis le tableau — modifier : action de ligne.
  template: `
    <div class="admin-section">
      <app-admin-section-header
        [title]="'PAYROLL.ADMIN_HOME.CARDS.COUNTRIES' | translate"
        [subtitle]="'PAYROLL.ADMIN_HOME.COUNTRIES.HINT' | translate">
        <div class="admin-search">
          <daf-search-toolbar
            [card]="false"
            [placeholder]="'PAYROLL.ADMIN_HOME.COUNTRIES.SEARCH' | translate"
            [value]="search()" [debounce]="200" (valueChange)="search.set($event ?? '')"
            [filterFields]="filterFields()"
            [filterConfig]="filterConfig()"
            (filterApply)="filters.set($event)" />
        </div>
        @if (canManage() && freePaysOptions().length) {
          <daf-button class="admin-desktop-only"
            [label]="'PAYROLL.ADMIN_HOME.COUNTRIES.ADD' | translate"
            variant="teal"
            [options]="{ iconStart: 'add' }"
            (onClick)="openCountry(null)" />
          <daf-button class="admin-mobile-only"
            [title]="'PAYROLL.ADMIN_HOME.COUNTRIES.ADD' | translate"
            variant="teal"
            [options]="{ iconStart: 'add', size: 'sm' }"
            (onClick)="openCountry(null)" />
        }
      </app-admin-section-header>

      <!-- Comme les sections RH : indicateur, message centré si vide, sinon tableau paginé. -->
      @if (loading()) {
        <app-admin-spinner />
      } @else if (!rows().length) {
        <div class="admin-empty">
          <p>{{ (failed() ? 'PAYROLL.ADMIN_HOME.LOAD_ERROR' : countries().length ? 'PAYROLL.ADMIN_HOME.NO_RESULT' : 'PAYROLL.ADMIN_HOME.COUNTRIES.EMPTY') | translate }}</p>
          @if (!failed() && !countries().length && canManage() && freePaysOptions().length) {
            <daf-button [label]="'PAYROLL.ADMIN_HOME.COUNTRIES.ADD' | translate" variant="ghost" (onClick)="openCountry(null)" />
          }
        </div>
      } @else {
        <div class="admin-table-scroll">
          <daf-data-table [columns]="columns()" [rows]="pager.rows()" [config]="tableConfig()"
            (sortChange)="pager.onSort($event)" (resetClick)="pager.onSort(null)" />
        </div>
        <app-admin-table-footer
          [total]="pager.total()" [page]="pager.current()" [totalPages]="pager.totalPages()"
          [unit]="'PAYROLL.ADMIN_HOME.COUNT.COUNTRIES' | translate"
          (pageChange)="pager.go($event)" />
      }
    </div>

    <ng-template #countryTpl>
      <div class="country-form">
        <div class="country-form__grid">
          @if (editing() === null) {
            <daf-select
              [options]="freePaysOptions()"
              [selected]="form().paysId ? ['' + form().paysId] : []"
              [config]="{ label: ('PAYROLL.ADMIN_HOME.COUNTRIES.COL_PAYS' | translate), required: true, searchable: true, fullWidth: true }"
              (selectedChange)="pickPays($event[0])" />
          }
          <daf-form-field
            [value]="form().currencyCode"
            (valueChange)="patch({ currencyCode: text($event).toUpperCase() })"
            [options]="{
              label: ('PAYROLL.ADMIN_HOME.COUNTRIES.COL_CURRENCY' | translate), placeholder: 'TND', required: true, fullWidth: true,
              hint: ('PAYROLL.ADMIN_HOME.COUNTRIES.CURRENCY_HINT' | translate)
            }" />
          <daf-select
            [options]="monthOptions()"
            [selected]="['' + form().fiscalYearStartMonth]"
            [config]="{ label: ('PAYROLL.ADMIN_HOME.COUNTRIES.COL_FISCAL_START' | translate), required: true, fullWidth: true }"
            (selectedChange)="patch({ fiscalYearStartMonth: +($event[0] || 1) })" />
          <daf-select
            [options]="stateOptions()"
            [selected]="[form().active ? 'active' : 'inactive']"
            [config]="{ label: ('PAYROLL.ADMIN_HOME.COUNTRIES.COL_STATE' | translate), required: true, fullWidth: true }"
            (selectedChange)="patch({ active: $event[0] === 'active' })" />
        </div>
        <daf-form-field
          [value]="form().forexApiSources ?? ''"
          (valueChange)="patch({ forexApiSources: text($event) || null })"
          [options]="{
            label: ('PAYROLL.ADMIN_HOME.COUNTRIES.COL_FOREX' | translate), type: 'textarea', rows: 5, fullWidth: true,
            placeholder: forexPlaceholder,
            hint: ('PAYROLL.ADMIN_HOME.COUNTRIES.FOREX_HINT' | translate)
          }" />
        @if (form().active === false && editing()?.active) {
          <daf-field-message [hint]="'PAYROLL.ADMIN_HOME.COUNTRIES.DEACTIVATE_WARNING' | translate" />
        }
        @if (error()) {
          <div class="admin-error-banner" role="alert">{{ error() }}</div>
        }
        <app-admin-modal-footer
          [saveLabel]="'PAYROLL.ADMIN_HOME.SAVE' | translate"
          [cancelLabel]="'PAYROLL.ADMIN_HOME.CANCEL' | translate"
          [saving]="saving()"
          (save)="submit()"
          (cancel)="modalRef?.close()" />
      </div>
    </ng-template>
  `,
  styles: [ADMIN_SECTION_STYLES, `
    .country-form { display: flex; flex-direction: column; gap: 16px; }
    .country-form__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
  `],
})
export class PayrollCountriesAdminComponent implements OnInit {
  private readonly api       = inject(PayrollApiService);
  private readonly translate = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);
  private readonly userStore = inject(UserStore);
  private readonly modal     = inject(ModalService);

  private readonly countryTpl = viewChild.required<TemplateRef<unknown>>('countryTpl');
  modalRef: ModalRef | null = null;

  readonly countries = signal<PayrollCountryDto[]>([]);
  readonly pays      = signal<PaysDto[]>([]);
  readonly loading   = signal(true);
  readonly failed    = signal(false);
  readonly saving    = signal(false);
  readonly search    = signal('');
  readonly filters   = signal<FilterResult>({});

  /** Pop-up : le pays modifié (null = ajout) et la saisie en cours. */
  readonly editing = signal<PayrollCountryDto | null>(null);
  readonly form    = signal<SavePayrollCountryRequest>(blankCountry());
  readonly error   = signal<string | null>(null);

  /** Exemple de sources de change — JSON valide, recopiable tel quel. */
  readonly forexPlaceholder = '[{"name":"BCT","url":"https://…"}]';

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  ngOnInit(): void {
    this.api.listPayrollCountries().subscribe({
      next: list => { this.countries.set(list); this.loading.set(false); },
      error: () => { this.failed.set(true); this.loading.set(false); },
    });
    this.api.listPays().pipe(catchError(() => of([] as PaysDto[]))).subscribe(list => this.pays.set(list));
  }

  /** Droit d'ajouter / modifier (mêmes codes que le serveur). */
  readonly canManage = computed(() =>
    PAYROLL_MANAGE_COUNTRIES_PERMISSIONS.some(code => this.userStore.hasPermission(code)));

  /** Pays du référentiel pas encore configurés — les seuls proposés à l'ajout. */
  readonly freePaysOptions = computed<SelectOption[]>(() => {
    const taken = new Set(this.countries().map(c => c.paysId));
    return this.pays().filter(p => !taken.has(p.id))
      .map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})` }));
  });

  readonly monthOptions = computed<SelectOption[]>(() => {
    const lang = this.translate.getCurrentLang() ?? 'fr';
    return Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1, lang) }));
  });

  readonly stateOptions = computed<SelectOption[]>(() => [
    { value: 'active',   label: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.ACTIVE') },
    { value: 'inactive', label: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.INACTIVE') },
  ]);

  /** Devises présentes — choix du filtre « Devise ». */
  readonly currencies = computed(() => [...new Set(this.countries().map(c => c.currencyCode))].sort());

  readonly filterFields = computed<FilterField[]>(() => {
    const all = this.t('PAYROLL.ADMIN_HOME.FILTER_ALL');
    return [
      { name: 'state', label: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.COL_STATE'), type: 'select', placeholder: all, options: this.stateOptions() },
      {
        name: 'currency', label: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.COL_CURRENCY'), type: 'select', placeholder: all,
        options: this.currencies().map(c => ({ value: c, label: c })),
      },
      { name: 'forex', label: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.FILTER_NO_FOREX'), type: 'checkbox' },
    ];
  });

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.FILTER_TITLE'),
    triggerLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_TRIGGER'),
    applyLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_RESET'),
    align: 'right',
  }));

  readonly columns = computed<TableColumn[]>(() => [
    { key: 'pays',     label: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.COL_PAYS'), sortable: true },
    { key: 'currency', label: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.COL_CURRENCY'), sortable: true },
    // Mois écrit en toutes lettres et nombre de sources en texte : triés sur leur valeur.
    { key: 'fiscal',   label: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.COL_FISCAL_START'), sortable: true,
      sortAccessor: row => (row['_source'] as PayrollCountryDto).fiscalYearStartMonth },
    { key: 'forex',    label: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.COL_FOREX'), sortable: true,
      sortAccessor: row => forexCount((row['_source'] as PayrollCountryDto).forexApiSources) },
    { key: 'state',    label: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.COL_STATE'), type: 'badge', sortable: true },
    { key: 'created',  label: this.t('PAYROLL.ADMIN_HOME.COUNTRIES.COL_CREATED'), type: 'date', format: { dateStyle: 'short' }, sortable: true },
  ]);

  readonly rows = computed<TableRow[]>(() => {
    const q = this.search().trim().toLowerCase();
    const state = pickValue(this.filters(), 'state');
    const currency = pickValue(this.filters(), 'currency');
    const noForex = this.filters()['forex'] === true;
    const lang = this.translate.getCurrentLang() ?? 'fr';
    return this.countries()
      .filter(c => (!q || `${c.paysLabel ?? ''} ${c.isoCode ?? ''}`.toLowerCase().includes(q))
        && (!state || c.active === (state === 'active'))
        && (!currency || c.currencyCode === currency)
        && (!noForex || forexCount(c.forexApiSources) === 0))
      .map(c => {
        const sources = forexCount(c.forexApiSources);
        return {
          id: c.id,
          pays: `${this.paysNames.name(c.paysId, c.paysLabel ?? `#${c.paysId}`)}${c.paysLabel && c.isoCode ? ` (${c.isoCode})` : ''}`,
          currency: c.currencyCode,
          fiscal: monthName(c.fiscalYearStartMonth, lang),
          forex: sources
            ? this.t('PAYROLL.ADMIN_HOME.COUNTRIES.FOREX_COUNT', { count: sources })
            : this.t('PAYROLL.ADMIN_HOME.COUNTRIES.FOREX_NONE'),
          state: {
            label: this.t(c.active ? 'PAYROLL.ADMIN_HOME.COUNTRIES.ACTIVE' : 'PAYROLL.ADMIN_HOME.COUNTRIES.INACTIVE'),
            options: { variant: c.active ? 'success' : 'neutral', size: 'sm', dot: true },
          } satisfies BadgeCell,
          created: c.createdAt,
          _source: c,
        };
      });
  });

  /** Pages de 5 lignes, comme les sections de /rh/admin. */
  readonly pager = new AdminPager(() => this.rows(), () => this.columns());

  readonly tableConfig = computed<TableConfig>(() => ({
    showHeader: false, hoverable: true,
    ...tableTools(this.translate),
    ...delegatedSort(untracked(this.pager.sort)),
    rowId: row => row['id'],
    emptyMessage: this.t(this.failed() ? 'PAYROLL.ADMIN_HOME.LOAD_ERROR' : 'PAYROLL.ADMIN_HOME.COUNTRIES.EMPTY'),
    actions: this.canManage()
      ? [{ id: 'edit', icon: 'edit', tooltip: this.t('PAYROLL.ADMIN_HOME.EDIT'),
           onClick: row => this.openCountry(row['_source'] as PayrollCountryDto) }]
      : [],
  }));

  // ── Saisie ────────────────────────────────────────────────────────────────
  text(value: unknown): string {
    return (value ?? '').toString().trim();
  }

  patch(change: Partial<SavePayrollCountryRequest>): void {
    this.form.update(f => ({ ...f, ...change }));
  }

  /** Pays choisi à l'ajout : sa devise du référentiel est proposée d'office. */
  pickPays(raw: string | undefined): void {
    const id = raw ? Number(raw) : null;
    const devise = this.pays().find(p => p.id === id)?.devise;
    this.patch({ paysId: id, ...(devise && !this.form().currencyCode ? { currencyCode: devise.toUpperCase() } : {}) });
  }

  openCountry(c: PayrollCountryDto | null): void {
    this.editing.set(c);
    this.form.set(c
      ? { paysId: c.paysId, currencyCode: c.currencyCode, fiscalYearStartMonth: c.fiscalYearStartMonth,
          forexApiSources: c.forexApiSources, active: c.active }
      : blankCountry());
    this.error.set(null);
    this.modalRef = this.modal.open({
      title: c
        ? this.t('PAYROLL.ADMIN_HOME.COUNTRIES.EDIT_TITLE', { pays: c.paysLabel ?? `#${c.paysId}` })
        : this.t('PAYROLL.ADMIN_HOME.COUNTRIES.ADD'),
      icon: 'public',
      body: this.countryTpl(),
      size: 'md',
      closeOnBackdrop: false,
    });
  }

  /** Contrôles du serveur repris ici, pour un message avant l'envoi. */
  private validate(f: SavePayrollCountryRequest): string | null {
    if (this.editing() === null && !f.paysId) return this.t('PAYROLL.ADMIN_HOME.COUNTRIES.ERR_PAYS');
    if (!/^[A-Z]{3}$/.test(f.currencyCode)) return this.t('PAYROLL.ADMIN_HOME.COUNTRIES.ERR_CURRENCY');
    if (f.forexApiSources) {
      try {
        const parsed = JSON.parse(f.forexApiSources);
        if (!parsed || typeof parsed !== 'object') return this.t('PAYROLL.ADMIN_HOME.COUNTRIES.ERR_FOREX');
      } catch {
        return this.t('PAYROLL.ADMIN_HOME.COUNTRIES.ERR_FOREX');
      }
    }
    return null;
  }

  submit(): void {
    if (this.saving()) return;
    const f = this.form();
    const problem = this.validate(f);
    if (problem) { this.error.set(problem); return; }
    const editing = this.editing();
    this.saving.set(true);
    this.error.set(null);
    const call$ = editing ? this.api.updatePayrollCountry(editing.id, f) : this.api.createPayrollCountry(f);
    call$.subscribe({
      next: saved => {
        this.countries.update(list => [...list.filter(c => c.id !== saved.id), saved]
          .sort((a, b) => (a.paysLabel ?? '').localeCompare(b.paysLabel ?? '')));
        this.saving.set(false);
        this.modalRef?.close();
      },
      error: err => {
        const body = (err as { error?: { detail?: string; message?: string } } | null)?.error;
        this.saving.set(false);
        this.error.set(body?.detail ?? body?.message ?? this.t('PAYROLL.ADMIN_HOME.SAVE_ERROR'));
      },
    });
  }
}

function blankCountry(): SavePayrollCountryRequest {
  return { paysId: null, currencyCode: '', fiscalYearStartMonth: 1, forexApiSources: null, active: true };
}

/** Nombre de sources de change déclarées : `forex_api_sources` est un JSON libre — un
 *  tableau (une entrée par source) ou un objet (une clé par source). Illisible → 0. */
function forexCount(raw: string | null): number {
  if (!raw?.trim()) return 0;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length;
    return parsed && typeof parsed === 'object' ? Object.keys(parsed).length : 0;
  } catch {
    return 0;
  }
}
