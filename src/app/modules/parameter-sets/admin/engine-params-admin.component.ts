import { ChangeDetectionStrategy, Component, OnInit, TemplateRef, computed, inject, signal, viewChild, untracked } from '@angular/core';
import { catchError, of, type Observable } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent, DataTableComponent, FieldMessageComponent, FormFieldComponent, ModalService, SearchToolbarComponent,
  SectionTitleComponent, SelectComponent,
  type BadgeCell, type BadgeVariant, type ModalRef, type SelectOption,
  type TableColumn, type TableConfig, type TableRow,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, type PaysDto } from '../../../core/payroll-api.service';
import {
  PayrollEngineService, type EngineParamSetDto, type EngineRubriqueDefDto,
} from '../../../core/payroll-engine.service';
import {
  PAYROLL_ENGINE_EDIT_PERMISSIONS, PAYROLL_ENGINE_FINANCE_PERMISSIONS, PAYROLL_ENGINE_SUBMIT_PERMISSIONS,
} from '../../../core/payroll-nav';
import { NotificationService } from '../../../core/notification.service';
import { UserStore } from '../../../core/user.store';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from './admin-section-header.component';
import {
  AdminModalFooterComponent, AdminPager, AdminSpinnerComponent, AdminTableFooterComponent,
} from './admin-section-kit';
import { delegatedSort, searchTableRows, tableTools } from '../../../shared/table-tools';

type ParamKind = 'number' | 'text' | 'boolean' | 'bareme';

/** Un paramètre du jeu : sa clé, sa nature, et sa valeur saisie (le barème en JSON). */
interface ParamEntry { key: string; kind: ParamKind; value: string; }

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  DRAFT: 'warning', SUBMITTED: 'info', APPROVED_HR: 'info', APPROVED_FINANCE: 'info', ACTIVE: 'success', ARCHIVED: 'neutral',
};

/**
 * Section « Paramètres du moteur » de l'administration paie : les valeurs que le moteur de
 * paie utilise RÉELLEMENT pour calculer — taux (en %), montants fixes, plafonds, barèmes
 * progressifs — par pays et par version (`payroll_parameter_sets`, jeu ACTIF chargé à
 * chaque calcul). Les rubriques du moteur y renvoient par leurs clés.
 *
 * Cycle : « Nouvelle version » (brouillon, copie de l'active) → modification des paramètres
 * → Soumettre → Approuver (RH) → Approuver (Finance) → Activer (l'ancienne active est
 * archivée). Chaque étape avec ses droits, mêmes codes que le serveur, qui refuse aussi de
 * soumettre une version à laquelle manque une clé utilisée par une rubrique active.
 */
