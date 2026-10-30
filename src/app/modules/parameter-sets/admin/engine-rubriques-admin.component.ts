import { ChangeDetectionStrategy, Component, OnInit, TemplateRef, computed, inject, signal, viewChild, untracked } from '@angular/core';
import { catchError, of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent, DafCellDirective, DataTableComponent, FieldMessageComponent, FormFieldComponent, ModalService,
  SearchToolbarComponent, SectionTitleComponent, SelectComponent,
  type BadgeCell, type FilterField, type FilterResult, type ModalRef, type SearchToolbarFilterConfig, type SelectOption,
  type TableColumn, type TableConfig, type TableRow,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, type PaysDto } from '../../../core/payroll-api.service';
import {
  ENGINE_CALC_MODES, PayrollEngineService, type EngineParamSetDto, type EngineRubriqueDefDto, type SaveEngineRubriqueRequest,
} from '../../../core/payroll-engine.service';
import { HrProfileService, type HrContractType } from '../../../core/hr-profile.service';
import { PAYROLL_MANAGE_RUBRIQUES_PERMISSIONS } from '../../../core/payroll-nav';
import { distinctSorted, pickValue } from '../../../shared/filter-utils';
import { delegatedSort, tableTools } from '../../../shared/table-tools';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from './admin-section-header.component';
import {
  AdminModalFooterComponent, AdminPager, AdminSpinnerComponent, AdminTableFooterComponent,
} from './admin-section-kit';
import { rememberAdminState } from './admin-section-state';
import { UserStore } from '../../../core/user.store';
import { PaysNamesService } from '../../../core/pays-names.service';

import { flagDataUri } from '../../../shared/country-flags';

/** Types de ligne connus (`ENGINE_RUN.NATURE.*`) — une valeur ancienne inconnue reste proposée telle quelle. */
const NATURES = ['GAIN', 'RETENUE', 'AVANTAGE', 'INDEMNITE', 'PRIME'];
const STRATES = [1, 2, 3, 4, 5];
/** Sentinelle « aucun » des listes facultatives (plafond, montant de base) — `daf-select` n'a pas d'option vide. */
const NONE = '__none__';

/**
 * Section « Éléments du bulletin » (rubriques du moteur) de l'administration paie : ce que le
 * moteur calcule pour un pays, dans l'ordre du bulletin, actives comme inactives
 * (`GET /admin/engine/rubriques?paysId=`). Liste vide : pays absent du moteur (carte
 * « Pays de paie »).
 *
 * Écrite pour un utilisateur RH / Finance : le tableau dit en clair comment chaque ligne est
 * calculée (« 9,18 % de Salaire de base ») au lieu d'aligner codes, strates et clés ; la
 * pop-up regroupe la saisie en quatre blocs et ne montre que les champs utiles au mode de
 * calcul choisi. Les valeurs techniques se choisissent dans des listes : clés lues dans les
 * versions de « Paramètres du moteur », montant de base parmi les étapes et les rubriques
 * calculées avant, contrats parmi les types RH.
 *
 * Ajout et modification avec `PAYROLL_MANAGE_RUBRIQUES` (ou super-admin), contrôlés côté
 * serveur (mode ↔ clés obligatoires, syntaxe de la formule, code unique) ; sans ce droit, la
 * pop-up s'ouvre en lecture seule. Pas de suppression : une rubrique retirée est désactivée,
 * l'historique des calculs la garde.
 */
