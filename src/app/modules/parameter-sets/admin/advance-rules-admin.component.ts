import { ChangeDetectionStrategy, Component, OnInit, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { catchError, of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent, DataTableComponent, FormFieldComponent, ModalService, SearchToolbarComponent, SelectComponent,
  type BadgeCell, type FilterField, type FilterResult, type ModalRef, type SearchToolbarFilterConfig, type SelectOption,
  type TableColumn, type TableConfig, type TableRow,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, type PaysDto } from '../../../core/payroll-api.service';
import { SalaryAdvancesService, type AdvancePolicy } from '../../salary-advances/salary-advances.service';
import { pickValue } from '../../../shared/filter-utils';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from './admin-section-header.component';
import {
  AdminModalFooterComponent, AdminPager, AdminSpinnerComponent, AdminTableFooterComponent,
} from './admin-section-kit';

const CURRENCIES = ['TND', 'EGP', 'EUR', 'USD'];

/**
 * Section « Règles des avances » de l'administration paie (/payroll/admin) : par
 * pays, la durée maximale de remboursement, l'ancienneté minimale et l'ouverture. Mêmes
 * endpoints (`GET/PUT /salary-advances/policies`), mêmes libellés et même pop-up que
 * l'onglet « Règles » de /payroll/salary-advances — ici rangés avec le reste du paramétrage.
 */
@Component({
  selector: 'app-advance-rules-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe, AdminModalFooterComponent, AdminSectionHeaderComponent, AdminSpinnerComponent,
    AdminTableFooterComponent, ButtonComponent, DataTableComponent, FormFieldComponent, SearchToolbarComponent,
    SelectComponent,
  ],
  // Comme une section de /rh/admin : en-tête (titre, aide, recherche + bouton vert
  // « Ajouter » à droite), puis le tableau — modifier une règle : action de ligne.
  template: `
    <div class="admin-section">
      <app-admin-section-header
        [title]="'PAYROLL.ADMIN_HOME.CARDS.ADVANCE_RULES' | translate"
        [subtitle]="'PAYROLL.SALARY_ADVANCES.RULES.HINT' | translate">
        <div class="admin-search">
          <daf-search-toolbar
            [card]="false"
            [placeholder]="'PAYROLL.SALARY_ADVANCES.SEARCH_RULES' | translate"
            [value]="search()" [debounce]="200" (valueChange)="search.set($event ?? '')"
            [filterFields]="filterFields()"
            [filterConfig]="filterConfig()"
            (filterApply)="filters.set($event)" />
        </div>
        @if (freePaysOptions().length) {
          <daf-button class="admin-desktop-only"
            [label]="'PAYROLL.SALARY_ADVANCES.RULES.ADD' | translate"
            variant="teal"
            [options]="{ iconStart: 'add' }"
            (onClick)="openPolicy(null)" />
          <daf-button class="admin-mobile-only"
            [title]="'PAYROLL.SALARY_ADVANCES.RULES.ADD' | translate"
            variant="teal"
            [options]="{ iconStart: 'add', size: 'sm' }"
            (onClick)="openPolicy(null)" />
        }
      </app-admin-section-header>

      <!-- Comme les sections RH : indicateur pendant le chargement, message centré si vide,
           sinon le tableau (5 lignes par page) + « N éléments » et la pagination. -->
      @if (loading()) {
        <app-admin-spinner />
      } @else if (loadError()) {
        <div class="admin-error-banner" role="alert">{{ 'PAYROLL.ADMIN_HOME.LOAD_ERROR' | translate }}</div>
      } @else if (!rows().length) {
        <div class="admin-empty">
          <p>{{ (policies().length ? 'PAYROLL.ADMIN_HOME.NO_RESULT' : 'PAYROLL.SALARY_ADVANCES.EMPTY.RULES') | translate }}</p>
          @if (!policies().length && freePaysOptions().length) {
            <daf-button [label]="'PAYROLL.SALARY_ADVANCES.RULES.ADD' | translate" variant="ghost" (onClick)="openPolicy(null)" />
          }
        </div>
      } @else {
        <div class="admin-table-scroll">
          <daf-data-table [columns]="columns()" [rows]="pager.rows()" [config]="tableConfig()" />
        </div>
        <app-admin-table-footer
          [total]="pager.total()" [page]="pager.current()" [totalPages]="pager.totalPages()"
          [unit]="'PAYROLL.ADMIN_HOME.COUNT.RULES' | translate"
          (pageChange)="pager.go($event)" />
      }
    </div>

    <ng-template #policyTpl>
      <div class="policy-form">
        <div class="policy-form__grid">
          @if (isNew()) {
            <daf-select
              [options]="freePaysOptions()"
              [config]="{ label: ('PAYROLL.SALARY_ADVANCES.RULES.PAYS' | translate), required: true, searchable: true, error: fieldError('paysId') }"
              [selected]="form().paysId ? ['' + form().paysId] : []"
              (selectedChange)="selectPays($event[0])" />
          }
          <daf-select
            [options]="currencyOptions()"
            [config]="{ label: ('PAYROLL.SALARY_ADVANCES.RULES.CURRENCY' | translate), required: true, error: fieldError('currency') }"
            [selected]="[form().currency]"
            (selectedChange)="patch({ currency: $event[0] || form().currency })" />
          <daf-form-field
            [value]="form().maxInstallments"
            (valueChange)="patch({ maxInstallments: toNumber($event) })"
            [options]="{
              type: 'number', fullWidth: true, align: 'end', required: true,
              label: ('PAYROLL.SALARY_ADVANCES.RULES.MAX_MONTHS' | translate),
              hint: ('PAYROLL.SALARY_ADVANCES.RULES.MAX_MONTHS_HINT' | translate),
              error: fieldError('maxInstallments')
            }" />
          <daf-form-field
            [value]="form().minSeniorityMonths"
            (valueChange)="patch({ minSeniorityMonths: toNumber($event) })"
            [options]="{
              type: 'number', fullWidth: true, align: 'end', required: true,
              label: ('PAYROLL.SALARY_ADVANCES.RULES.SENIORITY' | translate),
              hint: ('PAYROLL.SALARY_ADVANCES.RULES.SENIORITY_HINT' | translate),
              error: fieldError('minSeniorityMonths')
            }" />
          <daf-select
            [options]="stateOptions()"
            [config]="{ label: ('PAYROLL.SALARY_ADVANCES.RULES.STATE' | translate), required: true }"
            [selected]="[form().isActive ? 'open' : 'closed']"
            (selectedChange)="patch({ isActive: $event[0] === 'open' })" />
        </div>
        @if (error()) {
          <div class="admin-error-banner" role="alert">{{ error() }}</div>
        }
        <app-admin-modal-footer
          [saveLabel]="'PAYROLL.SALARY_ADVANCES.RULES.SAVE' | translate"
          [cancelLabel]="'PAYROLL.SALARY_ADVANCES.CANCEL' | translate"
          [saving]="saving()"
          (save)="submit()"
          (cancel)="modalRef?.close()" />
      </div>
    </ng-template>
  `,
  styles: [ADMIN_SECTION_STYLES, `
    .policy-form { display: flex; flex-direction: column; gap: 20px; }
    .policy-form__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
  `],
})
export class AdvanceRulesAdminComponent implements OnInit {
  private readonly svc        = inject(SalaryAdvancesService);
  private readonly payrollApi = inject(PayrollApiService);
  private readonly modal      = inject(ModalService);
  private readonly translate  = inject(TranslateService);

