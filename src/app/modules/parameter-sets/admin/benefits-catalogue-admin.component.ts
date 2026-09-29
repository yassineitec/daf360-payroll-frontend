import { ChangeDetectionStrategy, Component, OnInit, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { catchError, of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent, DataTableComponent, FieldMessageComponent, FormFieldComponent, ModalService, SearchToolbarComponent,
  SelectComponent,
  type BadgeCell, type FilterField, type FilterResult, type ModalRef, type SearchToolbarFilterConfig, type SelectOption,
  type TableColumn, type TableConfig, type TableRow,
} from '@khalilrebhiitec/daf360';
import {
  PayrollApiService, type BenefitCatalogueDto, type ParameterSetDto, type PaysDto,
} from '../../../core/payroll-api.service';
import { PAYROLL_EDIT_PARAMSET_PERMISSIONS } from '../../../core/payroll-nav';
import { distinctSorted, pickValue } from '../../../shared/filter-utils';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from './admin-section-header.component';
import {
  AdminModalFooterComponent, AdminPager, AdminSpinnerComponent, AdminTableFooterComponent,
} from './admin-section-kit';
import { NotificationService } from '../../../core/notification.service';
import { UserStore } from '../../../core/user.store';

const VALUATION_METHODS = ['TAX_AUTHORITY', 'ACTUAL_COST'] as const;

/**
 * Section « Catalogue des avantages » de l'administration paie : les avantages en nature
 * (repas, transport, logement…) d'un jeu de paramètres — valeur mensuelle, parts salarié /
 * employeur, imposable ou non. Ils vivent dans chaque jeu (`benefits_catalogue.parameter_set_id`),
 * d'où le choix pays → jeu, le jeu actif proposé d'office.
 *
 * Modifiables (ajout, modification, suppression) sur un jeu EN BROUILLON seulement, avec un
 * droit de modification des jeux : un jeu soumis, actif ou archivé a été validé tel quel
 * (RH + Finance) — pour changer ses avantages, on crée un nouveau jeu. Chaque enregistrement
 * remplace la liste du jeu (`PUT /parameter-sets/{id}/benefits`, contrôlée côté serveur).
 */
@Component({
  selector: 'app-benefits-catalogue-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe, AdminModalFooterComponent, AdminSectionHeaderComponent, AdminSpinnerComponent,
    AdminTableFooterComponent, ButtonComponent, DataTableComponent, FieldMessageComponent, FormFieldComponent,
    SearchToolbarComponent, SelectComponent,
  ],
  // Comme une section de /rh/admin : en-tête (titre, aide, pays + jeu + recherche + bouton
  // vert « Ajouter » à droite), puis le tableau — modifier / supprimer : actions de ligne.
  template: `
    <div class="admin-section">
      <app-admin-section-header
        [title]="'PAYROLL.ADMIN_HOME.CARDS.BENEFITS' | translate"
        [subtitle]="'PAYROLL.ADMIN_HOME.BENEFITS.HINT' | translate">
        <div class="admin-pays">
          <daf-select
            [options]="paysOptions()"
            [selected]="paysId() ? ['' + paysId()] : []"
            [config]="{ placeholder: ('PAYROLL.SELECT.PAYS_PLACEHOLDER' | translate), searchable: true, fullWidth: true }"
            (selectedChange)="selectPays($event[0])" />
        </div>
        <div class="admin-pays">
          <daf-select
            [options]="setOptions()"
            [selected]="setId() ? ['' + setId()] : []"
            [config]="{ placeholder: ('PAYROLL.ADMIN_HOME.BENEFITS.SET_PLACEHOLDER' | translate), fullWidth: true, disabled: !sets().length }"
            (selectedChange)="setId.set($event[0] ? +$event[0] : null)" />
        </div>
        <div class="admin-search">
          <daf-search-toolbar
            [card]="false"
            [placeholder]="'PAYROLL.ADMIN_HOME.BENEFITS.SEARCH' | translate"
            [value]="search()" [debounce]="200" (valueChange)="search.set($event ?? '')"
            [filterFields]="filterFields()"
            [filterConfig]="filterConfig()"
            (filterApply)="filters.set($event)" />
        </div>
        @if (canEdit()) {
          <daf-button class="admin-desktop-only"
            [label]="'PAYROLL.ADMIN_HOME.BENEFITS.ADD' | translate"
            variant="teal"
            [options]="{ iconStart: 'add', disabled: saving() }"
            (onClick)="openBenefit(null)" />
          <daf-button class="admin-mobile-only"
            [title]="'PAYROLL.ADMIN_HOME.BENEFITS.ADD' | translate"
            variant="teal"
            [options]="{ iconStart: 'add', size: 'sm', disabled: saving() }"
            (onClick)="openBenefit(null)" />
        }
      </app-admin-section-header>

      <!-- Pourquoi on ne peut pas modifier ce jeu (statut), quand un jeu est choisi. -->
      @if (readOnlyReason(); as reason) {
        <daf-field-message [hint]="reason" />
      }

      <!-- Comme les sections RH : indicateur, message centré si vide, sinon tableau paginé. -->
      @if (loading()) {
        <app-admin-spinner />
      } @else if (!rows().length) {
        <div class="admin-empty">
          <p>{{ emptyKey() | translate }}</p>
          @if (canEdit() && !(currentSet()?.benefits?.length)) {
            <daf-button [label]="'PAYROLL.ADMIN_HOME.BENEFITS.ADD' | translate" variant="ghost" (onClick)="openBenefit(null)" />
          }
        </div>
      } @else {
        <div class="admin-table-scroll">
          <daf-data-table [columns]="columns()" [rows]="pager.rows()" [config]="tableConfig()" />
        </div>
        <app-admin-table-footer
          [total]="pager.total()" [page]="pager.current()" [totalPages]="pager.totalPages()"
          [unit]="'PAYROLL.ADMIN_HOME.COUNT.BENEFITS' | translate"
          (pageChange)="pager.go($event)" />
      }
    </div>

    <ng-template #benefitTpl>
      <div class="benefit-form">
        <div class="benefit-form__grid">
          <daf-form-field
            [value]="form().benefitCode"
            (valueChange)="patch({ benefitCode: text($event).toUpperCase() })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.BENEFITS.COL_CODE' | translate), placeholder: 'MEAL', required: true, fullWidth: true }" />
          <daf-select
            [options]="methodOptions()"
            [selected]="[form().valuationMethod]"
            [config]="{ label: ('PAYROLL.ADMIN_HOME.BENEFITS.COL_METHOD' | translate), required: true, fullWidth: true }"
            (selectedChange)="patch({ valuationMethod: $event[0] || form().valuationMethod })" />
          <daf-form-field
            [value]="form().benefitLabelFr"
            (valueChange)="patch({ benefitLabelFr: text($event) })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.BENEFITS.LABEL_FR' | translate), required: true, fullWidth: true }" />
          <daf-form-field
            [value]="form().benefitLabelEn ?? ''"
            (valueChange)="patch({ benefitLabelEn: text($event) || null })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.BENEFITS.LABEL_EN' | translate), fullWidth: true }" />
          <daf-form-field
            [value]="form().monthlyValue"
            (valueChange)="patch({ monthlyValue: amount($event) })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.BENEFITS.COL_MONTHLY' | translate), type: 'number', align: 'end', suffixText: devise() ?? '', fullWidth: true }" />
          <daf-select
            [options]="yesNoOptions()"
            [selected]="[form().isTaxable ? 'yes' : 'no']"
            [config]="{ label: ('PAYROLL.ADMIN_HOME.BENEFITS.COL_TAXABLE' | translate), required: true, fullWidth: true }"
            (selectedChange)="patch({ isTaxable: $event[0] === 'yes' })" />
          <daf-form-field
            [value]="form().employeeShare"
            (valueChange)="patch({ employeeShare: amount($event) })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.BENEFITS.COL_EMPLOYEE' | translate), type: 'number', align: 'end', suffixText: devise() ?? '', fullWidth: true }" />
          <daf-form-field
            [value]="form().employerShare"
            (valueChange)="patch({ employerShare: amount($event) })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.BENEFITS.COL_EMPLOYER' | translate), type: 'number', align: 'end', suffixText: devise() ?? '', fullWidth: true }" />
        </div>
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
    .benefit-form { display: flex; flex-direction: column; gap: 20px; }
    .benefit-form__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  `],
})
export class BenefitsCatalogueAdminComponent implements OnInit {
  private readonly api       = inject(PayrollApiService);
  private readonly translate = inject(TranslateService);
  private readonly userStore = inject(UserStore);
  private readonly modal     = inject(ModalService);
  private readonly notification = inject(NotificationService);