@Component({
  selector: 'app-engine-rubriques-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe, AdminModalFooterComponent, AdminSectionHeaderComponent, AdminSpinnerComponent,
    AdminTableFooterComponent, ButtonComponent, DafCellDirective, DataTableComponent, FieldMessageComponent,
    FormFieldComponent, SearchToolbarComponent, SectionTitleComponent, SelectComponent,
  ],
  // Comme une section de /rh/admin : en-tête (titre, aide, bouton vert « Ajouter » à
  // droite ; le pays est en haut de la page), barre de recherche, puis le tableau —
  // modifier (ou voir) : action de ligne.
  template: `
    <div class="admin-section">
      <app-admin-section-header
        [title]="'PAYROLL.ADMIN_HOME.CARDS.RUBRIQUES' | translate"
        [subtitle]="'PAYROLL.ADMIN_HOME.RUBRIQUES.HINT' | translate">
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
      <!-- Le choix du pays est dans l'en-tête de la page (parameter-sets, ligne du fil
           d'Ariane), qui appelle paysOptions() / paysId() / selectPays(). Sous le titre : la
           barre de recherche sur sa carte blanche, toute la largeur — filtre et colonnes à droite. -->
      <daf-search-toolbar
        [card]="true"
        [placeholder]="'PAYROLL.ADMIN_HOME.RUBRIQUES.SEARCH' | translate"
        [value]="search()" [debounce]="200" (valueChange)="search.set($event ?? '')"
        [filterFields]="filterFields()"
        [filterConfig]="filterConfig()"
        (filterApply)="filters.set($event)"
        [table]="table() ?? null" />

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
            (sortChange)="pager.onSort($event)" (resetClick)="pager.onSort(null)">
            <!-- Libellé en clair, code technique en petit dessous (repère des administrateurs). -->
            <ng-template [dafCell]="'element'" let-row>
              <span class="rub-el">
                <span class="rub-el__label">{{ row['element'] }}</span>
                <span class="rub-el__code">{{ row['code'] }}</span>
              </span>
            </ng-template>
          </daf-data-table>
        </div>
        <app-admin-table-footer
          [total]="pager.total()" [page]="pager.current()" [totalPages]="pager.totalPages()"
          [unit]="'PAYROLL.ADMIN_HOME.COUNT.RUBRIQUES' | translate"
          (pageChange)="pager.go($event)" />
      }
    </div>

    <!-- Pop-up : quatre blocs (titres de la lib), seuls les champs utiles au mode choisi. -->
    <ng-template #rubriqueTpl>
      <div class="rub-form">
        @if (!readOnly()) {
          <div class="rub-note rub-note--info" role="note">
            <span class="material-symbols-outlined rub-note__icon" aria-hidden="true">info</span>
            <span>{{ 'PAYROLL.ADMIN_HOME.RUBRIQUES.IMPACT_NOTE' | translate: { pays: paysName() } }}</span>
          </div>
        }

        <!-- ① Identification -->
        <section class="rub-block">
          <daf-section-title [title]="'PAYROLL.ADMIN_HOME.RUBRIQUES.BLOCK_ID' | translate" />
          <div class="rub-form__grid">
            <daf-form-field
              [value]="form().labelFr"
              (valueChange)="onLabelFr($event)"
              [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.LABEL_FR' | translate), required: true, fullWidth: true, disabled: readOnly() }" />
            <daf-form-field
              [value]="form().labelEn ?? ''"
              (valueChange)="patch({ labelEn: text($event) || null })"
              [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.LABEL_EN' | translate), fullWidth: true, disabled: readOnly() }" />
            <daf-form-field
              [value]="form().code"
              (valueChange)="onCode($event)"
              [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_CODE' | translate), placeholder: 'PRIME_TRANSPORT', required: true, fullWidth: true,
                           disabled: readOnly() || editing() !== null,
                           hint: (editing() === null ? 'PAYROLL.ADMIN_HOME.RUBRIQUES.CODE_HINT' : 'PAYROLL.ADMIN_HOME.RUBRIQUES.CODE_LOCKED') | translate }" />
          </div>
        </section>

        <!-- ② Place sur le bulletin -->
        <section class="rub-block">
          <daf-section-title [title]="'PAYROLL.ADMIN_HOME.RUBRIQUES.BLOCK_PLACE' | translate" />
          <div class="rub-form__grid">
            <daf-select
              [options]="natureOptions()"
              [selected]="form().nature ? [form().nature] : []"
              [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_NATURE' | translate), required: true, fullWidth: true, disabled: readOnly() }"
              (selectedChange)="patch({ nature: $event[0] || form().nature })" />
            <daf-select
              [options]="strateOptions()"
              [selected]="['' + form().strate]"
              [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_STRATE' | translate), required: true, fullWidth: true, disabled: readOnly(),
                          hint: ('PAYROLL.ADMIN_HOME.RUBRIQUES.STRATE_HINT' | translate) }"
              (selectedChange)="patch({ strate: +($event[0] || 1) })" />
            <daf-form-field
              [value]="form().displayOrder"
              (valueChange)="patch({ displayOrder: int($event) })"
              [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_ORDER' | translate), type: 'number', align: 'end', fullWidth: true, disabled: readOnly(),
                           hint: ('PAYROLL.ADMIN_HOME.RUBRIQUES.ORDER_HINT' | translate) }" />
            <daf-select
              [options]="periodicityOptions()"
              [selected]="[form().periodicite]"
              [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_PERIODICITY' | translate), fullWidth: true, disabled: readOnly() }"
              (selectedChange)="patch({ periodicite: $event[0] || 'MENSUEL' })" />
          </div>
        </section>

        <!-- ③ Calcul : le mode d'abord, puis seulement ses champs. -->
        <section class="rub-block">
          <daf-section-title [title]="'PAYROLL.ADMIN_HOME.RUBRIQUES.BLOCK_CALC' | translate" />
          <div class="rub-form__grid">
            <daf-select
              [options]="modeOptions()"
              [selected]="[form().modeCalcul]"
              [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_MODE' | translate), required: true, fullWidth: true, disabled: readOnly() }"
              (selectedChange)="patch({ modeCalcul: $event[0] || form().modeCalcul })" />
            @if (showAssiette()) {
              <daf-select
                [options]="assietteOptions()"
                [selected]="[form().assietteCode || NONE]"
                [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.ASSIETTE' | translate), searchable: true, fullWidth: true, disabled: readOnly(),
                            hint: ('PAYROLL.ADMIN_HOME.RUBRIQUES.ASSIETTE_HINT' | translate) }"
                (selectedChange)="patch({ assietteCode: noneToNull($event[0]) })" />
            }
            @if (showTaux()) {
              <daf-select
                [options]="keyOptions(form().paramKeyTaux, false)"
                [selected]="form().paramKeyTaux ? [form().paramKeyTaux!] : []"
                [config]="{ label: tauxLabel(), placeholder: ('PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_PLACEHOLDER' | translate),
                            searchable: true, required: true, fullWidth: true, disabled: readOnly() }"
                (selectedChange)="patch({ paramKeyTaux: noneToNull($event[0]) })" />
            }
            @if (showPlafond()) {
              <daf-select
                [options]="keyOptions(form().paramKeyPlafond, true)"
                [selected]="[form().paramKeyPlafond || NONE]"
                [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_PLAFOND' | translate), searchable: true, fullWidth: true, disabled: readOnly() }"
                (selectedChange)="patch({ paramKeyPlafond: noneToNull($event[0]) })" />
            }
            @if (needsBareme()) {
              <daf-select
                [options]="keyOptions(form().paramKeyBareme, false)"
                [selected]="form().paramKeyBareme ? [form().paramKeyBareme!] : []"
                [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_BAREME' | translate), placeholder: ('PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_PLACEHOLDER' | translate),
                            searchable: true, required: true, fullWidth: true, disabled: readOnly() }"
                (selectedChange)="patch({ paramKeyBareme: noneToNull($event[0]) })" />
            }
          </div>
          @if (needsFormula()) {
            <daf-form-field
              [value]="form().formulaExpression ?? ''"
              (valueChange)="patch({ formulaExpression: text($event) || null })"
              [options]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.FORMULA' | translate), type: 'textarea', rows: 3, fullWidth: true,
                           required: true, placeholder: 'STRATE_1 + STRATE_2 - STRATE_3', disabled: readOnly(),
                           hint: ('PAYROLL.ADMIN_HOME.RUBRIQUES.FORMULA_HINT' | translate) }" />
          }
          <daf-field-message [hint]="modeHint()" />
          @if (showTaux() || needsBareme() || showPlafond()) {
            <daf-field-message [hint]="'PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_HINT' | translate" />
          }
        </section>

        <!-- ④ Application -->
        <section class="rub-block">
          <daf-section-title [title]="'PAYROLL.ADMIN_HOME.RUBRIQUES.BLOCK_APPLY' | translate" />
          <div class="rub-form__grid">
            <daf-select
              [options]="contractOptions()"
              [selected]="selectedContracts()"
              [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_CONTRACTS' | translate), multiple: true, fullWidth: true, disabled: readOnly(),
                          placeholder: ('PAYROLL.ADMIN_HOME.RUBRIQUES.ALL_CONTRACTS' | translate),
                          hint: ('PAYROLL.ADMIN_HOME.RUBRIQUES.CONTRACTS_HINT' | translate) }"
              (selectedChange)="patch({ contractTypeFilter: $event.length ? $event.join(',') : null })" />
            <daf-select
              [options]="yesNoOptions()"
              [selected]="[form().prorataApplicable ? 'yes' : 'no']"
              [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_PRORATA' | translate), fullWidth: true, disabled: readOnly(),
                          hint: ('PAYROLL.ADMIN_HOME.RUBRIQUES.PRORATA_HINT' | translate) }"
              (selectedChange)="patch({ prorataApplicable: $event[0] === 'yes' })" />
            <daf-select
              [options]="stateOptions()"
              [selected]="[form().active ? 'active' : 'inactive']"
              [config]="{ label: ('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_STATE' | translate), fullWidth: true, disabled: readOnly() }"
              (selectedChange)="patch({ active: $event[0] === 'active' })" />
          </div>
          <!-- Désactivation d'une rubrique active : la conséquence est dite avant d'enregistrer,
               et le bouton le rappelle (pas de seconde pop-up par-dessus celle-ci). -->
          @if (deactivating()) {
            <div class="rub-note rub-note--warning" role="status">
              <span class="material-symbols-outlined rub-note__icon" aria-hidden="true">warning</span>
              <span>{{ 'PAYROLL.ADMIN_HOME.RUBRIQUES.DEACTIVATE_NOTE' | translate }}</span>
            </div>
          }
        </section>

        @if (error()) {
          <div class="admin-error-banner" role="alert">{{ error() }}</div>
        }
        @if (readOnly()) {
          <div class="rub-close">
            <daf-button [label]="'PAYROLL.ADMIN_HOME.RUBRIQUES.CLOSE' | translate" variant="secondary" (onClick)="modalRef?.close()" />
          </div>
        } @else {
          <app-admin-modal-footer
            [saveLabel]="(deactivating() ? 'PAYROLL.ADMIN_HOME.RUBRIQUES.SAVE_DEACTIVATE' : 'PAYROLL.ADMIN_HOME.SAVE') | translate"
            [cancelLabel]="'PAYROLL.ADMIN_HOME.CANCEL' | translate"
            [saving]="saving()"
            (save)="submit()"
            (cancel)="modalRef?.close()" />
        }
      </div>
    </ng-template>
  `,
  styles: [ADMIN_SECTION_STYLES, `
    .rub-form { display: flex; flex-direction: column; gap: 20px; }
    .rub-block { display: flex; flex-direction: column; gap: 12px; }
    .rub-form__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .rub-el { display: inline-flex; flex-direction: column; min-width: 0; }
    .rub-el__label { font-weight: 600; color: var(--color-on-surface); }
    .rub-el__code { font-size: 11px; color: var(--color-on-surface-variant); font-family: ui-monospace, monospace; }
    .rub-close { display: flex; justify-content: flex-end; padding-top: 16px; border-top: 1px solid var(--color-outline-variant); }
    /* Bandeaux : mêmes valeurs que les .notice des pages paie (la lib n'a pas d'alerte). */
    .rub-note { display: flex; align-items: flex-start; gap: .5rem; padding: .75rem 1rem; border-radius: .75rem; font-size: 13px; }
    .rub-note__icon { font-size: 18px; flex: 0 0 auto; }
    .rub-note--warning { color: var(--color-warning, #8a5a00);
                         background: color-mix(in srgb, var(--color-warning, #b7791f) 10%, transparent); }
    .rub-note--info { color: var(--color-on-surface-variant, #44474c); background: var(--color-surface-container, #eceef0); }
  `],
})
export class EngineRubriquesAdminComponent implements OnInit {
  /** Le tableau (absent pendant le chargement / liste vide) — passé au `[table]` de la barre pour
   *  placer réinitialiser + choix des colonnes à droite de Filtres, au lieu d'au-dessus. */
  readonly table = viewChild(DataTableComponent);