@Component({
  selector: 'app-engine-params-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe, AdminModalFooterComponent, AdminSectionHeaderComponent, AdminSpinnerComponent,
    AdminTableFooterComponent, ButtonComponent, DataTableComponent, FieldMessageComponent,
    FormFieldComponent, SearchToolbarComponent, SectionTitleComponent, SelectComponent,
  ],
  // Comme une section de /rh/admin : en-tête (titre, aide, pays + bouton vert à droite),
  // tableau des versions (actions du circuit par ligne), puis la version ouverte.
  template: `
    <div class="admin-section">
      <app-admin-section-header
        [title]="'PAYROLL.ADMIN_HOME.CARDS.ENGINE_PARAMS' | translate"
        [subtitle]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.HINT' | translate">
        <div class="admin-pays">
          <daf-select
            [options]="paysOptions()"
            [selected]="paysId() ? ['' + paysId()] : []"
            [config]="{ placeholder: ('PAYROLL.SELECT.PAYS_PLACEHOLDER' | translate), searchable: true, fullWidth: true }"
            (selectedChange)="selectPays($event[0])" />
        </div>
        @if (canCreateDraft()) {
          <daf-button class="admin-desktop-only"
            [label]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.NEW_VERSION' | translate"
            variant="teal"
            [options]="{ iconStart: 'add', disabled: busy() }"
            (onClick)="createDraft()" />
          <daf-button class="admin-mobile-only"
            [title]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.NEW_VERSION' | translate"
            variant="teal"
            [options]="{ iconStart: 'add', size: 'sm', disabled: busy() }"
            (onClick)="createDraft()" />
        }
      </app-admin-section-header>

      <!-- Versions — comme les sections RH : indicateur, message centré si vide (avec
           « Nouvelle version »), sinon tableau paginé. -->
      @if (loading()) {
        <app-admin-spinner />
      } @else if (!versions().length) {
        <div class="admin-empty">
          <p>{{ (!paysId() ? 'PAYROLL.ADMIN_HOME.NO_PAYS' : failed() ? 'PAYROLL.ADMIN_HOME.LOAD_ERROR' : 'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.EMPTY') | translate }}</p>
          @if (canCreateDraft()) {
            <daf-button [label]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.NEW_VERSION' | translate" variant="ghost" (onClick)="createDraft()" />
          }
        </div>
      } @else {
        <!-- Recherche sur les versions ; réinitialiser + choix des colonnes du tableau à droite
             de la barre ([table]). -->
        <daf-search-toolbar
          [card]="false"
          [showFilter]="false"
          [placeholder]="'PAYROLL.COMMON.TABLE.SEARCH' | translate"
          [value]="versionSearch()" [debounce]="200" (valueChange)="onVersionSearch($event)"
          [table]="versionTable" />
        <div class="admin-table-scroll">
          <daf-data-table #versionTable [columns]="versionColumns()" [rows]="versionPager.rows()" [config]="versionConfig()"
            (sortChange)="versionPager.onSort($event)" (resetClick)="versionPager.onSort(null)" />
        </div>
        <app-admin-table-footer
          [total]="versionPager.total()" [page]="versionPager.current()" [totalPages]="versionPager.totalPages()"
          [unit]="'PAYROLL.ADMIN_HOME.COUNT.VERSIONS' | translate"
          (pageChange)="versionPager.go($event)" />
      }

      @if (selected(); as ps) {
        <div class="params-head">
          <daf-section-title [title]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.VERSION_TITLE' | translate: { version: ps.versionNumber, status: statusLabel(ps.status) }" />
          <div class="params-head__actions">
            @if (isEditable()) {
              <div class="params-date">
                <daf-form-field
                  [value]="ps.effectiveDate"
                  (valueChange)="saveEffectiveDate($event)"
                  [options]="{ type: 'date', label: ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.EFFECTIVE_DATE' | translate), fullWidth: true }" />
              </div>
              <daf-button class="admin-desktop-only"
                [label]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.ADD_PARAM' | translate"
                variant="teal"
                [options]="{ iconStart: 'add', disabled: busy() }"
                (onClick)="openParam(null)" />
              <daf-button class="admin-mobile-only"
                [title]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.ADD_PARAM' | translate"
                variant="teal"
                [options]="{ iconStart: 'add', size: 'sm', disabled: busy() }"
                (onClick)="openParam(null)" />
            }
          </div>
        </div>

        @if (!isEditable()) {
          <daf-field-message [hint]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.READONLY' | translate" />
        }
        @if (missingKeys().length) {
          <daf-field-message [error]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.MISSING_KEYS' | translate: { keys: missingKeys().join(', ') }" />
        }

        <daf-search-toolbar
          [card]="false"
          [showFilter]="false"
          [placeholder]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.SEARCH' | translate"
          [value]="paramSearch()" [debounce]="200" (valueChange)="paramSearch.set($event ?? '')"
          [table]="paramTable() ?? null" />

        @if (!paramRows().length) {
          <div class="admin-empty">
            <p>{{ (entries().length ? 'PAYROLL.ADMIN_HOME.NO_RESULT' : 'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.NO_PARAMS') | translate }}</p>
            @if (isEditable() && !entries().length) {
              <daf-button [label]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.ADD_PARAM' | translate" variant="ghost" (onClick)="openParam(null)" />
            }
          </div>
        } @else {
          <div class="admin-table-scroll">
            <daf-data-table #paramTable [columns]="paramColumns()" [rows]="paramPager.rows()" [config]="paramConfig()"
              (sortChange)="paramPager.onSort($event)" (resetClick)="paramPager.onSort(null)" />
          </div>
          <app-admin-table-footer
            [total]="paramPager.total()" [page]="paramPager.current()" [totalPages]="paramPager.totalPages()"
            [unit]="'PAYROLL.ADMIN_HOME.COUNT.PARAMS' | translate"
            (pageChange)="paramPager.go($event)" />
        }
      }
    </div>

    <ng-template #paramTpl>
      <div class="param-form">
        <div class="param-form__grid">
          <daf-form-field
            [value]="form().key"
            (valueChange)="patch({ key: text($event) })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_KEY' | translate), placeholder: 'CNSS_TAUX_SALARIE', required: true, fullWidth: true,
                         disabled: editKey() !== null, hint: ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.KEY_HINT' | translate) }" />
          <daf-select
            [options]="kindOptions()"
            [selected]="[form().kind]"
            [config]="{ label: ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_TYPE' | translate), required: true, fullWidth: true }"
            (selectedChange)="changeKind($event[0])" />
        </div>
        @switch (form().kind) {
          @case ('number') {
            <daf-form-field
              [value]="form().value"
              (valueChange)="patch({ value: text($event) })"
              [options]="{ label: ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_VALUE' | translate), type: 'number', align: 'end', required: true, fullWidth: true,
                           hint: ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.NUMBER_HINT' | translate) }" />
          }
          @case ('boolean') {
            <daf-select
              [options]="yesNoOptions()"
              [selected]="[form().value === 'true' ? 'true' : 'false']"
              [config]="{ label: ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_VALUE' | translate), required: true, fullWidth: true }"
              (selectedChange)="patch({ value: $event[0] === 'true' ? 'true' : 'false' })" />
          }
          @case ('bareme') {
            <daf-form-field
              [value]="form().value"
              (valueChange)="patch({ value: ($event ?? '').toString() })"
              [options]="{ label: ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.BAREME' | translate), type: 'textarea', rows: 8, required: true, fullWidth: true,
                           placeholder: baremePlaceholder, hint: ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.BAREME_HINT' | translate) }" />
          }
          @default {
            <daf-form-field
              [value]="form().value"
              (valueChange)="patch({ value: ($event ?? '').toString() })"
              [options]="{ label: ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_VALUE' | translate), required: true, fullWidth: true }" />
          }
        }
        @if (usedBy(form().key).length) {
          <daf-field-message [hint]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.USED_BY' | translate: { codes: usedBy(form().key).join(', ') }" />
        }
        @if (error()) {
          <div class="admin-error-banner" role="alert">{{ error() }}</div>
        }
        <app-admin-modal-footer
          [saveLabel]="'PAYROLL.ADMIN_HOME.SAVE' | translate"
          [cancelLabel]="'PAYROLL.ADMIN_HOME.CANCEL' | translate"
          [saving]="busy()"
          (save)="submitParam()"
          (cancel)="modalRef?.close()" />
      </div>
    </ng-template>
  `,
  styles: [ADMIN_SECTION_STYLES, `
    .params-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; margin-top: 8px; }
    .params-head__actions { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
    .params-date { width: 200px; max-width: 100%; }
    .param-form { display: flex; flex-direction: column; gap: 16px; }
    .param-form__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  `],
})
export class EngineParamsAdminComponent implements OnInit {
  /** Tableau des paramètres de la version choisie — passé au
   *  `[table]` de sa barre : réinitialiser + choix des colonnes à droite de la recherche. */
  readonly paramTable = viewChild<DataTableComponent>('paramTable');

