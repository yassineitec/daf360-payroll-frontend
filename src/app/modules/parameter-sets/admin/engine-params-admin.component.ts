import { ChangeDetectionStrategy, Component, OnInit, TemplateRef, computed, inject, signal, viewChild, untracked } from '@angular/core';
import { catchError, of, type Observable } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent, DataTableComponent, FieldMessageComponent, FormFieldComponent, ModalService, SearchToolbarComponent,
  SectionTitleComponent, SelectComponent, StepperComponent,
  type BadgeCell, type ModalRef, type SelectOption, type StepperConfig, type StepperStep,
  type TableColumn, type TableConfig, type TableRow,
} from '@khalilrebhiitec/daf360';
import { flagDataUri } from '../../../shared/country-flags';
import { PaysNamesService } from '../../../core/pays-names.service';
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
import { rememberAdminState } from './admin-section-state';
import { delegatedSort, tableTools } from '../../../shared/table-tools';

type ParamKind = 'number' | 'text' | 'boolean' | 'bareme';

/** Un paramètre du jeu : sa clé, sa nature, et sa valeur saisie (le barème en JSON). */
interface ParamEntry { key: string; kind: ParamKind; value: string; }

/** Une tranche de barème telle que saisie : « jusqu'à » (vide = sans limite, dernière tranche) et taux en %. */
interface BracketRow { upper: string; rate: string; }

/** Circuit d'une version, dans l'ordre — une étape du `daf-stepper` chacune (l'archivée termine le circuit). */
const CIRCUIT = ['DRAFT', 'SUBMITTED', 'APPROVED_HR', 'APPROVED_FINANCE', 'ACTIVE'] as const;
type CircuitStep = 'SUBMIT' | 'APPROVE_HR' | 'APPROVE_FINANCE' | 'ACTIVATE';
/** Action qui fait passer une version de son statut au suivant. */
const NEXT_STEP: Partial<Record<string, CircuitStep>> = {
  DRAFT: 'SUBMIT', SUBMITTED: 'APPROVE_HR', APPROVED_HR: 'APPROVE_FINANCE', APPROVED_FINANCE: 'ACTIVATE',
};

/**
 * Section « Taux et barèmes » (paramètres du moteur) de l'administration paie : les valeurs
 * que le CALCUL DE PAIE (/payroll/engine-run) utilise — taux (en %), montants fixes,
 * plafonds, barèmes par tranches — par pays et par version (`payroll_parameter_sets`, jeu
 * ACTIF chargé à chaque calcul). Les « Éléments du bulletin » y renvoient par leurs clés. Le
 * simulateur, lui, lit « Règles de paie » : l'aide de la section le dit.
 *
 * Cycle, dessiné par le `daf-stepper` de la lib au-dessus de la version ouverte, avec le
 * bouton de l'étape suivante : « Nouvelle version » (brouillon, copie de l'active) →
 * modification des paramètres → Soumettre → Approuver (RH) → Approuver (Finance) → Activer
 * (l'ancienne active est archivée). Chaque étape avec ses droits, mêmes codes que le serveur,
 * qui refuse aussi de soumettre une version à laquelle manque une clé utilisée par une
 * rubrique active. Un barème se saisit en tableau de tranches (De / Jusqu'à / Taux), comme
 * celui de l'IRPP dans « Règles de paie » ; le JSON n'est plus montré.
 */