  private readonly policyTpl = viewChild.required<TemplateRef<unknown>>('policyTpl');
  modalRef: ModalRef | null = null;

  readonly policies = signal<AdvancePolicy[]>([]);
  readonly pays     = signal<PaysDto[]>([]);
  readonly loading  = signal(true);
  /** Échec du chargement des règles : bandeau d'erreur plutôt qu'une liste vide trompeuse. */
  readonly loadError = signal(false);
  readonly search   = signal('');
  readonly filters  = signal<FilterResult>({});

  readonly form  = signal<PolicyForm>(blankPolicy());
  /** Erreurs par champ affichées après la première tentative d'enregistrement (comme la page 1). */
  readonly submitted = signal(false);
  readonly isNew = signal(false);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  /** Devises proposées : celles des pays connus, plus les devises usuelles. */
  readonly currencyOptions = computed<SelectOption[]>(() =>
    [...new Set([...CURRENCIES, ...this.pays().map(p => p.devise), this.form().currency])]
      .filter(c => !!c).sort().map(c => ({ value: c, label: c })));

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  ngOnInit(): void {
    this.payrollApi.listPays().pipe(catchError(() => of([] as PaysDto[]))).subscribe(p => this.pays.set(p));
    this.svc.policies().subscribe({
      next: list => { this.policies.set(list); this.loading.set(false); },
      error: () => { this.loadError.set(true); this.loading.set(false); },
    });
  }

  private paysName(id: number): string {
    return this.pays().find(p => p.id === id)?.frenchLabel ?? `#${id}`;
  }

