import { ChangeDetectionStrategy, Component, OnInit, TemplateRef, computed, inject, signal, viewChild, untracked } from '@angular/core';
import { catchError, of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent, DataTableComponent, FieldMessageComponent, FormFieldComponent, ModalService, SearchToolbarComponent,
  SelectComponent,
  type BadgeCell, type FilterField, type FilterResult, type ModalRef, type SearchToolbarFilterConfig, type SelectOption,
  type TableColumn, type TableConfig, type TableRow,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, type PaysDto } from '../../../core/payroll-api.service';
import {
  ENGINE_CALC_MODES, PayrollEngineService, type EngineRubriqueDefDto, type SaveEngineRubriqueRequest,
} from '../../../core/payroll-engine.service';
import { PAYROLL_MANAGE_RUBRIQUES_PERMISSIONS } from '../../../core/payroll-nav';
import { distinctSorted, pickValue } from '../../../shared/filter-utils';
import { delegatedSort, tableTools } from '../../../shared/table-tools';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from './admin-section-header.component';
import {
  AdminModalFooterComponent, AdminPager, AdminSpinnerComponent, AdminTableFooterComponent,
} from './admin-section-kit';
import { UserStore } from '../../../core/user.store';
import { PaysNamesService } from '../../../core/pays-names.service';

/**
 * Section « Rubriques du moteur » de l'administration paie : ce que le moteur sait calculer
 * pour un pays — code, strate, nature, mode de calcul, clés de paramètres, formule,
 * périodicité, contrats — dans l'ordre d'affichage du bulletin, actives comme inactives
 * (`GET /admin/engine/rubriques?paysId=`). Liste vide : pays absent du moteur (carte
 * « Pays de paie »).
 *
 * Ajout et modification avec `PAYROLL_MANAGE_RUBRIQUES` (ou super-admin), contrôlés côté
 * serveur (mode ↔ clés obligatoires, syntaxe de la formule, code unique). Pas de
 * suppression : une rubrique retirée est désactivée, l'historique des calculs la garde. Les
 * clés renvoient aux « Paramètres du moteur » ; une clé absente bloque la soumission d'une
 * version de paramètres.
 */