@Component({
  selector: 'app-engine-params-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe, AdminModalFooterComponent, AdminSectionHeaderComponent, AdminSpinnerComponent,
    AdminTableFooterComponent, ButtonComponent, DataTableComponent, FieldMessageComponent,
    FormFieldComponent, SearchToolbarComponent, SectionTitleComponent, SelectComponent, StepperComponent,
  ],
  // Comme une section de /rh/admin : en-tête (titre, aide, bouton vert à droite ; le pays
  // est en haut de la page), pastilles des versions, puis la version ouverte dans une
  // carte : son circuit en étapes, l'action suivante, ses paramètres.
  template: `
    <div class="admin-section">
      <app-admin-section-header
        [title]="'PAYROLL.ADMIN_HOME.CARDS.ENGINE_PARAMS' | translate"
        [subtitle]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.HINT' | translate">
        <!-- Le choix du pays est dans l'en-tête de la page (parameter-sets, ligne du fil
             d'Ariane), qui appelle paysOptions() / paysId() / selectPays(). -->
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
        <!-- Versions du pays en sélecteur compact (1 à 3 en pratique), de la plus ancienne à la
             plus récente : la version ouverte occupe le reste de la page. -->
        <div class="versions" role="group" [attr.aria-label]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.VERSIONS_LABEL' | translate">
          @for (v of chronologicalVersions(); track v.id) {
            <button type="button" class="version-chip" [class.version-chip--on]="v.id === selectedId()"
                    [attr.aria-pressed]="v.id === selectedId()" (click)="openVersion(v.id)">
              <span class="version-chip__num">v{{ v.versionNumber }}</span>
              <span class="version-chip__status" [attr.data-status]="v.status">{{ statusLabel(v.status) }}</span>
            </button>
          }
        </div>
      }

      @if (selected(); as ps) {
        <div class="version-card">
        <div class="params-head">
          <div class="params-head__title">
            <h3 class="version-title">{{ 'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.VERSION_TITLE' | translate: { version: ps.versionNumber, status: statusLabel(ps.status) } }}</h3>
            <p class="version-meta">{{ versionMeta(ps) }}</p>
          </div>
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

        <!-- Circuit de validation de la version ouverte : où elle en est, et l'action suivante
             (bouton si l'utilisateur en a le droit, sinon qui doit la faire). -->
        <div class="circuit">
          <daf-stepper orientation="horizontal" [steps]="circuitSteps()" [currentStep]="circuitIndex()" [config]="circuitConfig()" />
          @if (nextStep(); as step) {
            <div class="circuit__next">
              <span class="circuit__text">{{ ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.NEXT.' + step) | translate }}</span>
              @if (canDo(step)) {
                <daf-button
                  [label]="('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.' + step) | translate"
                  variant="teal"
                  [options]="{ size: 'sm', iconStart: stepIcon(step), disabled: busy() || (step === 'SUBMIT' && missingKeys().length > 0) }"
                  (onClick)="confirmStep(ps, step)" />
              } @else {
                <span class="circuit__who">{{ ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.WAITING.' + step) | translate }}</span>
              }
            </div>
          }
        </div>

        @if (!isEditable()) {
          <daf-field-message [hint]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.READONLY' | translate" />
        }
        @if (missingKeys().length) {
          <daf-field-message [error]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.MISSING_KEYS' | translate: { keys: missingKeys().join(', ') }" />
        }

        <daf-search-toolbar
          [card]="true"
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
        </div>
      }
    </div>

    <ng-template #paramTpl>
      <div class="param-form">
        <div class="param-form__grid">
          <daf-form-field
            [value]="form().key"
            (valueChange)="patch({ key: keyFromInput($event) })"
            [options]="{ label: ('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.COL_KEY' | translate), placeholder: 'PRIME_PANIER_MONTANT', required: true, fullWidth: true,
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
            <!-- Tranches en tableau (même saisie que le barème IRPP des Règles de paie) : chaque
                 tranche commence où finit la précédente, la dernière n'a pas de limite. Le JSON
                 {min, max, rate} est reconstruit à chaque saisie. -->
            <div class="brk">
              <div class="brk__head">
                <daf-section-title [title]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.BAREME' | translate" />
                <daf-button
                  [label]="'PAYROLL.ADMIN.IRPP_ADD' | translate"
                  variant="secondary"
                  [options]="{ size: 'sm', iconStart: 'add' }"
                  (onClick)="addBracket()" />
              </div>
              <p class="brk__hint">{{ 'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.BAREME_HINT' | translate }}</p>
              <div class="brk__row brk__row--head" role="row">
                <span>{{ 'PAYROLL.ADMIN.IRPP_COL_FROM' | translate }}</span>
                <span>{{ 'PAYROLL.ADMIN.IRPP_COL_TO' | translate }}</span>
                <span>{{ 'PAYROLL.ADMIN.IRPP_COL_RATE' | translate }}</span>
                <span></span>
              </div>
              @for (row of brackets(); track $index; let i = $index; let last = $last) {
                <div class="brk__row" role="row">
                  <span class="brk__from">{{ bracketFrom(i) }}</span>
                  @if (last) {
                    <span class="brk__open">{{ 'PAYROLL.ADMIN.IRPP_AND_MORE' | translate }}</span>
                  } @else {
                    <daf-form-field
                      [options]="{ type: 'number', placeholder: '20000', error: bracketError(i, 'upper') }"
                      [value]="row.upper"
                      (valueChange)="setBracket(i, { upper: text($event) })" />
                  }
                  <daf-form-field
                    [options]="{ type: 'number', placeholder: '26', suffixText: '%', error: bracketError(i, 'rate') }"
                    [value]="row.rate"
                    (valueChange)="setBracket(i, { rate: text($event) })" />
                  <span>
                    @if (brackets().length > 1) {
                      <daf-button
                        variant="ghost"
                        [attr.title]="'PAYROLL.ADMIN.IRPP_REMOVE' | translate"
                        [attr.aria-label]="'PAYROLL.ADMIN.IRPP_REMOVE' | translate"
                        [options]="{ size: 'sm', iconStart: 'delete' }"
                        (onClick)="removeBracket(i)" />
                    }
                  </span>
                </div>
              }
            </div>
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
        } @else if (form().key && editKey() !== null) {
          <daf-field-message [hint]="'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.UNUSED' | translate" />
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
    /* Sélecteur des versions : une pastille par version, la version ouverte en couleur. */
    .versions { display: flex; flex-wrap: wrap; gap: 8px; }
    .version-chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; cursor: pointer;
                    font: inherit; font-size: 13px; color: var(--color-on-surface); background: var(--color-surface-container-lowest);
                    border: 1px solid var(--color-outline-variant); transition: border-color .15s, background-color .15s; }
    .version-chip:hover { border-color: var(--color-primary); }
    .version-chip:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .version-chip--on { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-container-lowest)); }
    .version-chip__num { font-weight: 700; }
    .version-chip__status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-on-surface-variant); }
    .version-chip__status::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--color-outline); }
    .version-chip__status[data-status="DRAFT"]::before { background: var(--color-warning); }
    .version-chip__status[data-status="SUBMITTED"]::before,
    .version-chip__status[data-status="APPROVED_HR"]::before,
    .version-chip__status[data-status="APPROVED_FINANCE"]::before { background: var(--color-primary); }
    .version-chip__status[data-status="ACTIVE"]::before { background: var(--color-success); }
    /* Version ouverte : une carte avec son titre, son circuit et ses paramètres. */
    .version-card { display: flex; flex-direction: column; gap: 16px; padding: 20px; border-radius: 16px;
                    background: var(--color-surface-container-lowest); border: 1px solid color-mix(in srgb, var(--color-outline-variant) 60%, transparent); }
    .version-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--color-on-surface); }
    .version-meta { margin: 4px 0 0; font-size: 12px; color: var(--color-on-surface-variant); }
    .params-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
    .params-head__actions { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
    .params-date { width: 200px; max-width: 100%; }
    .param-form { display: flex; flex-direction: column; gap: 16px; }
    .param-form__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    /* Circuit de la version ouverte : étapes de la lib, puis l'action suivante. */
    .circuit { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 12px;
               border: 1px solid color-mix(in srgb, var(--color-outline-variant) 60%, transparent); }
    .circuit__next { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
    .circuit__text { font-size: 13px; color: var(--color-on-surface); }
    .circuit__who { font-size: 12px; color: var(--color-on-surface-variant); font-style: italic; }
    /* Barème en tranches — mêmes proportions que le barème IRPP des Règles de paie. */
    .brk { display: flex; flex-direction: column; gap: 8px; }
    .brk__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .brk__hint { margin: 0; font-size: 12px; color: var(--color-on-surface-variant); }
    .brk__row { display: grid; grid-template-columns: minmax(90px, 1fr) minmax(130px, 2fr) minmax(110px, 1.4fr) 40px; gap: 12px; align-items: start; }
    .brk__row--head { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--color-on-surface-variant); }
    .brk__from, .brk__open { display: flex; align-items: center; min-height: 44px; font-size: 14px; font-variant-numeric: tabular-nums; }
    .brk__open { color: var(--color-on-surface-variant); font-style: italic; }
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
  private readonly paysNames    = inject(PaysNamesService);

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
  private seq = 0;

  /** Pop-up paramètre : la saisie et la clé modifiée (null = ajout). */
  readonly form    = signal<ParamEntry>({ key: '', kind: 'number', value: '' });
  readonly editKey = signal<string | null>(null);
  readonly error   = signal<string | null>(null);

  /** Tranches du barème en cours de saisie ; `bracketStart` = début de la première tranche
   *  (celui du barème existant, sinon 0). Le JSON de `form().value` en est reconstruit. */
  readonly brackets = signal<BracketRow[]>([]);
  private bracketStart = 0;

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  ngOnInit(): void {
    this.api.listPays().pipe(catchError(() => of([] as PaysDto[]))).subscribe(list => {
      this.pays.set(list);
      const userPaysId = this.userStore.currentUser()?.paysId;
      // Pays restauré par la mémoire de la section d'abord, s'il est toujours proposé.
      const restored = this.paysId();
      const initial = list.find(p => p.id === restored)
        ?? list.find(p => p.id === userPaysId) ?? (list.length === 1 ? list[0] : null);
      this.selectPays(initial ? String(initial.id) : undefined, initial != null && initial.id === restored);
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
    this.pays().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})`, imageUrl: flagDataUri(p.isoCode) })));

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
  /** `keepView` : premier chargement d'un pays restauré — sa recherche restaurée est gardée. */
  selectPays(raw: string | undefined, keepView = false): void {
    const id = raw ? Number(raw) : null;
    this.paysId.set(id);
    this.versions.set([]);
    this.rubriques.set([]);
    this.selectedId.set(null);
    if (!keepView) this.paramSearch.set('');
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

  /** Libellés des éléments du bulletin (rubriques actives) qui utilisent une clé. */
  usedBy(key: string): string[] {
    const en = this.translate.getCurrentLang() === 'en';
    return this.rubriques()
      .filter(r => [r.paramKeyTaux, r.paramKeyPlafond, r.paramKeyBareme].includes(key))
      .map(r => (en && r.labelEn) || r.labelFr || r.code);
  }

  // ── Circuit de la version ouverte (daf-stepper) ───────────────────────────
  /** Position dans le circuit ; une version archivée a fait tout le circuit. */
  readonly circuitIndex = computed(() => {
    const status = this.selected()?.status ?? 'DRAFT';
    const i = (CIRCUIT as readonly string[]).indexOf(status);
    return i < 0 ? CIRCUIT.length - 1 : i;
  });

  readonly circuitSteps = computed<StepperStep[]>(() => {
    const v = this.selected();
    if (!v) return [];
    const date = (iso: string | null) => iso
      ? new Intl.DateTimeFormat(this.translate.getCurrentLang() === 'en' ? 'en-US' : 'fr-FR', { dateStyle: 'short' }).format(new Date(iso))
      : '';
    const who = (name: string | null, at: string | null) => [name, date(at)].filter(Boolean).join(' · ') || undefined;
    const subtitles: Record<string, string | undefined> = {
      DRAFT:            who(v.createdBy, v.createdAt),
      SUBMITTED:        who(v.submittedBy, v.submittedAt),
      APPROVED_HR:      who(v.approvedByHr, v.approvedAtHr),
      APPROVED_FINANCE: who(v.approvedByFinance, v.approvedAtFinance),
      ACTIVE:           v.status === 'ARCHIVED' ? this.statusLabel('ARCHIVED') : who(null, v.activatedAt),
    };
    const current = this.circuitIndex();
    const done = v.status === 'ACTIVE' || v.status === 'ARCHIVED';
    return CIRCUIT.map((s, i) => ({
      title: this.statusLabel(s),
      subtitle: i <= current ? subtitles[s] : undefined,
      // Complétion explicite : l'étape en cours n'est « faite » qu'une fois la version active.
      completed: i < current || (done && i === current),
    }));
  });

  readonly circuitConfig = computed<StepperConfig>(() => ({
    chrome: 'header-only',
    labelDensity: 'quiet',
    stepperLabel: this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.CIRCUIT'),
  }));

  /** Action suivante de la version ouverte (aucune une fois active ou archivée). */
  readonly nextStep = computed<CircuitStep | null>(() => NEXT_STEP[this.selected()?.status ?? ''] ?? null);

  /** Mêmes droits que les actions de ligne du tableau des versions. */
  canDo(step: CircuitStep): boolean {
    return step === 'SUBMIT' || step === 'APPROVE_HR' ? this.canSubmit() : this.canFinance();
  }

  stepIcon(step: CircuitStep): string {
    return { SUBMIT: 'send', APPROVE_HR: 'how_to_reg', APPROVE_FINANCE: 'verified', ACTIVATE: 'rocket_launch' }[step];
  }

  // ── Versions du pays ──────────────────────────────────────────────────────
  /** Pastilles du sélecteur, de la plus ancienne à la plus récente. */
  readonly chronologicalVersions = computed(() => [...this.versions()].reverse());

  /** Une autre version ouverte : sa recherche et sa page repartent de zéro. */
  openVersion(id: number): void {
    if (id === this.selectedId()) return;
    this.selectedId.set(id);
    this.paramSearch.set('');
    this.paramPager.go(0);
  }

  /** « Créée par … le … · 3 paramètre(s) · en vigueur au … · activée le … » sous le titre de la version. */
  versionMeta(v: EngineParamSetDto): string {
    const date = (iso: string | null) => iso
      ? new Intl.DateTimeFormat(this.translate.getCurrentLang() === 'en' ? 'en-US' : 'fr-FR', { dateStyle: 'short' }).format(new Date(iso))
      : '';
    const P = 'PAYROLL.ADMIN_HOME.ENGINE_PARAMS.META_';
    return [
      v.createdBy ? this.t(P + 'CREATED_BY', { who: v.createdBy, date: date(v.createdAt) }) : this.t(P + 'CREATED', { date: date(v.createdAt) }),
      `${parseParams(v.parameters).length} ${this.t('PAYROLL.ADMIN_HOME.COUNT.PARAMS')}`,
      v.effectiveDate ? this.t(P + 'EFFECTIVE', { date: date(v.effectiveDate) }) : '',
      v.activatedAt ? this.t(P + 'ACTIVATED', { date: date(v.activatedAt) }) : '',
    ].filter(Boolean).join(' · ');
  }

  /** Pages de 5 lignes, comme les sections de /rh/admin. */
  readonly paramPager = new AdminPager(() => this.paramRows(), () => this.paramColumns());

  // ── Mémoire de la section ──────────────────────────────────────────────────
  /** Pays, recherches, tris et pages gardés tant qu'on reste dans l'administration paie (voir `rememberAdminState`). */
  private readonly memory = rememberAdminState('engine-params', {
    paysId: this.paysId, paramSearch: this.paramSearch,
    paramPage: this.paramPager.page, paramSort: this.paramPager.sort,
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
      // « 3 tranches · de 0 % à 35 % » plutôt que le JSON.
      try {
        const rates = (JSON.parse(e.value) as { rate: number }[]).map(b => b.rate);
        const fmt = (n: number) => new Intl.NumberFormat(this.translate.getCurrentLang() === 'en' ? 'en-US' : 'fr-FR',
          { maximumFractionDigits: 4 }).format(n);
        return this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.BRACKETS', {
          count: rates.length, min: fmt(Math.min(...rates)), max: fmt(Math.max(...rates)),
        });
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

  confirmStep(v: EngineParamSetDto, step: CircuitStep): void {
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
    if (k === 'bareme') this.loadBrackets('');
  }

  /** Nouvelle clé : majuscules, sans accents, espaces et tirets en `_` (format exigé par le serveur). */
  keyFromInput(value: unknown): string {
    return this.text(value).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[\s-]+/g, '_').replace(/[^A-Z0-9_.]/g, '').slice(0, 50);
  }

  // ── Barème en tranches ────────────────────────────────────────────────────
  /** Tranches depuis le JSON {min, max, rate} ; vide ou illisible = une tranche à remplir. */
  private loadBrackets(json: string): void {
    let list: { min: number; max: number | null; rate: number }[] = [];
    try { const v = JSON.parse(json || '[]'); if (Array.isArray(v)) list = v; } catch { /* une tranche vide */ }
    this.bracketStart = typeof list[0]?.min === 'number' ? list[0].min : 0;
    this.brackets.set(list.length
      ? list.map((b, i) => ({ upper: i === list.length - 1 || b.max == null ? '' : String(b.max), rate: String(b.rate ?? '') }))
      : [{ upper: '', rate: '' }]);
  }

  /** « De » d'une tranche = « Jusqu'à » de la précédente (début du barème pour la première). */
  bracketFrom(i: number): string {
    const raw = i === 0 ? String(this.bracketStart) : this.brackets()[i - 1].upper;
    const n = Number(raw);
    if (raw === '' || isNaN(n)) return '…';
    return new Intl.NumberFormat(this.translate.getCurrentLang() === 'en' ? 'en-US' : 'fr-FR').format(n);
  }

  bracketError(i: number, field: 'upper' | 'rate'): string | undefined {
    const row = this.brackets()[i];
    if (field === 'rate') {
      return row.rate !== '' && (isNaN(Number(row.rate)) || Number(row.rate) < 0)
        ? this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.ERR_RATE') : undefined;
    }
    if (row.upper === '') return undefined;
    const from = i === 0 ? this.bracketStart : Number(this.brackets()[i - 1].upper);
    return isNaN(Number(row.upper)) || Number(row.upper) <= from
      ? this.t('PAYROLL.ADMIN_HOME.ENGINE_PARAMS.ERR_UPPER') : undefined;
  }

  setBracket(i: number, change: Partial<BracketRow>): void {
    this.brackets.update(list => list.map((r, j) => (j === i ? { ...r, ...change } : r)));
    this.writeBrackets();
  }

  /** Nouvelle tranche en fin de barème : l'ancienne dernière reçoit une limite à saisir. */
  addBracket(): void {
    this.brackets.update(list => [...list, { upper: '', rate: '' }]);
    this.writeBrackets();
  }

  removeBracket(i: number): void {
    this.brackets.update(list => {
      const next = list.filter((_, j) => j !== i);
      if (next.length) next[next.length - 1] = { ...next[next.length - 1], upper: '' };
      return next;
    });
    this.writeBrackets();
  }

  /** JSON {min, max, rate} du barème saisi — vide (donc refusé à l'enregistrement) tant qu'une case manque ou est fausse. */
  private writeBrackets(): void {
    const rows = this.brackets();
    const last = rows.length - 1;
    const complete = rows.every((r, i) => r.rate !== '' && (i === last || r.upper !== ''))
      && rows.every((_, i) => !this.bracketError(i, 'upper') && !this.bracketError(i, 'rate'));
    if (!complete) { this.patch({ value: '' }); return; }
    let min = this.bracketStart;
    const json = rows.map((r, i) => {
      const max = i === last ? null : Number(r.upper);
      const b = { min, max, rate: Number(r.rate) };
      if (max != null) min = max;
      return b;
    });
    this.patch({ value: JSON.stringify(json) });
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
    if (current?.kind === 'bareme') this.loadBrackets(current.value);
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