  private readonly benefitTpl = viewChild.required<TemplateRef<unknown>>('benefitTpl');
  modalRef: ModalRef | null = null;

  readonly pays    = signal<PaysDto[]>([]);
  readonly paysId  = signal<number | null>(null);
  readonly sets    = signal<ParameterSetDto[]>([]);
  readonly setId   = signal<number | null>(null);
  readonly loading = signal(false);
  readonly failed  = signal(false);
  readonly saving  = signal(false);
  readonly search  = signal('');
  readonly filters = signal<FilterResult>({});
  private seq = 0;

  /** Pop-up : l'avantage en cours de saisie et sa position dans la liste (null = ajout). */
  readonly form      = signal<BenefitCatalogueDto>(blankBenefit());
  readonly editIndex = signal<number | null>(null);
  readonly error     = signal<string | null>(null);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  ngOnInit(): void {
    this.api.listPays().pipe(catchError(() => of([] as PaysDto[]))).subscribe(list => {
      this.pays.set(list);
      // Pays pré-sélectionné = celui du profil de l'utilisateur connecté (s'il est dans la
      // liste), sinon le seul pays possible ; il reste modifiable dans le select.
      const userPaysId = this.userStore.currentUser()?.paysId;
      const initial = list.find(p => p.id === userPaysId) ?? (list.length === 1 ? list[0] : null);
      if (initial) this.selectPays(String(initial.id));
    });
  }