@Component({
  selector: 'app-engine-rubriques-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe, AdminModalFooterComponent, AdminSectionHeaderComponent, AdminSpinnerComponent,
    AdminTableFooterComponent, ButtonComponent, DataTableComponent, FieldMessageComponent, FormFieldComponent,
    SearchToolbarComponent, SelectComponent,
  ],
  // Comme une section de /rh/admin : en-tête (titre, aide, pays + recherche + bouton vert
  // « Ajouter » à droite), puis le tableau — modifier : action de ligne.
  template: `
    <div class="admin-section">
      <app-admin-section-header
        [title]="'PAYROLL.ADMIN_HOME.CARDS.RUBRIQUES' | translate"
        [subtitle]="'PAYROLL.ADMIN_HOME.RUBRIQUES.HINT' | translate">
        <div class="admin-pays">
          <daf-select
            [options]="paysOptions()"
            [selected]="paysId() ? ['' + paysId()] : []"
            [config]="{ placeholder: ('PAYROLL.SELECT.PAYS_PLACEHOLDER' | translate), searchable: true, fullWidth: true }"
            (selectedChange)="selectPays($event[0])" />
        </div>
        <div class="admin-search">
          <daf-search-toolbar
            [card]="false"
            [placeholder]="'PAYROLL.ADMIN_HOME.RUBRIQUES.SEARCH' | translate"
            [value]="search()" [debounce]="200" (valueChange)="search.set($event ?? '')"
            [filterFields]="filterFields()"
            [filterConfig]="filterConfig()"
            (filterApply)="filters.set($event)" />
        </div>
        @if (canManage() && paysId()) {
          <daf-button class="admin-desktop-only"
            [label]="'PAYROLL.ADMIN_HOME.RUBRIQUES.ADD' | translate"
            variant="teal"
            [options]="{ iconStart: 'add' }"
            (onClick)="openRubrique(null)" />
          <daf-button class="admin-mobile-only"
            [title]="'PAYROLL.ADMIN_HOME.RUBRIQUES.ADD' | translate"
            variant="teal"
            [options]="{ iconStart: 'add', size: 'sm' }"
            (onClick)="openRubrique(null)" />
        }
      </app-admin-section-header>

      <!-- Comme les sections RH : indicateur, message centré si vide, sinon tableau paginé. -->
      @if (loading()) {
        <app-admin-spinner />
      } @else if (!rows().length) {
        <div class="admin-empty">
          <p>{{ emptyKey() | translate }}</p>
          @if (paysId() && !failed() && !rubriques().length && canManage()) {
            <daf-button [label]="'PAYROLL.ADMIN_HOME.RUBRIQUES.ADD' | translate" variant="ghost" (onClick)="openRubrique(null)" />
          }
        </div>
      } @else {
        <div class="admin-table-scroll">
          <daf-data-table [columns]="columns()" [rows]="pager.rows()" [config]="tableConfig()"
            (sortChange)="pager.onSort($event)" (resetClick)="pager.onSort(null)" />
        </div>
        <app-admin-table-footer
          [total]="pager.total()" [page]="pager.current()" [totalPages]="pager.totalPages()"
          [unit]="'PAYROLL.ADMIN_HOME.COUNT.RUBRIQUES' | translate"
          (pageChange)="pager.go($event)" />
      }
    </div>

    <ng-template #rubriqueTpl>
      <div class="rub-form">
        <div class="rub-form__grid">
          @if (editing() === null) {
            <daf-form-field
              [value]="form().code"
              (valueChange)="patch({ code: text($event).toUpperCase() })"
              [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_CODE' | translate), placeholder: 'CNSS_EE', required: true, fullWidth: true,
                           hint: ('PAYROLL.ADMIN_HOME.RUBRIQUES.CODE_HINT' | translate) }" />
          }
          <daf-form-field
            [value]="form().labelFr"
            (valueChange)="patch({ labelFr: text($event) })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.LABEL_FR' | translate), required: true, fullWidth: true }" />
          <daf-form-field
            [value]="form().labelEn ?? ''"
            (valueChange)="patch({ labelEn: text($event) || null })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.LABEL_EN' | translate), fullWidth: true }" />
          <daf-select
            [options]="strateOptions"
            [selected]="['' + form().strate]"
            [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_STRATE' | translate), required: true, fullWidth: true }"
            (selectedChange)="patch({ strate: +($event[0] || 1) })" />
          <daf-form-field
            [value]="form().nature"
            (valueChange)="patch({ nature: text($event).toUpperCase() })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_NATURE' | translate), placeholder: 'RETENUE', required: true, fullWidth: true }" />
          <daf-select
            [options]="modeOptions()"
            [selected]="[form().modeCalcul]"
            [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_MODE' | translate), required: true, fullWidth: true }"
            (selectedChange)="patch({ modeCalcul: $event[0] || form().modeCalcul })" />
          <daf-form-field
            [value]="form().assietteCode ?? ''"
            (valueChange)="patch({ assietteCode: text($event).toUpperCase() || null })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.ASSIETTE' | translate), placeholder: 'BRUT', fullWidth: true }" />
          <daf-form-field
            [value]="form().paramKeyTaux ?? ''"
            (valueChange)="patch({ paramKeyTaux: text($event) || null })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_TAUX' | translate), fullWidth: true, required: needsTaux() }" />
          <daf-form-field
            [value]="form().paramKeyPlafond ?? ''"
            (valueChange)="patch({ paramKeyPlafond: text($event) || null })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_PLAFOND' | translate), fullWidth: true }" />
          <daf-form-field
            [value]="form().paramKeyBareme ?? ''"
            (valueChange)="patch({ paramKeyBareme: text($event) || null })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_BAREME' | translate), fullWidth: true, required: needsBareme() }" />
          <daf-form-field
            [value]="form().contractTypeFilter ?? ''"
            (valueChange)="patch({ contractTypeFilter: text($event).toUpperCase() || null })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_CONTRACTS' | translate), placeholder: 'CDI,CDD', fullWidth: true,
                         hint: ('PAYROLL.ADMIN_HOME.RUBRIQUES.CONTRACTS_HINT' | translate) }" />
          <daf-form-field
            [value]="form().periodicite"
            (valueChange)="patch({ periodicite: text($event).toUpperCase() || 'MENSUEL' })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_PERIODICITY' | translate), placeholder: 'MENSUEL', fullWidth: true }" />
          <daf-form-field
            [value]="form().displayOrder"
            (valueChange)="patch({ displayOrder: int($event) })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_ORDER' | translate), type: 'number', align: 'end', fullWidth: true }" />
          <daf-select
            [options]="yesNoOptions()"
            [selected]="[form().prorataApplicable ? 'yes' : 'no']"
            [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_PRORATA' | translate), fullWidth: true }"
            (selectedChange)="patch({ prorataApplicable: $event[0] === 'yes' })" />
          <daf-select
            [options]="stateOptions()"
            [selected]="[form().active ? 'active' : 'inactive']"
            [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_STATE' | translate), fullWidth: true }"
            (selectedChange)="patch({ active: $event[0] === 'active' })" />
        </div>
        <daf-form-field
          [value]="form().formulaExpression ?? ''"
          (valueChange)="patch({ formulaExpression: text($event) || null })"
          [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.FORMULA' | translate), type: 'textarea', rows: 3, fullWidth: true,
                       required: needsFormula(), placeholder: 'STRATE_1 * 0.092 - ABATTEMENT',
                       hint: ('PAYROLL.ADMIN_HOME.RUBRIQUES.FORMULA_HINT' | translate) }" />
        <daf-field-message [hint]="modeHint()" />
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
    .rub-form { display: flex; flex-direction: column; gap: 16px; }
    .rub-form__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
  `],
})
export class EngineRubriquesAdminComponent implements OnInit {
  private readonly api       = inject(PayrollApiService);
  private readonly engine    = inject(PayrollEngineService);
  private readonly translate = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);
  private readonly userStore = inject(UserStore);
  private readonly modal     = inject(ModalService);

  private readonly rubriqueTpl = viewChild.required<TemplateRef<unknown>>('rubriqueTpl');
  modalRef: ModalRef | null = null;

  readonly pays      = signal<PaysDto[]>([]);
  readonly paysId    = signal<number | null>(null);
  readonly rubriques = signal<EngineRubriqueDefDto[]>([]);
  readonly loading   = signal(false);
  readonly failed    = signal(false);
  readonly saving    = signal(false);
  readonly search    = signal('');
  readonly filters   = signal<FilterResult>({});
  private seq = 0;

  /** Pop-up : la rubrique modifiée (null = ajout) et la saisie en cours. */
  readonly editing = signal<EngineRubriqueDefDto | null>(null);
  readonly form    = signal<SaveEngineRubriqueRequest>(blankRubrique());
  readonly error   = signal<string | null>(null);

  readonly strateOptions: SelectOption[] = [1, 2, 3, 4, 5].map(s => ({ value: String(s), label: String(s) }));

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

  /** Droit d'ajouter / modifier (mêmes codes que le serveur). */
  readonly canManage = computed(() =>
    PAYROLL_MANAGE_RUBRIQUES_PERMISSIONS.some(code => this.userStore.hasPermission(code)));

  readonly paysOptions = computed<SelectOption[]>(() =>
    this.pays().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})` })));

  readonly modeOptions = computed<SelectOption[]>(() =>
    ENGINE_CALC_MODES.map(m => ({ value: m, label: this.modeLabel(m) })));

  readonly yesNoOptions = computed<SelectOption[]>(() => [
    { value: 'yes', label: this.t('PAYROLL.ADMIN_HOME.YES') },
    { value: 'no',  label: this.t('PAYROLL.ADMIN_HOME.NO') },
  ]);

  readonly stateOptions = computed<SelectOption[]>(() => [
    { value: 'active',   label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ACTIVE') },
    { value: 'inactive', label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.INACTIVE') },
  ]);

  /** Nature code (GAIN/RETENUE/AVANTAGE/INDEMNITE/PRIME) → label; a free-typed code shows as itself. */
  private natureLabel(nature: string): string {
    const key = `PAYROLL.ENGINE_RUN.NATURE.${nature}`;
    const label = this.t(key);
    return label === key ? nature : label;
  }

  private modeLabel(mode: string): string {
    const key = `PAYROLL.ADMIN_HOME.RUBRIQUES.MODE.${mode}`;
    const label = this.t(key);
    return label === key ? mode : label;
  }

  // Champs obligatoires selon le mode — mêmes règles que le serveur.
  readonly needsTaux    = computed(() => ['TAUX_PCT', 'MONTANT_FIXE', 'NEWTON_RAPHSON'].includes(this.form().modeCalcul));
  readonly needsBareme  = computed(() => ['BAREME_PROGRESSIF', 'ANNUALISE_BAREME'].includes(this.form().modeCalcul));
  readonly needsFormula = computed(() => ['FORMULE', 'NEWTON_RAPHSON'].includes(this.form().modeCalcul));
  /** Ce qu'attend le mode choisi, sous le formulaire. */
  readonly modeHint = computed(() => this.t(`PAYROLL.ADMIN_HOME.RUBRIQUES.MODE_HINT.${this.form().modeCalcul}`));

  selectPays(raw: string | undefined): void {
    const id = raw ? Number(raw) : null;
    this.paysId.set(id);
    this.rubriques.set([]);
    this.failed.set(false);
    if (!id) return;
    const current = ++this.seq;
    this.loading.set(true);
    this.engine.listAllRubriques(id).subscribe({
      next: list => {
        if (current !== this.seq) return;
        this.rubriques.set(sortRubriques(list));
        this.loading.set(false);
      },
      error: () => { if (current === this.seq) { this.failed.set(true); this.loading.set(false); } },
    });
  }

  readonly filterFields = computed<FilterField[]>(() => {
    const all = this.t('PAYROLL.ADMIN_HOME.FILTER_ALL');
    const list = this.rubriques();
    const select = (name: string, labelKey: string, values: (string | number)[], label = (v: string) => v): FilterField => ({
      name, label: this.t(labelKey), type: 'select', placeholder: all,
      options: distinctSorted(values).map(v => ({ value: String(v), label: label(String(v)) })),
    });
    return [
      { name: 'state', label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_STATE'), type: 'select', placeholder: all, options: this.stateOptions() },
      select('strate', 'PAYROLL.ADMIN_HOME.RUBRIQUES.COL_STRATE', list.map(r => r.strate)),
      select('nature', 'PAYROLL.ADMIN_HOME.RUBRIQUES.COL_NATURE', list.map(r => r.nature), n => this.natureLabel(n)),
      select('mode',   'PAYROLL.ADMIN_HOME.RUBRIQUES.COL_MODE',   list.map(r => r.modeCalcul), m => this.modeLabel(m)),
      { name: 'prorata', label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.FILTER_PRORATA'), type: 'checkbox' },
    ];
  });

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.FILTER_TITLE'),
    triggerLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_TRIGGER'),
    applyLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_RESET'),
    align: 'right',
  }));

  readonly columns = computed<TableColumn[]>(() => [
    // Colonnes numériques typées `number` : la bibliothèque les met en forme.
    { key: 'order',     label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_ORDER'), type: 'number', width: '80px', sortable: true },
    { key: 'code',      label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_CODE'), sortable: true },
    { key: 'label',     label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_LABEL'), sortable: true },
    { key: 'strate',    label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_STRATE'), type: 'number', sortable: true },
    { key: 'nature',    label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_NATURE'), type: 'badge', sortable: true },
    { key: 'mode',      label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_MODE'), sortable: true },
    { key: 'keys',      label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_KEYS'), sortable: true },
    { key: 'period',    label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_PERIODICITY'), sortable: true },
    { key: 'contracts', label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_CONTRACTS'), sortable: true },
    { key: 'state',     label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_STATE'), type: 'badge', sortable: true },
  ]);

  readonly rows = computed<TableRow[]>(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filters();
    const state = pickValue(f, 'state');
    const strate = pickValue(f, 'strate');
    const nature = pickValue(f, 'nature');
    const mode = pickValue(f, 'mode');
    const prorataOnly = f['prorata'] === true;
    const lang = this.translate.getCurrentLang();
    return this.rubriques()
      .filter(r => (!q || `${r.code} ${r.labelFr} ${r.labelEn ?? ''}`.toLowerCase().includes(q))
        && (!state || r.active === (state === 'active'))
        && (!strate || String(r.strate) === strate)
        && (!nature || r.nature === nature)
        && (!mode || r.modeCalcul === mode)
        && (!prorataOnly || r.prorataApplicable))
      .map(r => ({
        id: r.id,
        order: r.displayOrder,
        code: r.code,
        label: (lang === 'en' && r.labelEn) || r.labelFr,
        strate: r.strate,
        nature: { label: this.natureLabel(r.nature), options: { variant: 'neutral', size: 'sm' } } satisfies BadgeCell,
        mode: this.modeLabel(r.modeCalcul),
        keys: [r.paramKeyTaux, r.paramKeyPlafond, r.paramKeyBareme].filter(Boolean).join(' · ') || '—',
        period: r.periodicite,
        contracts: r.contractTypeFilter || this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ALL_CONTRACTS'),
        state: {
          label: this.t(r.active ? 'PAYROLL.ADMIN_HOME.RUBRIQUES.ACTIVE' : 'PAYROLL.ADMIN_HOME.RUBRIQUES.INACTIVE'),
          options: { variant: r.active ? 'success' : 'neutral', size: 'sm', dot: true },
        } satisfies BadgeCell,
        _source: r,
      }));
  });

  /** Pages de 5 lignes, comme les sections de /rh/admin. */
  readonly pager = new AdminPager(() => this.rows(), () => this.columns());

  /** Message de la liste vide : pas de pays, échec, aucune rubrique, ou filtre sans résultat. */
  readonly emptyKey = computed(() =>
    !this.paysId() ? 'PAYROLL.ADMIN_HOME.NO_PAYS'
      : this.failed() ? 'PAYROLL.ADMIN_HOME.LOAD_ERROR'
      : this.rubriques().length ? 'PAYROLL.ADMIN_HOME.NO_RESULT'
      : 'PAYROLL.ADMIN_HOME.RUBRIQUES.EMPTY');

  readonly tableConfig = computed<TableConfig>(() => ({
    showHeader: false, hoverable: true,
    ...tableTools(this.translate),
    ...delegatedSort(untracked(this.pager.sort)),
    rowId: row => row['id'],
    emptyMessage: this.t(
      !this.paysId() ? 'PAYROLL.ADMIN_HOME.NO_PAYS'
        : this.failed() ? 'PAYROLL.ADMIN_HOME.LOAD_ERROR'
        : 'PAYROLL.ADMIN_HOME.RUBRIQUES.EMPTY'),
    actions: this.canManage()
      ? [{ id: 'edit', icon: 'edit', tooltip: this.t('PAYROLL.ADMIN_HOME.EDIT'),
           onClick: row => this.openRubrique(row['_source'] as EngineRubriqueDefDto) }]
      : [],
  }));

  // ── Saisie ────────────────────────────────────────────────────────────────
  text(value: unknown): string {
    return (value ?? '').toString().trim();
  }

  int(value: unknown): number {
    const n = Math.trunc(Number(value));
    return isNaN(n) ? 0 : n;
  }

  patch(change: Partial<SaveEngineRubriqueRequest>): void {
    this.form.update(f => ({ ...f, ...change }));
  }

  openRubrique(r: EngineRubriqueDefDto | null): void {
    this.editing.set(r);
    const next = (this.rubriques().reduce((max, x) => Math.max(max, x.displayOrder), 0) || 0) + 10;
    this.form.set(r ? toRequest(r) : { ...blankRubrique(), displayOrder: next });
    this.error.set(null);
    this.modalRef = this.modal.open({
      title: r
        ? this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.EDIT_TITLE', { code: r.code })
        : this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ADD'),
      icon: 'receipt_long',
      body: this.rubriqueTpl(),
      size: 'lg',
      closeOnBackdrop: false,
    });
  }

  /** Contrôles du serveur repris ici, pour un message avant l'envoi. */
  private validate(f: SaveEngineRubriqueRequest): string | null {
    if (this.editing() === null && !/^[A-Z0-9_]{1,20}$/.test(f.code)) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_CODE');
    if (this.editing() === null && this.rubriques().some(r => r.code === f.code))
      return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_DUPLICATE', { code: f.code });
    if (!f.labelFr) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_LABEL');
    if (!f.nature) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_NATURE');
    if (this.needsTaux() && !f.paramKeyTaux) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_TAUX');
    if (this.needsBareme() && !f.paramKeyBareme) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_BAREME');
    if (this.needsFormula() && !f.formulaExpression) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_FORMULA');
    return null;
  }

  submit(): void {
    if (this.saving()) return;
    const f = this.form();
    const problem = this.validate(f);
    if (problem) { this.error.set(problem); return; }
    const editing = this.editing();
    const paysId = this.paysId();
    if (!editing && !paysId) return;
    this.saving.set(true);
    this.error.set(null);
    const call$ = editing ? this.engine.updateRubrique(editing.id, f) : this.engine.createRubrique(paysId!, f);
    call$.subscribe({
      next: saved => {
        this.rubriques.update(list => sortRubriques([...list.filter(r => r.id !== saved.id), saved]));
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

function sortRubriques(list: EngineRubriqueDefDto[]): EngineRubriqueDefDto[] {
  return [...list].sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code));
}

function toRequest(r: EngineRubriqueDefDto): SaveEngineRubriqueRequest {
  const { id: _id, countryId: _country, ...rest } = r;
  return rest;
}

function blankRubrique(): SaveEngineRubriqueRequest {
  return {
    code: '', labelFr: '', labelEn: null, strate: 1, nature: '', modeCalcul: 'TAUX_PCT', assietteCode: null,
    paramKeyTaux: null, paramKeyPlafond: null, paramKeyBareme: null, formulaExpression: null,
    contractTypeFilter: null, periodicite: 'MENSUEL', prorataApplicable: false, displayOrder: 0, active: true,
  };
}