  /** Pays sans règle encore — les seuls proposés à l'ajout. */
  readonly freePaysOptions = computed<SelectOption[]>(() => {
    const taken = new Set(this.policies().map(p => p.paysId));
    return this.pays().filter(p => !taken.has(p.id)).map(p => ({ value: String(p.id), label: p.frenchLabel }));
  });

  readonly stateOptions = computed<SelectOption[]>(() => [
    { value: 'open',   label: this.t('PAYROLL.SALARY_ADVANCES.RULES.OPEN') },
    { value: 'closed', label: this.t('PAYROLL.SALARY_ADVANCES.RULES.CLOSED') },
  ]);

  readonly filterFields = computed<FilterField[]>(() => {
    const all = this.t('PAYROLL.SALARY_ADVANCES.FILTER.ALL');
    return [
      { name: 'state', label: this.t('PAYROLL.SALARY_ADVANCES.RULES.STATE'), type: 'select', placeholder: all, options: this.stateOptions() },
      {
        name: 'currency', label: this.t('PAYROLL.SALARY_ADVANCES.FILTER.CURRENCY'), type: 'select', placeholder: all,
        options: [...new Set(this.policies().map(p => p.currency))].sort().map(c => ({ value: c, label: c })),
      },
    ];
  });

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.SALARY_ADVANCES.FILTER.TITLE'),
    triggerLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.TRIGGER'),
    applyLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.APPLY'),
    cancelLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.CANCEL'),
    resetLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.RESET'),
    align: 'right',
  }));

  readonly columns = computed<TableColumn[]>(() => [
    { key: 'pays',      label: this.t('PAYROLL.SALARY_ADVANCES.RULES.PAYS') },
    { key: 'months',    label: this.t('PAYROLL.SALARY_ADVANCES.RULES.MAX_MONTHS') },
    { key: 'seniority', label: this.t('PAYROLL.SALARY_ADVANCES.RULES.SENIORITY') },
    { key: 'state',     label: this.t('PAYROLL.SALARY_ADVANCES.RULES.STATE'), type: 'badge' },
  ]);

  readonly rows = computed<TableRow[]>(() => {
    const q = this.search().trim().toLowerCase();
    const state = pickValue(this.filters(), 'state');
    const currency = pickValue(this.filters(), 'currency');
    return this.policies()
      .filter(p => (!q || this.paysName(p.paysId).toLowerCase().includes(q))
        && (!state || p.isActive === (state === 'open'))
        && (!currency || p.currency === currency))
      .map(p => ({
        pays: `${this.paysName(p.paysId)} · ${p.currency}`,
        months: this.t('PAYROLL.SALARY_ADVANCES.N_MONTHS', { count: p.maxInstallments }),
        seniority: p.minSeniorityMonths
          ? this.t('PAYROLL.SALARY_ADVANCES.N_MONTHS', { count: p.minSeniorityMonths })
          : this.t('PAYROLL.SALARY_ADVANCES.RULES.NONE'),
        state: {
          label: this.t(p.isActive ? 'PAYROLL.SALARY_ADVANCES.RULES.OPEN' : 'PAYROLL.SALARY_ADVANCES.RULES.CLOSED'),
          options: { variant: p.isActive ? 'success' : 'neutral', size: 'sm', dot: true },
        } satisfies BadgeCell,
        _source: p,
      }));
  });

  /** Pages de 5 lignes, comme les sections de /rh/admin. */
  readonly pager = new AdminPager(() => this.rows());

  readonly tableConfig = computed<TableConfig>(() => ({
    showHeader: true, hoverable: true,
    rowId: row => (row['_source'] as AdvancePolicy).paysId,
    emptyMessage: this.t('PAYROLL.SALARY_ADVANCES.EMPTY.RULES'),
    actions: [
      {
        id: 'edit', icon: 'edit', tooltip: this.t('PAYROLL.SALARY_ADVANCES.RULES.EDIT'),
        onClick: row => this.openPolicy(row['_source'] as AdvancePolicy),
      },
      // Fermer / rouvrir les avances en un clic (le « Désactiver » des sections RH).
      {
        id: 'close', icon: 'block', tooltip: this.t('PAYROLL.ADMIN_HOME.ADVANCE_CLOSE'),
        hidden: row => !(row['_source'] as AdvancePolicy).isActive,
        onClick: row => this.toggle(row['_source'] as AdvancePolicy),
      },
      {
        id: 'reopen', icon: 'check_circle', tooltip: this.t('PAYROLL.ADMIN_HOME.ADVANCE_OPEN'),
        hidden: row => (row['_source'] as AdvancePolicy).isActive,
        onClick: row => this.toggle(row['_source'] as AdvancePolicy),
      },
    ],
  }));

  openPolicy(p: AdvancePolicy | null): void {
    this.isNew.set(!p);
    this.form.set(p ? { ...p } : blankPolicy());
    this.error.set(null);
    this.submitted.set(false);
    this.modalRef = this.modal.open({
      title: this.t(p ? 'PAYROLL.SALARY_ADVANCES.RULES.EDIT' : 'PAYROLL.SALARY_ADVANCES.RULES.ADD'),
      icon: 'tune',
      body: this.policyTpl(),
      size: 'md',
      closeOnBackdrop: false,
    });
  }

  patch(change: Partial<PolicyForm>): void {
    this.form.update(f => ({ ...f, ...change }));
  }

  /** Choix du pays : la devise suit celle du pays (modifiable ensuite). */
  selectPays(value: string | undefined): void {
    const id = value ? Number(value) : 0;
    const devise = this.pays().find(p => p.id === id)?.devise;
    this.patch({ paysId: id, ...(devise ? { currency: devise } : {}) });
  }

  /** Champ vide → null (erreur « obligatoire ») au lieu d'un 0 silencieux. */
  toNumber(value: unknown): number | null {
    if (value === '' || value == null) return null;
    const n = Number(value);
    return isNaN(n) ? null : n;
  }

  /** Mêmes bornes que le serveur (PolicyDto) : durée 1 à 24 mois, ancienneté ≥ 0. */
  private validate(f: PolicyForm): Partial<Record<keyof PolicyForm, string>> {
    const e: Partial<Record<keyof PolicyForm, string>> = {};
    const int = (v: number | null, min: number, max?: number): string | undefined => {
      if (v == null) return this.t('PAYROLL.ADMIN.ERR.REQUIRED');
      if (!Number.isInteger(v)) return this.t('PAYROLL.ADMIN.ERR.INTEGER');
      if (v < min) return this.t('PAYROLL.ADMIN.ERR.MIN', { min });
      if (max != null && v > max) return this.t('PAYROLL.ADMIN.ERR.MAX', { max });
      return undefined;
    };
    if (!(f.paysId > 0)) e.paysId = this.t('PAYROLL.ADMIN.ERR.REQUIRED');
    if (!/^[A-Z]{3}$/.test(f.currency ?? '')) e.currency = this.t('PAYROLL.ADMIN.ERR.INVALID');
    const m = int(f.maxInstallments, 1, 24);
    if (m) e.maxInstallments = m;
    const sn = int(f.minSeniorityMonths, 0);
    if (sn) e.minSeniorityMonths = sn;
    return e;
  }

  fieldError(key: keyof PolicyForm): string | undefined {
    return this.submitted() ? this.validate(this.form())[key] : undefined;
  }

  /** Ferme / rouvre les avances d'un pays sans passer par la pop-up. */
  toggle(p: AdvancePolicy): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.svc.savePolicy({ ...p, isActive: !p.isActive }).subscribe({
      next: saved => { this.saving.set(false); this.store(saved); },
      error: () => this.saving.set(false),
    });
  }

  private store(saved: AdvancePolicy): void {
    this.policies.update(list =>
      [...list.filter(p => p.paysId !== saved.paysId), saved].sort((x, y) => x.paysId - y.paysId));
  }

  /** Mêmes contrôles que l'onglet « Règles » (et que le serveur) : durée 1 à 24 mois. */
  submit(): void {
    if (this.saving()) return;
    const f = this.form();
    this.submitted.set(true);
    if (Object.keys(this.validate(f)).length) {
      this.error.set(this.t('PAYROLL.SALARY_ADVANCES.RULES.INVALID'));
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.svc.savePolicy(f as AdvancePolicy).subscribe({
      next: saved => {
        this.saving.set(false);
        this.modalRef?.close();
        this.store(saved);
      },
      error: err => {
        const body = (err as { error?: { detail?: string; message?: string } } | null)?.error;
        this.saving.set(false);
        this.error.set(body?.detail ?? body?.message ?? this.t('PAYROLL.ADMIN.ERROR'));
      },
    });
  }
}

/** Formulaire de la pop-up : les nombres peuvent être vides pendant la saisie. */
type PolicyForm = Omit<AdvancePolicy, 'maxInstallments' | 'minSeniorityMonths'> & {
  maxInstallments: number | null;
  minSeniorityMonths: number | null;
};

function blankPolicy(): PolicyForm {
  return { paysId: 0, currency: 'TND', maxInstallments: 3, minSeniorityMonths: 3, isActive: true };
}