  private readonly api          = inject(PayrollApiService);
  private readonly engine       = inject(PayrollEngineService);
  private readonly translate    = inject(TranslateService);
  private readonly userStore    = inject(UserStore);
  private readonly modal        = inject(ModalService);
  private readonly notification = inject(NotificationService);

  private readonly paramTpl = viewChild.required<TemplateRef<unknown>>('paramTpl');
  modalRef: ModalRef | null = null;

  readonly pays       = signal<PaysDto[]>([]);
  readonly paysId     = signal<number | null>(null);
  readonly versions   = signal<EngineParamSetDto[]>([]);
  readonly rubriques  = signal<EngineRubriqueDefDto[]>([]);
  readonly selectedId = signal<number | null>(null);
  readonly loading    = signal(false);
  readonly failed     = signal(false);
  readonly busy       = signal(false);
  readonly paramSearch = signal('');
  readonly versionSearch = signal('');
  private seq = 0;

  /** Pop-up paramètre : la saisie et la clé modifiée (null = ajout). */
  readonly form    = signal<ParamEntry>({ key: '', kind: 'number', value: '' });
  readonly editKey = signal<string | null>(null);
  readonly error   = signal<string | null>(null);

  /** Exemple de barème — JSON valide, recopiable tel quel. */
  readonly baremePlaceholder = '[\n  {"min": 0, "max": 5000, "rate": 0},\n  {"min": 5000, "max": 20000, "rate": 26},\n  {"min": 20000, "max": null, "rate": 35}\n]';

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  ngOnInit(): void {
    this.api.listPays().pipe(catchError(() => of([] as PaysDto[]))).subscribe(list => {
      this.pays.set(list);
      const userPaysId = this.userStore.currentUser()?.paysId;
      const initial = list.find(p => p.id === userPaysId) ?? (list.length === 1 ? list[0] : null);
      if (initial) this.selectPays(String(initial.id));
    });
  }