  readonly paysOptions = computed<SelectOption[]>(() =>
    this.pays().map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})` })));

  readonly setOptions = computed<SelectOption[]>(() =>
    this.sets().map(s => ({
      value: String(s.id),
      label: `v${s.version} — ${s.fiscalYear} · ${this.t(`PAYROLL.PARAMETER_SETS.STATUS.${s.status}`)}`,
    })));

  readonly currentSet = computed(() => this.sets().find(s => s.id === this.setId()) ?? null);

  /** Droit de modifier les jeux (mêmes codes que le serveur). */
  private readonly hasEditRight = computed(() =>
    PAYROLL_EDIT_PARAMSET_PERMISSIONS.some(code => this.userStore.hasPermission(code)));

  /** Modifiable : jeu en brouillon + droit de modification. */
  readonly canEdit = computed(() => this.currentSet()?.status === 'DRAFT' && this.hasEditRight());

  /** Explication affichée sous l'en-tête quand le jeu choisi n'est pas modifiable. */
  readonly readOnlyReason = computed(() => {
    const set = this.currentSet();
    if (!set || this.canEdit()) return null;
    if (set.status !== 'DRAFT') {
      return this.t('PAYROLL.ADMIN_HOME.BENEFITS.READONLY_STATUS', {
        status: this.t(`PAYROLL.PARAMETER_SETS.STATUS.${set.status}`),
      });
    }
    return this.t('PAYROLL.ADMIN_HOME.BENEFITS.READONLY_RIGHT');
  });

  selectPays(raw: string | undefined): void {
    const id = raw ? Number(raw) : null;
    this.paysId.set(id);
    this.sets.set([]);
    this.setId.set(null);
    this.failed.set(false);
    if (!id) return;
    const current = ++this.seq;
    this.loading.set(true);
    this.api.listParameterSets(id).subscribe({
      next: list => {
        if (current !== this.seq) return;
        // Le plus récent d'abord ; le jeu actif proposé d'office, sinon le plus récent.
        const sorted = [...list].sort((a, b) => b.fiscalYear - a.fiscalYear || b.version - a.version);
        this.sets.set(sorted);
        this.setId.set((sorted.find(s => s.status === 'ACTIVE') ?? sorted[0])?.id ?? null);
        this.loading.set(false);
      },
      error: () => { if (current === this.seq) { this.failed.set(true); this.loading.set(false); } },
    });
  }

  private methodLabel(method: string): string {
    const key = `PAYROLL.ADMIN_HOME.BENEFITS.METHOD.${method}`;
    const label = this.t(key);
    return label === key ? method : label;
  }

  readonly methodOptions = computed<SelectOption[]>(() =>
    VALUATION_METHODS.map(m => ({ value: m, label: this.methodLabel(m) })));

  readonly yesNoOptions = computed<SelectOption[]>(() => [
    { value: 'yes', label: this.t('PAYROLL.ADMIN_HOME.YES') },
    { value: 'no',  label: this.t('PAYROLL.ADMIN_HOME.NO') },
  ]);

  readonly filterFields = computed<FilterField[]>(() => {
    const all = this.t('PAYROLL.ADMIN_HOME.FILTER_ALL');
    const benefits = this.currentSet()?.benefits ?? [];
    return [
      {
        name: 'method', label: this.t('PAYROLL.ADMIN_HOME.BENEFITS.COL_METHOD'), type: 'select', placeholder: all,
        options: distinctSorted(benefits.map(b => b.valuationMethod)).map(m => ({ value: m, label: this.methodLabel(m) })),
      },
      { name: 'taxable', label: this.t('PAYROLL.ADMIN_HOME.BENEFITS.COL_TAXABLE'), type: 'select', placeholder: all, options: this.yesNoOptions() },
    ];
  });

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.ADMIN_HOME.BENEFITS.FILTER_TITLE'),
    triggerLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_TRIGGER'),
    applyLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_RESET'),
    align: 'right',
  }));

  /** Devise du pays choisi (référentiel `listPays`) — les montants sont dans cette devise. */
  readonly devise = computed(() => this.pays().find(p => p.id === this.paysId())?.devise || undefined);

  readonly columns = computed<TableColumn[]>(() => {
    // Colonnes `currency` : la valeur brute dans la ligne, la mise en forme (devise,
    // décimales, alignement à droite) par la bibliothèque. Sans devise connue : `number`.
    const devise = this.devise();
    const amount: Pick<TableColumn, 'type' | 'format'> = devise
      ? { type: 'currency', format: { currency: devise, minimumFractionDigits: 0, maximumFractionDigits: 3 } }
      : { type: 'number',   format: { minimumFractionDigits: 0, maximumFractionDigits: 3 } };
    return [
      { key: 'code',     label: this.t('PAYROLL.ADMIN_HOME.BENEFITS.COL_CODE') },
      { key: 'label',    label: this.t('PAYROLL.ADMIN_HOME.BENEFITS.COL_LABEL') },
      { key: 'method',   label: this.t('PAYROLL.ADMIN_HOME.BENEFITS.COL_METHOD') },
      { key: 'monthly',  label: this.t('PAYROLL.ADMIN_HOME.BENEFITS.COL_MONTHLY'),  ...amount },
      { key: 'employee', label: this.t('PAYROLL.ADMIN_HOME.BENEFITS.COL_EMPLOYEE'), ...amount },
      { key: 'employer', label: this.t('PAYROLL.ADMIN_HOME.BENEFITS.COL_EMPLOYER'), ...amount },
      { key: 'taxable',  label: this.t('PAYROLL.ADMIN_HOME.BENEFITS.COL_TAXABLE'),  type: 'badge' },
    ];
  });

  readonly rows = computed<TableRow[]>(() => {
    const q = this.search().trim().toLowerCase();
    const method = pickValue(this.filters(), 'method');
    const taxable = pickValue(this.filters(), 'taxable');
    const lang = this.translate.getCurrentLang();
    // `_index` = position dans la liste complète du jeu (et non dans la liste filtrée) :
    // c'est elle que modifier / supprimer remplacent.
    return (this.currentSet()?.benefits ?? [])
      .map((b, index) => ({ b, index }))
      .filter(({ b }) => (!q || `${b.benefitCode} ${b.benefitLabelFr} ${b.benefitLabelEn ?? ''}`.toLowerCase().includes(q))
        && (!method || b.valuationMethod === method)
        && (!taxable || b.isTaxable === (taxable === 'yes')))
      .map(({ b, index }) => ({
        id: b.id ?? `new-${index}`,
        _index: index,
        code: b.benefitCode,
        label: (lang === 'en' && b.benefitLabelEn) || b.benefitLabelFr,
        method: this.methodLabel(b.valuationMethod),
        monthly: b.monthlyValue,
        employee: b.employeeShare,
        employer: b.employerShare,
        taxable: {
          label: this.t(b.isTaxable ? 'PAYROLL.ADMIN_HOME.YES' : 'PAYROLL.ADMIN_HOME.NO'),
          options: { variant: b.isTaxable ? 'warning' : 'neutral', size: 'sm' },
        } satisfies BadgeCell,
      }));
  });

  /** Pages de 5 lignes, comme les sections de /rh/admin. */
  readonly pager = new AdminPager(() => this.rows());

  /** Message de la liste vide : pas de pays, échec, pas de jeu, jeu vide, ou filtre sans résultat. */
  readonly emptyKey = computed(() =>
    !this.paysId() ? 'PAYROLL.ADMIN_HOME.NO_PAYS'
      : this.failed() ? 'PAYROLL.ADMIN_HOME.LOAD_ERROR'
      : !this.sets().length ? 'PAYROLL.ADMIN_HOME.BENEFITS.NO_SET'
      : this.currentSet()?.benefits?.length ? 'PAYROLL.ADMIN_HOME.NO_RESULT'
      : 'PAYROLL.ADMIN_HOME.BENEFITS.EMPTY');

  readonly tableConfig = computed<TableConfig>(() => ({
    showHeader: true, hoverable: true,
    rowId: row => row['id'],
    emptyMessage: this.t(
      !this.paysId() ? 'PAYROLL.ADMIN_HOME.NO_PAYS'
        : this.failed() ? 'PAYROLL.ADMIN_HOME.LOAD_ERROR'
        : !this.sets().length ? 'PAYROLL.ADMIN_HOME.BENEFITS.NO_SET'
        : 'PAYROLL.ADMIN_HOME.BENEFITS.EMPTY'),
    actions: this.canEdit()
      ? [
          { id: 'edit', icon: 'edit', tooltip: this.t('PAYROLL.ADMIN_HOME.EDIT'),
            onClick: row => this.openBenefit(row['_index'] as number) },
          { id: 'delete', icon: 'delete', tooltip: this.t('PAYROLL.ADMIN_HOME.DELETE'), variant: 'danger',
            onClick: row => this.confirmDelete(row['_index'] as number) },
        ]
      : [],
  }));

  // ── Saisie ────────────────────────────────────────────────────────────────
  text(value: unknown): string {
    return (value ?? '').toString().trim();
  }

  /** Montant saisi → nombre, ou 0 pour un champ vidé (colonne NOT NULL côté serveur). */
  amount(value: unknown): number {
    const n = Number(value);
    return value === '' || value == null || isNaN(n) ? 0 : n;
  }

  patch(change: Partial<BenefitCatalogueDto>): void {
    this.form.update(f => ({ ...f, ...change }));
  }

  openBenefit(index: number | null): void {
    const list = this.currentSet()?.benefits ?? [];
    this.editIndex.set(index);
    this.form.set(index == null ? blankBenefit() : { ...list[index] });
    this.error.set(null);
    this.modalRef = this.modal.open({
      title: this.t(index == null ? 'PAYROLL.ADMIN_HOME.BENEFITS.ADD' : 'PAYROLL.ADMIN_HOME.BENEFITS.EDIT_TITLE'),
      icon: 'redeem',
      body: this.benefitTpl(),
      size: 'md',
      closeOnBackdrop: false,
    });
  }

  /** Contrôles du serveur repris ici, pour un message avant l'envoi. */
  private validate(f: BenefitCatalogueDto, others: BenefitCatalogueDto[]): string | null {
    if (!f.benefitCode.trim()) return this.t('PAYROLL.ADMIN_HOME.BENEFITS.ERR_CODE');
    if (others.some(o => o.benefitCode.trim().toUpperCase() === f.benefitCode.trim().toUpperCase()))
      return this.t('PAYROLL.ADMIN_HOME.BENEFITS.ERR_DUPLICATE', { code: f.benefitCode.trim() });
    if (!f.benefitLabelFr.trim()) return this.t('PAYROLL.ADMIN_HOME.BENEFITS.ERR_LABEL');
    if (f.monthlyValue < 0 || f.employeeShare < 0 || f.employerShare < 0) return this.t('PAYROLL.ADMIN_HOME.BENEFITS.ERR_NEGATIVE');
    return null;
  }

  submit(): void {
    const list = [...(this.currentSet()?.benefits ?? [])];
    const index = this.editIndex();
    const f = this.form();
    const problem = this.validate(f, list.filter((_, i) => i !== index));
    if (problem) { this.error.set(problem); return; }
    if (index == null) list.push(f); else list[index] = f;
    this.save(list, err => this.error.set(err), () => this.modalRef?.close());
  }

  private confirmDelete(index: number): void {
    const b = (this.currentSet()?.benefits ?? [])[index];
    if (!b) return;
    this.modal.open({
      title: this.t('PAYROLL.ADMIN_HOME.BENEFITS.DELETE_TITLE'),
      body: this.t('PAYROLL.ADMIN_HOME.BENEFITS.DELETE_CONFIRM', { code: b.benefitCode, label: b.benefitLabelFr }),
      size: 'sm',
      closeOnBackdrop: false,
      buttons: [
        { label: this.t('PAYROLL.ADMIN_HOME.CANCEL'), variant: 'secondary', action: r => r.close() },
        {
          label: this.t('PAYROLL.ADMIN_HOME.DELETE'), variant: 'primary',
          action: r => this.save(
            (this.currentSet()?.benefits ?? []).filter((_, i) => i !== index),
            message => { r.close(); this.notification.error(message); },
            () => r.close()),
        },
      ],
    });
  }

  /** Enregistre la liste complète du jeu, puis remplace le jeu par la réponse du serveur. */
  private save(list: BenefitCatalogueDto[], onError: (message: string) => void, onDone: () => void): void {
    const set = this.currentSet();
    if (!set || this.saving()) return;
    this.saving.set(true);
    this.api.updateBenefits(set.id, list).subscribe({
      next: updated => {
        this.sets.update(all => all.map(s => (s.id === updated.id ? updated : s)));
        this.saving.set(false);
        onDone();
      },
      error: err => {
        const body = (err as { error?: { detail?: string; message?: string } } | null)?.error;
        this.saving.set(false);
        onError(body?.detail ?? body?.message ?? this.t('PAYROLL.ADMIN_HOME.SAVE_ERROR'));
      },
    });
  }
}

function blankBenefit(): BenefitCatalogueDto {
  return {
    benefitCode: '', benefitLabelFr: '', benefitLabelEn: null, valuationMethod: 'TAX_AUTHORITY',
    monthlyValue: 0, employeeShare: 0, employerShare: 0, isTaxable: true,
  };
}