  private readonly api       = inject(PayrollApiService);
  private readonly engine    = inject(PayrollEngineService);
  private readonly hr        = inject(HrProfileService);
  private readonly translate = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);
  private readonly userStore = inject(UserStore);
  private readonly modal     = inject(ModalService);

  private readonly rubriqueTpl = viewChild.required<TemplateRef<unknown>>('rubriqueTpl');
  modalRef: ModalRef | null = null;

  protected readonly NONE = NONE;

  readonly pays      = signal<PaysDto[]>([]);
  readonly paysId    = signal<number | null>(null);
  readonly rubriques = signal<EngineRubriqueDefDto[]>([]);
  /** Versions de « Paramètres du moteur » du pays — source des clés proposées et de leurs valeurs. */
  readonly paramSets = signal<EngineParamSetDto[]>([]);
  readonly contractTypes = signal<HrContractType[]>([]);
  readonly loading   = signal(false);
  readonly failed    = signal(false);
  readonly saving    = signal(false);
  readonly search    = signal('');
  readonly filters   = signal<FilterResult>({});
  private seq = 0;

  /** Pop-up : la rubrique ouverte (null = ajout), la saisie en cours, lecture seule sans le droit. */
  readonly editing  = signal<EngineRubriqueDefDto | null>(null);
  readonly form     = signal<SaveEngineRubriqueRequest>(blankRubrique());
  readonly error    = signal<string | null>(null);
  readonly readOnly = signal(false);
  /** Le code suit le libellé tant que l'utilisateur ne l'a pas tapé lui-même (création seulement). */
  private codeTouched = false;

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  private numberLocale(): string {
    return this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR';
  }

  ngOnInit(): void {
    this.api.listPays().pipe(catchError(() => of([] as PaysDto[]))).subscribe(list => {
      this.pays.set(list);
      // Pays pré-sélectionné = celui du profil de l'utilisateur connecté (s'il est dans la
      // liste), sinon le seul pays possible ; il reste modifiable dans le select.
      // Le pays restauré par la mémoire de la section passe avant, s'il est toujours proposé.
      const userPaysId = this.userStore.currentUser()?.paysId;
      const restored = this.paysId();
      const initial = list.find(p => p.id === restored)
        ?? list.find(p => p.id === userPaysId) ?? (list.length === 1 ? list[0] : null);
      this.selectPays(initial ? String(initial.id) : undefined);
    });
  }

  /** Droit d'ajouter / modifier (mêmes codes que le serveur). */
  readonly canManage = computed(() =>
    PAYROLL_MANAGE_RUBRIQUES_PERMISSIONS.some(code => this.userStore.hasPermission(code)));

  readonly paysOptions = computed<SelectOption[]>(() =>
    this.pays().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})`, imageUrl: flagDataUri(p.isoCode) })));

  readonly paysName = computed(() => {
    const id = this.paysId();
    const p = this.pays().find(x => x.id === id);
    return id ? this.paysNames.name(id, p?.frenchLabel ?? String(id)) : '';
  });

  // ── Libellés en clair ──────────────────────────────────────────────────────
  /** Type (GAIN/RETENUE/…) → libellé ; un code inconnu s'affiche tel quel. */
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

  /** « Étape 3 · Cotisations sociales » — l'étape (strate) dans l'ordre du bulletin. */
  private strateLabel(n: number): string {
    const key = `PAYROLL.ADMIN_HOME.RUBRIQUES.STEP.${n}`;
    const name = this.t(key);
    return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.STEP_LABEL', { n, label: name === key ? '' : name });
  }

  private periodicityLabel(p: string): string {
    const key = `PAYROLL.ADMIN_HOME.RUBRIQUES.PERIODICITY.${p}`;
    const label = this.t(key);
    return label === key ? p : label;
  }

  /** Nom en clair d'une variable du calcul : total d'étape, brut, ou rubrique du pays.
   *  `short` : le seul nom de l'étape (« Salaire de base »), pour les phrases du tableau. */
  private variableLabel(code: string, short = false): string {
    const strate = /^STRATE_(\d)$/.exec(code);
    if (strate && short) {
      const key = `PAYROLL.ADMIN_HOME.RUBRIQUES.STEP.${strate[1]}`;
      const name = this.t(key);
      return name === key ? code : name;
    }
    if (strate) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.STEP_TOTAL', { label: this.strateLabel(+strate[1]) });
    if (code === 'BRUT') return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.BRUT');
    const r = this.rubriques().find(x => x.code === code);
    return r ? this.rubriqueName(r) : code;
  }

  private rubriqueName(r: EngineRubriqueDefDto): string {
    return (this.translate.currentLang() === 'en' && r.labelEn) || r.labelFr;
  }

  private fmt(n: number): string {
    return new Intl.NumberFormat(this.numberLocale(), { maximumFractionDigits: 4 }).format(n);
  }

  // ── Paramètres du moteur : clés et valeurs ────────────────────────────────
  /** Version de référence des valeurs affichées : l'active, sinon la plus récente. */
  private readonly refParams = computed<Record<string, unknown>>(() => {
    const sets = [...this.paramSets()].sort((a, b) => b.versionNumber - a.versionNumber);
    const ref = sets.find(s => s.status === 'ACTIVE') ?? sets[0];
    return parseParams(ref?.parameters);
  });

  /** Toutes les clés connues, toutes versions confondues (un brouillon peut en ajouter). */
  private readonly allKeys = computed(() => {
    const keys = new Set<string>();
    for (const s of this.paramSets()) Object.keys(parseParams(s.parameters)).forEach(k => keys.add(k));
    return [...keys].sort();
  });

  private keyValueLabel(key: string): string {
    const v = this.refParams()[key];
    if (typeof v === 'number') return `${key} — ${this.fmt(v)}`;
    if (v != null && typeof v === 'object') return `${key} — ${this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_TABLE')}`;
    if (v != null) return `${key} — ${String(v)}`;
    return key;
  }

  /** Clés proposées pour un champ ; la valeur actuelle reste choisissable même absente des paramètres. */
  keyOptions(current: string | null, optional: boolean): SelectOption[] {
    const opts: SelectOption[] = this.allKeys().map(k => ({ value: k, label: this.keyValueLabel(k) }));
    if (current && !this.allKeys().includes(current)) {
      opts.unshift({ value: current, label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_MISSING', { key: current }) });
    }
    if (optional) opts.unshift({ value: NONE, label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.NONE') });
    return opts;
  }

  // ── Options de la pop-up ───────────────────────────────────────────────────
  readonly modeOptions = computed<SelectOption[]>(() =>
    ENGINE_CALC_MODES.map(m => ({ value: m, label: this.modeLabel(m) })));

  readonly natureOptions = computed<SelectOption[]>(() => {
    const current = this.form().nature;
    const codes = current && !NATURES.includes(current) ? [...NATURES, current] : NATURES;
    return codes.map(n => ({ value: n, label: this.natureLabel(n) }));
  });

  readonly strateOptions = computed<SelectOption[]>(() =>
    STRATES.map(s => ({ value: String(s), label: this.strateLabel(s) })));

  readonly periodicityOptions = computed<SelectOption[]>(() => {
    const values = distinctSorted(['MENSUEL', ...this.rubriques().map(r => r.periodicite), this.form().periodicite]);
    return values.map(v => ({ value: v, label: this.periodicityLabel(v) }));
  });

  /** Montant de base : aucun, un total d'étape, le brut, ou une rubrique calculée AVANT celle-ci. */
  readonly assietteOptions = computed<SelectOption[]>(() => {
    const f = this.form();
    const before = this.rubriques()
      .filter(r => r.code !== f.code && r.displayOrder < f.displayOrder)
      .map(r => ({ value: r.code, label: `${this.rubriqueName(r)} (${r.code})` }));
    const opts: SelectOption[] = [
      { value: NONE, label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.NONE') },
      ...STRATES.map(s => ({ value: `STRATE_${s}`, label: this.variableLabel(`STRATE_${s}`) })),
      { value: 'BRUT', label: this.variableLabel('BRUT') },
      ...before,
    ];
    if (f.assietteCode && !opts.some(o => o.value === f.assietteCode)) {
      opts.push({ value: f.assietteCode, label: this.variableLabel(f.assietteCode) });
    }
    return opts;
  });

  readonly contractOptions = computed<SelectOption[]>(() => {
    const en = this.translate.currentLang() === 'en';
    const opts: SelectOption[] = this.contractTypes().map(c => ({ value: c.code, label: (en ? c.labelEn : c.labelFr) || c.code }));
    for (const code of this.selectedContracts()) {
      if (!opts.some(o => o.value === code)) opts.push({ value: code, label: code });
    }
    return opts;
  });

  readonly selectedContracts = computed(() =>
    (this.form().contractTypeFilter ?? '').split(',').map(c => c.trim()).filter(Boolean));

  readonly yesNoOptions = computed<SelectOption[]>(() => [
    { value: 'yes', label: this.t('PAYROLL.ADMIN_HOME.YES') },
    { value: 'no',  label: this.t('PAYROLL.ADMIN_HOME.NO') },
  ]);

  readonly stateOptions = computed<SelectOption[]>(() => [
    { value: 'active',   label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ACTIVE') },
    { value: 'inactive', label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.INACTIVE') },
  ]);

  // Champs obligatoires selon le mode — mêmes règles que le serveur.
  readonly needsTaux    = computed(() => ['TAUX_PCT', 'MONTANT_FIXE', 'NEWTON_RAPHSON'].includes(this.form().modeCalcul));
  readonly needsBareme  = computed(() => ['BAREME_PROGRESSIF', 'ANNUALISE_BAREME'].includes(this.form().modeCalcul));
  readonly needsFormula = computed(() => ['FORMULE', 'NEWTON_RAPHSON'].includes(this.form().modeCalcul));
  readonly needsAssiette = computed(() => ['TAUX_PCT', 'BAREME_PROGRESSIF', 'ANNUALISE_BAREME'].includes(this.form().modeCalcul));
  // Champs montrés selon le mode : une valeur déjà saisie reste visible pour pouvoir la retirer.
  readonly showTaux     = computed(() => this.needsTaux() || !!this.form().paramKeyTaux);
  readonly showPlafond  = computed(() => this.form().modeCalcul === 'TAUX_PCT' || !!this.form().paramKeyPlafond);
  readonly showAssiette = computed(() => this.needsAssiette() || !!this.form().assietteCode);
  /** Ce qu'attend le mode choisi, sous le bloc Calcul. */
  readonly modeHint = computed(() => this.t(`PAYROLL.ADMIN_HOME.RUBRIQUES.MODE_HINT.${this.form().modeCalcul}`));

  readonly tauxLabel = computed(() => this.t(
    this.form().modeCalcul === 'MONTANT_FIXE' ? 'PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_AMOUNT'
      : this.form().modeCalcul === 'NEWTON_RAPHSON' ? 'PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_TARGET'
      : 'PAYROLL.ADMIN_HOME.RUBRIQUES.KEY_TAUX'));

  /** Une rubrique active passée à « Inactive » : bandeau de conséquence + bouton explicite. */
  readonly deactivating = computed(() => !!this.editing()?.active && !this.form().active);

  // ── Chargement ─────────────────────────────────────────────────────────────
  selectPays(raw: string | undefined): void {
    const id = raw ? Number(raw) : null;
    this.paysId.set(id);
    this.rubriques.set([]);
    this.paramSets.set([]);
    this.contractTypes.set([]);
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
    // Compléments de la pop-up et du tableau : leur échec ne bloque rien (listes vides).
    this.engine.listParamSets(id).pipe(catchError(() => of([] as EngineParamSetDto[])))
      .subscribe(sets => { if (current === this.seq) this.paramSets.set(sets); });
    this.hr.getContractTypes(id).pipe(catchError(() => of([] as HrContractType[])))
      .subscribe(types => { if (current === this.seq) this.contractTypes.set(types); });
  }

  // ── Tableau ────────────────────────────────────────────────────────────────
  readonly filterFields = computed<FilterField[]>(() => {
    const all = this.t('PAYROLL.ADMIN_HOME.FILTER_ALL');
    const list = this.rubriques();
    const select = (name: string, labelKey: string, values: (string | number)[], label = (v: string) => v): FilterField => ({
      name, label: this.t(labelKey), type: 'select', placeholder: all,
      options: distinctSorted(values).map(v => ({ value: String(v), label: label(String(v)) })),
    });
    return [
      { name: 'state', label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_STATE'), type: 'select', placeholder: all, options: this.stateOptions() },
      select('nature', 'PAYROLL.ADMIN_HOME.RUBRIQUES.COL_NATURE', list.map(r => r.nature), n => this.natureLabel(n)),
      select('strate', 'PAYROLL.ADMIN_HOME.RUBRIQUES.COL_STRATE', list.map(r => r.strate), s => this.strateLabel(+s)),
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
    // Amorçage de `daf-filter` (lu une fois), à sa forme interne : un `select` y est un `string[]`.
    initialValues: {
      state:   seedSelect(this.filters(), 'state'),
      strate:  seedSelect(this.filters(), 'strate'),
      nature:  seedSelect(this.filters(), 'nature'),
      mode:    seedSelect(this.filters(), 'mode'),
      prorata: this.filters()['prorata'] === true,
    },
  }));

  /** Six colonnes lisibles ; étape, clés et périodicité sont dans la pop-up. */
  readonly columns = computed<TableColumn[]>(() => [
    { key: 'order',     label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_ORDER'), type: 'number', width: '80px', sortable: true },
    { key: 'element',   label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_ELEMENT'), type: 'custom', sortable: true },
    { key: 'nature',    label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_NATURE'), type: 'badge', sortable: true },
    { key: 'calc',      label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_CALC'), sortable: true },
    { key: 'contracts', label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_CONTRACTS'), sortable: true },
    { key: 'state',     label: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.COL_STATE'), type: 'badge', sortable: true },
  ]);

  /** « 9,18 % de Salaire de base », « Montant fixe : 1 200 », « = Étape 1 + … » — le calcul en une phrase. */
  private calcText(r: EngineRubriqueDefDto): string {
    const base = r.assietteCode ? this.variableLabel(r.assietteCode, true) : null;
    const value = r.paramKeyTaux ? this.refParams()[r.paramKeyTaux] : undefined;
    const P = 'PAYROLL.ADMIN_HOME.RUBRIQUES.CALC.';
    switch (r.modeCalcul) {
      case 'TAUX_PCT': {
        const rate = typeof value === 'number' ? `${this.fmt(value)} %` : (r.paramKeyTaux ?? '?');
        const text = this.t(base ? `${P}RATE_OF` : `${P}RATE`, { rate, base });
        return r.paramKeyPlafond ? `${text}${this.t(`${P}CAPPED`)}` : text;
      }
      case 'MONTANT_FIXE':
        return typeof value === 'number' ? this.t(`${P}FIXED_VALUE`, { value: this.fmt(value) }) : this.t(`${P}FIXED`);
      case 'BAREME_PROGRESSIF': return this.t(`${P}SCALE`, { base: base ?? '—' });
      case 'ANNUALISE_BAREME':  return this.t(`${P}SCALE_ANNUAL`, { base: base ?? '—' });
      case 'FORMULE':           return r.formulaExpression ? `= ${this.humanFormula(r.formulaExpression)}` : this.modeLabel(r.modeCalcul);
      default:                  return this.modeLabel(r.modeCalcul);
    }
  }

  /** Formule lisible : chaque variable (STRATE_n, BRUT, code de rubrique) remplacée par son nom. */
  private humanFormula(expr: string): string {
    return expr.replace(/\b[A-Z][A-Z0-9_]*\b/g, code => this.variableLabel(code, true))
      .replace(/\s-\s/g, ' − ');
  }

  private contractsText(r: EngineRubriqueDefDto): string {
    if (!r.contractTypeFilter) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ALL_CONTRACTS');
    const en = this.translate.currentLang() === 'en';
    return r.contractTypeFilter.split(',').map(c => c.trim()).filter(Boolean).map(code => {
      const t = this.contractTypes().find(x => x.code.toUpperCase() === code.toUpperCase());
      return t ? ((en ? t.labelEn : t.labelFr) || code) : code;
    }).join(', ');
  }

  readonly rows = computed<TableRow[]>(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filters();
    const state = pickValue(f, 'state');
    const strate = pickValue(f, 'strate');
    const nature = pickValue(f, 'nature');
    const mode = pickValue(f, 'mode');
    const prorataOnly = f['prorata'] === true;
    return this.rubriques()
      .filter(r => (!state || r.active === (state === 'active'))
        && (!strate || String(r.strate) === strate)
        && (!nature || r.nature === nature)
        && (!mode || r.modeCalcul === mode)
        && (!prorataOnly || r.prorataApplicable))
      .map(r => ({
        id: r.id,
        order: r.displayOrder,
        element: this.rubriqueName(r),
        code: r.code,
        nature: { label: this.natureLabel(r.nature), options: { variant: 'neutral', size: 'sm' } } satisfies BadgeCell,
        calc: this.calcText(r),
        contracts: this.contractsText(r),
        state: {
          label: this.t(r.active ? 'PAYROLL.ADMIN_HOME.RUBRIQUES.ACTIVE' : 'PAYROLL.ADMIN_HOME.RUBRIQUES.INACTIVE'),
          options: { variant: r.active ? 'success' : 'neutral', size: 'sm', dot: true },
        } satisfies BadgeCell,
        _source: r,
      }))
      // Recherche sur ce qui est affiché : libellé, code, calcul en clair, contrats.
      .filter(row => !q || `${row.element} ${row.code} ${row._source.labelEn ?? ''} ${row.calc} ${row.contracts}`
        .toLowerCase().includes(q));
  });

  /** Pages de 5 lignes, comme les sections de /rh/admin. */
  readonly pager = new AdminPager(() => this.rows(), () => this.columns());

  // ── Mémoire de la section ──────────────────────────────────────────────────
  /** Pays, recherche, filtres, tri et page gardés tant qu'on reste dans l'administration paie (voir `rememberAdminState`). */
  private readonly memory = rememberAdminState('rubriques', {
    paysId: this.paysId, search: this.search, filters: this.filters, page: this.pager.page, sort: this.pager.sort,
  });

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
    // Sans le droit de modifier : la même pop-up, en lecture seule.
    actions: [this.canManage()
      ? { id: 'edit', icon: 'edit', tooltip: this.t('PAYROLL.ADMIN_HOME.EDIT'),
          onClick: row => this.openRubrique(row['_source'] as EngineRubriqueDefDto) }
      : { id: 'view', icon: 'visibility', tooltip: this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.VIEW'),
          onClick: row => this.openRubrique(row['_source'] as EngineRubriqueDefDto) }],
  }));

  // ── Saisie ────────────────────────────────────────────────────────────────
  text(value: unknown): string {
    return (value ?? '').toString().trim();
  }

  int(value: unknown): number {
    const n = Math.trunc(Number(value));
    return isNaN(n) ? 0 : n;
  }

  noneToNull(value: string | undefined): string | null {
    return !value || value === NONE ? null : value;
  }

  patch(change: Partial<SaveEngineRubriqueRequest>): void {
    this.form.update(f => ({ ...f, ...change }));
  }

  /** Libellé français ; à la création, le code le suit tant qu'il n'a pas été tapé à la main. */
  onLabelFr(value: unknown): void {
    const labelFr = this.text(value);
    this.patch(this.editing() === null && !this.codeTouched ? { labelFr, code: codeFromLabel(labelFr) } : { labelFr });
  }

  onCode(value: unknown): void {
    this.codeTouched = true;
    this.patch({ code: this.text(value).toUpperCase() });
  }

  openRubrique(r: EngineRubriqueDefDto | null): void {
    this.editing.set(r);
    this.readOnly.set(!this.canManage());
    this.codeTouched = false;
    const next = (this.rubriques().reduce((max, x) => Math.max(max, x.displayOrder), 0) || 0) + 10;
    this.form.set(r ? toRequest(r) : { ...blankRubrique(), displayOrder: next });
    this.error.set(null);
    this.modalRef = this.modal.open({
      title: r
        ? this.t(this.readOnly() ? 'PAYROLL.ADMIN_HOME.RUBRIQUES.VIEW_TITLE' : 'PAYROLL.ADMIN_HOME.RUBRIQUES.EDIT_TITLE',
            { label: this.rubriqueName(r) })
        : this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ADD'),
      subtitle: r ? r.code : undefined,
      icon: 'receipt_long',
      body: this.rubriqueTpl(),
      size: 'lg',
      closeOnBackdrop: this.readOnly(),
    });
  }

  /** Contrôles du serveur repris ici, pour un message avant l'envoi. */
  private validate(f: SaveEngineRubriqueRequest): string | null {
    if (!f.labelFr) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_LABEL');
    if (this.editing() === null && !/^[A-Z0-9_]{1,20}$/.test(f.code)) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_CODE');
    if (this.editing() === null && this.rubriques().some(r => r.code === f.code))
      return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_DUPLICATE', { code: f.code });
    if (!f.nature) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_NATURE');
    if (this.needsAssiette() && !f.assietteCode) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_ASSIETTE');
    if (this.needsTaux() && !f.paramKeyTaux) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_TAUX');
    if (this.needsBareme() && !f.paramKeyBareme) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_BAREME');
    if (this.needsFormula() && !f.formulaExpression) return this.t('PAYROLL.ADMIN_HOME.RUBRIQUES.ERR_FORMULA');
    return null;
  }

  submit(): void {
    if (this.saving() || this.readOnly()) return;
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

/** Amorce d'un `select` de `daf-filter` (`string[]`) depuis le filtre appliqué. */
function seedSelect(applied: FilterResult, name: string): string[] {
  const v = pickValue(applied, name);
  return v ? [v] : [];
}

/** JSON des paramètres d'une version (objet clé → valeur) ; illisible = vide. */
function parseParams(json: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(json || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** « Prime de transport » → `PRIME_DE_TRANSPORT` : sans accents, majuscules, `_`, 20 caractères. */
function codeFromLabel(label: string): string {
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20).replace(/_+$/, '');
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
    code: '', labelFr: '', labelEn: null, strate: 1, nature: 'GAIN', modeCalcul: 'MONTANT_FIXE', assietteCode: null,
    paramKeyTaux: null, paramKeyPlafond: null, paramKeyBareme: null, formulaExpression: null,
    contractTypeFilter: null, periodicite: 'MENSUEL', prorataApplicable: false, displayOrder: 0, active: true,
  };
}