  // ── Droits (mêmes codes que le serveur) ───────────────────────────────────
  private has(codes: readonly string[]): boolean {
    return codes.some(code => this.userStore.hasPermission(code));
  }
  readonly canEdit    = computed(() => this.has(PAYROLL_ENGINE_EDIT_PERMISSIONS));
  readonly canSubmit  = computed(() => this.has(PAYROLL_ENGINE_SUBMIT_PERMISSIONS));
  readonly canFinance = computed(() => this.has(PAYROLL_ENGINE_FINANCE_PERMISSIONS));

  /** Un seul brouillon à la fois par pays (règle du serveur). */
  readonly canCreateDraft = computed(() =>
    this.canEdit() && !!this.paysId() && !this.loading() && !this.failed()
    && !this.versions().some(v => v.status === 'DRAFT'));

  readonly paysOptions = computed<SelectOption[]>(() =>
    this.pays().map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})` })));

  readonly kindOptions = computed<SelectOption[]>(() =>
    (['number', 'text', 'boolean', 'bareme'] as const).map(k => ({ value: k, label: this.t(`PAYROLL.ADMIN_HOME.ENGINE_PARAMS.KIND.${k}`) })));

  readonly yesNoOptions = computed<SelectOption[]>(() => [
    { value: 'true',  label: this.t('PAYROLL.ADMIN_HOME.YES') },
    { value: 'false', label: this.t('PAYROLL.ADMIN_HOME.NO') },
  ]);

  statusLabel(status: string): string {
    const key = `PAYROLL.ADMIN_HOME.ENGINE_PARAMS.STATUS.${status}`;
    const label = this.t(key);
    return label === key ? status : label;
  }

  // ── Chargement ────────────────────────────────────────────────────────────
  selectPays(raw: string | undefined): void {
    const id = raw ? Number(raw) : null;
    this.paysId.set(id);
    this.versions.set([]);
    this.rubriques.set([]);
    this.selectedId.set(null);
    this.versionSearch.set('');
    this.failed.set(false);
    if (!id) return;
    const current = ++this.seq;
    this.loading.set(true);
    this.engine.listRubriques(id).pipe(catchError(() => of([] as EngineRubriqueDefDto[])))
      .subscribe(list => { if (current === this.seq) this.rubriques.set(list); });
    this.engine.listParamSets(id).subscribe({
      next: list => {
        if (current !== this.seq) return;
        const sorted = [...list].sort((a, b) => b.versionNumber - a.versionNumber);
        this.versions.set(sorted);
        // Ouvre d'office le brouillon, sinon l'active, sinon la plus récente.
        const open = sorted.find(v => v.status === 'DRAFT') ?? sorted.find(v => v.status === 'ACTIVE') ?? sorted[0];
        this.selectedId.set(open?.id ?? null);
        this.loading.set(false);
      },
      error: () => { if (current === this.seq) { this.failed.set(true); this.loading.set(false); } },
    });
  }

  readonly selected   = computed(() => this.versions().find(v => v.id === this.selectedId()) ?? null);
  readonly isEditable = computed(() => this.selected()?.status === 'DRAFT' && this.canEdit());

  /** Paramètres de la version ouverte, dans l'ordre alphabétique des clés. */
  readonly entries = computed<ParamEntry[]>(() => parseParams(this.selected()?.parameters));

  /** Clés utilisées par les rubriques actives et absentes de la version ouverte. */
  readonly missingKeys = computed(() => {
    const present = new Set(this.entries().map(e => e.key));
    const used = new Set<string>();
    for (const r of this.rubriques()) {
      for (const k of [r.paramKeyTaux, r.paramKeyPlafond, r.paramKeyBareme]) if (k) used.add(k);
    }
    return [...used].filter(k => !present.has(k)).sort();
  });

  /** Codes des rubriques actives qui utilisent une clé. */
  usedBy(key: string): string[] {
    return this.rubriques()
      .filter(r => [r.paramKeyTaux, r.paramKeyPlafond, r.paramKeyBareme].includes(key))
      .map(r => r.code);
  }

  // ── Tableau des versions ──────────────────────────────────────────────────
  readonly versionColumns = computed<TableColumn[]>(() => [
    // « v12 » se trierait mal en texte (v10 avant v9) : trié sur le numéro.
    { key: 'version',   label: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_VERSION'), sortable: true,
      sortAccessor: row => (row['_source'] as EngineParamSetDto).versionNumber },
    { key: 'status',    label: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_STATUS'), type: 'badge', sortable: true },
    { key: 'effective', label: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.EFFECTIVE_DATE'), type: 'date', format: { dateStyle: 'short' }, sortable: true },
    { key: 'count',     label: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_COUNT'), type: 'number', sortable: true },
    { key: 'createdBy', label: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_CREATED_BY'), sortable: true },
    { key: 'activated', label: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_ACTIVATED'), type: 'date', format: { dateStyle: 'short' }, sortable: true },
  ]);

  readonly versionRows = computed<TableRow[]>(() =>
    this.versions().map(v => ({
      id: v.id,
      version: `v${v.versionNumber}${v.id === this.selectedId() ? ' ◂' : ''}`,
      status: {
        label: this.statusLabel(v.status),
        options: { variant: STATUS_VARIANT[v.status] ?? 'neutral', size: 'sm', dot: true },
      } satisfies BadgeCell,
      effective: v.effectiveDate,
      count: parseParams(v.parameters).length,
      createdBy: v.createdBy ?? '—',
      activated: v.activatedAt,
      _source: v,
    })));

  /** Colonnes de recherche des versions : le texte AFFICHÉ (« v12 », dates en `Date` mises en
   *  forme par `searchTableRows`), pas la valeur de tri (le numéro seul). */
  private readonly versionSearchColumns = computed<TableColumn[]>(() => this.versionColumns().map(c => {
    if (c.key === 'version') return { ...c, sortAccessor: row => row['version'] as string };
    if (c.type === 'date') return { ...c, sortAccessor: row => (row[c.key] ? new Date(row[c.key] as string) : null) };
    return c;
  }));

  /** Versions retenues par la recherche, avant tri et découpe en pages. */
  readonly filteredVersionRows = computed(() =>
    searchTableRows(this.versionRows(), this.versionSearchColumns(), this.versionSearch()));

  /** Nouvelle recherche → retour à la première page. */
  onVersionSearch(value: string | null | undefined): void {
    this.versionSearch.set(value ?? '');
    this.versionPager.go(0);
  }

  /** Pages de 5 lignes, comme les sections de /rh/admin. */
  readonly versionPager = new AdminPager(() => this.filteredVersionRows(), () => this.versionColumns());
  readonly paramPager   = new AdminPager(() => this.paramRows(), () => this.paramColumns());

  readonly versionConfig = computed<TableConfig>(() => {
    const status = (row: TableRow) => (row['_source'] as EngineParamSetDto).status;
    return {
      showHeader: false, hoverable: true,
      ...tableTools(this.translate),
      ...delegatedSort(untracked(this.versionPager.sort)),
      rowId: row => row['id'],
      emptyMessage: this.t(
        this.versionSearch().trim() ? 'PAYROLL.ADMIN_HOME.NO_RESULT'
          : !this.paysId() ? 'PAYROLL.ADMIN_HOME.NO_PAYS'
          : this.failed() ? 'PAYROLL.ADMIN_HOME.LOAD_ERROR'
          : 'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.EMPTY'),
      actions: [
        { id: 'open', icon: 'visibility', tooltip: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.OPEN'),
          onClick: row => this.selectedId.set(row['id'] as number) },
        { id: 'submit', icon: 'send', tooltip: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.SUBMIT'),
          hidden: row => !(status(row) === 'DRAFT' && this.canSubmit()),
          onClick: row => this.confirmStep(row['_source'] as EngineParamSetDto, 'SUBMIT') },
        { id: 'approve-hr', icon: 'how_to_reg', tooltip: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.APPROVE_HR'),
          hidden: row => !(status(row) === 'SUBMITTED' && this.canSubmit()),
          onClick: row => this.confirmStep(row['_source'] as EngineParamSetDto, 'APPROVE_HR') },
        { id: 'approve-finance', icon: 'verified', tooltip: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.APPROVE_FINANCE'),
          hidden: row => !(status(row) === 'APPROVED_HR' && this.canFinance()),
          onClick: row => this.confirmStep(row['_source'] as EngineParamSetDto, 'APPROVE_FINANCE') },
        { id: 'activate', icon: 'rocket_launch', tooltip: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.ACTIVATE'),
          hidden: row => !(status(row) === 'APPROVED_FINANCE' && this.canFinance()),
          onClick: row => this.confirmStep(row['_source'] as EngineParamSetDto, 'ACTIVATE') },
      ],
    };
  });

  // ── Tableau des paramètres ────────────────────────────────────────────────
  readonly paramColumns = computed<TableColumn[]>(() => [
    { key: 'key',    label: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_KEY'), sortable: true },
    { key: 'kind',   label: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_TYPE'), type: 'badge', sortable: true },
    { key: 'value',  label: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_VALUE'), sortable: true },
    { key: 'usedBy', label: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_USED_BY'), sortable: true },
  ]);

  readonly paramRows = computed<TableRow[]>(() => {
    const q = this.paramSearch().trim().toLowerCase();
    return this.entries()
      .filter(e => !q || e.key.toLowerCase().includes(q))
      .map(e => ({
        id: e.key,
        key: e.key,
        kind: { label: this.t(`PAYROLL.ADMIN_HOME.ENGINE_PARAMS.KIND.${e.kind}`), options: { variant: 'neutral', size: 'sm' } } satisfies BadgeCell,
        value: this.display(e),
        usedBy: this.usedBy(e.key).join(', ') || '—',
        _key: e.key,
      }));
  });

  readonly paramConfig = computed<TableConfig>(() => ({
    showHeader: false, hoverable: true,
    ...tableTools(this.translate),
    ...delegatedSort(untracked(this.paramPager.sort)),
    rowId: row => row['id'],
    emptyMessage: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.NO_PARAMS'),
    actions: this.isEditable()
      ? [
          { id: 'edit', icon: 'edit', tooltip: this.t('PAYROLL.ADMIN_HOME.EDIT'), onClick: row => this.openParam(row['_key'] as string) },
          { id: 'delete', icon: 'delete', tooltip: this.t('PAYROLL.ADMIN_HOME.DELETE'), variant: 'danger',
            onClick: row => this.confirmDeleteParam(row['_key'] as string) },
        ]
      : [],
  }));

  private display(e: ParamEntry): string {
    if (e.kind === 'boolean') return this.t(e.value === 'true' ? 'PAYROLL.ADMIN_HOME.YES' : 'PAYROLL.ADMIN_HOME.NO');
    if (e.kind === 'bareme') {
      try {
        const n = (JSON.parse(e.value) as unknown[]).length;
        return this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.BRACKETS', { count: n });
      } catch { return e.value; }
    }
    if (e.kind === 'number') {
      const locale = this.translate.getCurrentLang() === 'en' ? 'en-US' : 'fr-FR';
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(Number(e.value));
    }
    return e.value;
  }

  // ── Circuit de validation ─────────────────────────────────────────────────
  createDraft(): void {
    const paysId = this.paysId();
    if (!paysId || this.busy()) return;
    this.run(this.engine.createParamSetDraft(paysId), created => {
      this.versions.update(list => [created, ...list].sort((a, b) => b.versionNumber - a.versionNumber));
      this.selectedId.set(created.id);
      this.notification.success(this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.DRAFT_CREATED', { version: created.versionNumber }));
    });
  }

  private confirmStep(v: EngineParamSetDto, step: 'SUBMIT' | 'APPROVE_HR' | 'APPROVE_FINANCE' | 'ACTIVATE'): void {
    const by = this.userStore.currentUser()?.fullName ?? undefined;
    const call$ = {
      SUBMIT:          () => this.engine.submitParamSet(v.id, by),
      APPROVE_HR:      () => this.engine.approveHrParamSet(v.id, by),
      APPROVE_FINANCE: () => this.engine.approveFinanceParamSet(v.id, by),
      ACTIVATE:        () => this.engine.activateParamSet(v.id, by),
    }[step];
    this.modal.open({
      title: this.t(`PAYROLL.ADMIN_HOME.ENGINE_PARAMS.CONFIRM.${step}.TITLE`, { version: v.versionNumber }),
      body: this.t(`PAYROLL.ADMIN_HOME.ENGINE_PARAMS.CONFIRM.${step}.BODY`, { version: v.versionNumber }),
      size: 'sm',
      closeOnBackdrop: false,
      buttons: [
        { label: this.t('PAYROLL.ADMIN_HOME.CANCEL'), variant: 'secondary', action: r => r.close() },
        {
          label: this.t(`PAYROLL.ADMIN_HOME.ENGINE_PARAMS.${step === 'SUBMIT' ? 'SUBMIT' : step}`), variant: 'primary',
          action: r => {
            r.close();
            // Activer archive l'ancienne active : on recharge la liste plutôt qu'une ligne.
            this.run(call$(), () => this.selectPays(String(this.paysId())));
          },
        },
      ],
    });
  }

  /** Appel serveur avec état « occupé » et message d'erreur du serveur en notification. */
  private run<T>(call$: Observable<T>, onDone: (result: T) => void, onError?: (message: string) => void): void {
    this.busy.set(true);
    call$.subscribe({
      next: result => { this.busy.set(false); onDone(result); },
      error: err => {
        this.busy.set(false);
        const message = errorMessage(err) ?? this.t('PAYROLL.ADMIN_HOME.SAVE_ERROR');
        if (onError) onError(message); else this.notification.error(message);
      },
    });
  }

  // ── Édition des paramètres (brouillon) ────────────────────────────────────
  text(value: unknown): string {
    return (value ?? '').toString().trim();
  }

  patch(change: Partial<ParamEntry>): void {
    this.form.update(f => ({ ...f, ...change }));
  }

  changeKind(kind: string | undefined): void {
    const k = (kind ?? 'number') as ParamKind;
    this.patch({ kind: k, value: k === 'boolean' ? 'false' : k === 'bareme' ? '' : this.form().value });
  }

  saveEffectiveDate(value: unknown): void {
    const ps = this.selected();
    const date = this.text(value);
    if (!ps || !date || date === ps.effectiveDate) return;
    this.save(ps.parameters, date);
  }

  openParam(key: string | null): void {
    const current = key ? this.entries().find(e => e.key === key) : undefined;
    this.editKey.set(key);
    this.form.set(current ? { ...current } : { key: '', kind: 'number', value: '' });
    this.error.set(null);
    this.modalRef = this.modal.open({
      title: key ? this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.EDIT_PARAM', { key }) : this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.ADD_PARAM'),
      icon: 'tune',
      body: this.paramTpl(),
      size: 'md',
      closeOnBackdrop: false,
    });
  }

  submitParam(): void {
    if (this.busy()) return;
    this.error.set(null);
    const f = this.form();
    const editing = this.editKey();
    if (!/^[A-Za-z0-9_.]{1,50}$/.test(f.key)) { this.error.set(this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.ERR_KEY')); return; }
    if (editing === null && this.entries().some(e => e.key === f.key)) {
      this.error.set(this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.ERR_DUPLICATE', { key: f.key })); return;
    }
    const value = toJsonValue(f);
    if (value === INVALID) { this.error.set(this.t(`PAYROLL.ADMIN_HOME.ENGINE_PARAMS.ERR_VALUE.${f.kind}`)); return; }
    const obj = toObject(this.entries());
    obj[f.key] = value;
    this.save(JSON.stringify(obj), null, message => this.error.set(message), () => this.modalRef?.close());
  }

  private confirmDeleteParam(key: string): void {
    const used = this.usedBy(key);
    this.modal.open({
      title: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.DELETE_TITLE'),
      body: used.length
        ? this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.DELETE_USED', { key, codes: used.join(', ') })
        : this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.DELETE_CONFIRM', { key }),
      size: 'sm',
      closeOnBackdrop: false,
      buttons: [
        { label: this.t('PAYROLL.ADMIN_HOME.CANCEL'), variant: 'secondary', action: r => r.close() },
        {
          label: this.t('PAYROLL.ADMIN_HOME.DELETE'), variant: 'primary',
          action: r => {
            const obj = toObject(this.entries());
            delete obj[key];
            r.close();
            this.save(JSON.stringify(obj), null);
          },
        },
      ],
    });
  }

  /** Enregistre les paramètres (et la date) de la version ouverte ; remplace la ligne. */
  private save(parameters: string, effectiveDate: string | null, onError?: (m: string) => void, onDone?: () => void): void {
    const ps = this.selected();
    if (!ps || this.busy()) return;
    this.run(this.engine.updateParamSetDraft(ps.id, parameters, effectiveDate), updated => {
      this.versions.update(list => list.map(v => (v.id === updated.id ? updated : v)));
      onDone?.();
    }, onError);
  }
}

// ── JSON des paramètres ⇄ lignes ─────────────────────────────────────────────
const INVALID = Symbol('invalid');

function parseParams(raw: string | null | undefined): ParamEntry[] {
  let obj: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
  } catch { /* JSON illisible : aucun paramètre affiché */ }
  return Object.keys(obj).sort().map(key => {
    const v = obj[key];
    if (Array.isArray(v)) return { key, kind: 'bareme' as const, value: JSON.stringify(v, null, 2) };
    if (typeof v === 'number') return { key, kind: 'number' as const, value: String(v) };
    if (typeof v === 'boolean') return { key, kind: 'boolean' as const, value: String(v) };
    return { key, kind: 'text' as const, value: v == null ? '' : String(v) };
  });
}

function toObject(entries: ParamEntry[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const e of entries) {
    const v = toJsonValue(e);
    if (v !== INVALID) obj[e.key] = v;
  }
  return obj;
}

/** Valeur JSON d'une ligne — mêmes règles que le serveur (barème : tranches {min, max?, rate}). */
function toJsonValue(e: ParamEntry): unknown {
  switch (e.kind) {
    case 'number': {
      const n = Number(e.value);
      return e.value.trim() === '' || isNaN(n) ? INVALID : n;
    }
    case 'boolean': return e.value === 'true';
    case 'bareme': {
      try {
        const brackets = JSON.parse(e.value);
        if (!Array.isArray(brackets) || !brackets.length) return INVALID;
        for (const b of brackets) {
          if (!b || typeof b !== 'object' || typeof b.min !== 'number' || typeof b.rate !== 'number') return INVALID;
          if (b.max != null && (typeof b.max !== 'number' || b.max < b.min)) return INVALID;
        }
        return brackets;
      } catch { return INVALID; }
    }
    default: return e.value;
  }
}

function errorMessage(err: unknown): string | null {
  const body = (err as { error?: { detail?: string; message?: string } } | null)?.error;
  return body?.detail ?? body?.message ?? null;
}

