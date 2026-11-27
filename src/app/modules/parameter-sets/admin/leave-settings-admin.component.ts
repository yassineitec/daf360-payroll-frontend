import { ChangeDetectionStrategy, Component, TemplateRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { concat, last } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent, DafCellDirective, DataTableComponent, FormFieldComponent, ModalService, PaginationComponent,
  RadioGroupComponent, SearchToolbarComponent, SectionTitleComponent, SelectComponent, StepperComponent,
  ToggleComponent,
  type BadgeCell, type FilterField, type FilterResult, type ModalRef, type RadioOption, type SearchToolbarFilterConfig,
  type SelectOption, type StepperStep, type TableColumn, type TableConfig, type TableRow,
} from '@khalilrebhiitec/daf360';
import {
  PayrollApiService, type LeaveSettingsDto, type LeaveTypeRuleDto, type OvertimeSettingsDto,
} from '../../../core/payroll-api.service';
import { PAYROLL_LEAVE_SETTINGS_EDIT_PERMISSIONS } from '../../../core/payroll-nav';
import { UserStore } from '../../../core/user.store';
import { pickValue } from '../../../shared/filter-utils';
import { delegatedSort, tableTools } from '../../../shared/table-tools';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from './admin-section-header.component';
import { AdminModalFooterComponent, AdminPager, AdminSpinnerComponent } from './admin-section-kit';
import { rememberAdminState } from './admin-section-state';

type PeriodMode = 'calendar' | 'shifted';

/** Same page sizes and default as the other payroll tables (/payroll/engine-results, …). */
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

/**
 * Section « Absences et période de paie » de l'administration paie (/payroll/admin, V42).
 *
 * Le pays n'est PAS choisi ici : c'est l'entité de la page (drapeaux de la barre ou `?pays=`),
 * comme pour toute l'administration — `paysId` arrive de parameter-sets (`listPaysId()`).
 *
 * Mise en page à plat, sans cartes : en-tête de section, puis deux blocs titrés
 * (`daf-section-title`) :
 *  - « Période de paie » : mois civil ou période décalée (`daf-radio-group`) ; en décalé, le
 *    jour de début (2 à 28, `daf-select`) — le jour de fin en découle (veille du début, champ
 *    grisé) ; une frise des mois précédent / en cours / suivant (`daf-stepper` en tête seule) ;
 *  - « Absences retenues sur le salaire » : recherche, puis les types d'absence configurés dans
 *    RH avec, pour ce pays, un interrupteur (`daf-toggle`) dans le tableau — enregistré au
 *    clic — et la pagination standard (`daf-pagination`, 10 / 20 / 50 / 100, 20 par défaut).
 * Seuls les éléments variables suivent la période ; salaire de base, primes et avances restent
 * sur le mois payé.
 */
@Component({
  selector: 'app-leave-settings-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe, AdminModalFooterComponent, AdminSectionHeaderComponent, AdminSpinnerComponent,
    ButtonComponent, DafCellDirective, DataTableComponent, FormFieldComponent, PaginationComponent,
    RadioGroupComponent, SearchToolbarComponent, SectionTitleComponent, SelectComponent, StepperComponent,
    ToggleComponent,
  ],
  template: `
    <div class="admin-section">
      <app-admin-section-header
        [title]="'PAYROLL.ADMIN_HOME.CARDS.LEAVE_SETTINGS' | translate"
        [subtitle]="subtitle()" />

      @if (!paysId()) {
        <div class="admin-empty"><p>{{ 'PAYROLL.ADMIN_HOME.NO_PAYS' | translate }}</p></div>
      } @else if (loading()) {
        <app-admin-spinner />
      } @else if (loadError()) {
        <div class="admin-error-banner" role="alert">{{ 'PAYROLL.ADMIN_HOME.LOAD_ERROR' | translate }}</div>
      } @else if (settings(); as s) {

        <!-- ── Période de paie ───────────────────────────────────────────── -->
        <section class="ls-block">
          <daf-section-title [title]="'PAYROLL.LEAVE_SETTINGS.PERIOD_TITLE' | translate" />
          <p class="ls-hint">{{ 'PAYROLL.LEAVE_SETTINGS.PERIOD_HINT' | translate }}</p>
          <p class="ls-hint ls-hint--muted">{{ 'PAYROLL.LEAVE_SETTINGS.PERIOD_HELP' | translate }}</p>

          <div class="ls-band">
            <daf-radio-group
              [options]="modeOptions()"
              [selected]="mode()"
              [config]="{ layout: 'horizontal', disabled: !canEdit() }"
              (selectedChange)="onMode($event)" />

            @if (mode() === 'shifted') {
              <div class="ls-days">
                <daf-select
                  [options]="startDayOptions()"
                  [selected]="['' + startDay()]"
                  [config]="{ label: ('PAYROLL.LEAVE_SETTINGS.START_DAY' | translate), required: true, fullWidth: true,
                              disabled: !canEdit(), hint: ('PAYROLL.LEAVE_SETTINGS.START_DAY_HINT' | translate) }"
                  (selectedChange)="onStart($event[0])" />
                <daf-form-field
                  [value]="endDay() ?? ''"
                  [options]="{ type: 'number', align: 'end', fullWidth: true, disabled: true,
                               label: ('PAYROLL.LEAVE_SETTINGS.END_DAY' | translate),
                               hint: ('PAYROLL.LEAVE_SETTINGS.END_DAY_HINT' | translate) }" />
              </div>
            }

            <!-- Frise : mois précédent, en cours (étape active), suivant — avec la période en cours de saisie. -->
            <daf-stepper
              [steps]="timeline()"
              [currentStep]="1"
              [config]="{ chrome: 'header-only', labelDensity: 'quiet',
                          stepperLabel: ('PAYROLL.LEAVE_SETTINGS.TIMELINE_LABEL' | translate) }" />

            @if (periodError()) {
              <div class="admin-error-banner" role="alert">{{ periodError() }}</div>
            }
            @if (canEdit()) {
              <div class="ls-actions">
                <span class="ls-saved">{{ savedPeriodLabel() }}</span>
                @if (periodDirty()) {
                  <daf-button
                    [label]="'PAYROLL.LEAVE_SETTINGS.RESET_PERIOD' | translate"
                    variant="ghost"
                    [options]="{ disabled: saving() }"
                    (onClick)="resetPeriod()" />
                }
                <daf-button
                  [label]="'PAYROLL.LEAVE_SETTINGS.SAVE_PERIOD' | translate"
                  variant="teal"
                  [options]="{ iconStart: 'save', disabled: saving() || !periodDirty() }"
                  (onClick)="savePeriod()" />
              </div>
            }
          </div>
        </section>

        <!-- ── Heures supplémentaires de week-end (V43) ──────────────────── -->
        <section class="ls-block">
          <daf-section-title [title]="'PAYROLL.LEAVE_SETTINGS.OT_TITLE' | translate" />
          <p class="ls-hint">{{ 'PAYROLL.LEAVE_SETTINGS.OT_HINT' | translate }}</p>

          @if (otError()) {
            <div class="admin-error-banner" role="alert">{{ otError() }}</div>
          }
          @if (overtime(); as ot) {
            @if (!ot.hrRead) {
              <div class="admin-error-banner" role="alert">{{ 'PAYROLL.LEAVE_SETTINGS.OT_HR_UNREACHABLE' | translate }}</div>
            }

            <!-- Majoration par jour de week-end du pays -->
            <div class="ls-band">
              <span class="ls-sub">{{ 'PAYROLL.LEAVE_SETTINGS.OT_DAYS_TITLE' | translate }}</span>
              <div class="ls-days">
                @for (d of ot.days; track d.dayOfWeek) {
                  <daf-form-field
                    [value]="dayDraft()[d.dayOfWeek] ?? ''"
                    (valueChange)="onDayPct(d.dayOfWeek, $event)"
                    [options]="{ type: 'number', align: 'end', fullWidth: true, suffixText: '%',
                                 disabled: !canEdit(),
                                 label: dayLabel(d.dayOfWeek),
                                 hint: defaultPctHint() }" />
                }
              </div>
              @if (canEdit()) {
                <div class="ls-actions">
                  <span class="ls-saved">{{ countryCapLabel() }}</span>
                  @if (daysDirty()) {
                    <daf-button
                      [label]="'PAYROLL.LEAVE_SETTINGS.RESET_PERIOD' | translate"
                      variant="ghost"
                      [options]="{ disabled: otSaving() }"
                      (onClick)="resetDays()" />
                  }
                  <daf-button
                    [label]="'PAYROLL.LEAVE_SETTINGS.OT_SAVE_DAYS' | translate"
                    variant="teal"
                    [options]="{ iconStart: 'save', disabled: otSaving() || !daysDirty() }"
                    (onClick)="saveDays()" />
                </div>
              }
            </div>

            <!-- Plafond par rôle (le plafond propre à un collaborateur se règle sur sa fiche paie) -->
            <span class="ls-sub">{{ 'PAYROLL.LEAVE_SETTINGS.OT_ROLES_TITLE' | translate }}</span>
            <p class="ls-hint ls-hint--muted">{{ 'PAYROLL.LEAVE_SETTINGS.OT_ROLES_HINT' | translate }}</p>
            @if (!roleRows().length) {
              <div class="admin-empty"><p>{{ 'PAYROLL.LEAVE_SETTINGS.OT_NO_ROLES' | translate }}</p></div>
            } @else {
              <div class="admin-table-scroll">
                <daf-data-table [columns]="roleColumns()" [rows]="rolePager.rows()" [config]="roleTableConfig()"
                  (sortChange)="rolePager.onSort($event)" (resetClick)="rolePager.onSort(null)" />
              </div>
              <daf-pagination
                [currentPage]="rolePager.current()"
                [totalPages]="rolePager.totalPages()"
                [totalElements]="rolePager.total()"
                [pageSize]="rolePageSize()"
                [pageSizeOptions]="pageSizeOptions"
                [perPageLabel]="'PAYROLL.COMMON.PAGINATION.PER_PAGE' | translate"
                [summaryLabel]="'PAYROLL.COMMON.PAGINATION.SUMMARY' | translate"
                [firstPageLabel]="'PAYROLL.COMMON.PAGINATION.FIRST' | translate"
                [lastPageLabel]="'PAYROLL.COMMON.PAGINATION.LAST' | translate"
                [config]="{ showFirstLast: true }"
                (pageChange)="rolePager.go($event)"
                (pageSizeChange)="onRolePageSize($event)" />
            }
          }
        </section>

        <!-- ── Absences retenues sur le salaire ──────────────────────────── -->
        <section class="ls-block">
          <daf-section-title [title]="'PAYROLL.LEAVE_SETTINGS.TYPES_TITLE' | translate" />
          <p class="ls-hint">{{ 'PAYROLL.LEAVE_SETTINGS.TYPES_HINT' | translate }}</p>
          <p class="ls-hint ls-hint--strong">{{ deductedSummary() }}</p>

          @if (!s.catalogueRead) {
            <div class="admin-error-banner" role="alert">{{ 'PAYROLL.LEAVE_SETTINGS.CATALOGUE_UNREACHABLE' | translate }}</div>
          }

          <div class="admin-toolbar">
            <daf-search-toolbar
              [card]="false"
              [placeholder]="'PAYROLL.LEAVE_SETTINGS.SEARCH' | translate"
              [value]="search()" [debounce]="200" (valueChange)="onSearch($event)"
              [filterFields]="filterFields()"
              [filterConfig]="filterConfig()"
              (filterApply)="onFilters($event)"
              [table]="table() ?? null" />
          </div>

          @if (!rows().length) {
            <div class="admin-empty"><p>{{ (s.leaveTypes.length ? 'PAYROLL.ADMIN_HOME.NO_RESULT' : 'PAYROLL.LEAVE_SETTINGS.EMPTY') | translate }}</p></div>
          } @else {
            <div class="admin-table-scroll">
              <daf-data-table [columns]="columns()" [rows]="pager.rows()" [config]="tableConfig()"
                (sortChange)="pager.onSort($event)" (resetClick)="pager.onSort(null)">
                <!-- Libellé en clair, code RH en petit dessous. -->
                <ng-template [dafCell]="'type'" let-row>
                  <span class="ls-type">
                    <span class="ls-type__label">{{ row['type'] }}</span>
                    <span class="ls-type__code">{{ row['code'] }}</span>
                  </span>
                </ng-template>
                <!-- L'interrupteur : enregistré au clic, pour ce pays seulement. -->
                <ng-template [dafCell]="'deducts'" let-row>
                  <daf-toggle
                    [checked]="row['deductsValue']"
                    [options]="{ label: (row['deductsValue'] ? 'PAYROLL.LEAVE_SETTINGS.DEDUCTED' : 'PAYROLL.LEAVE_SETTINGS.PAID') | translate,
                                 disabled: !canEdit() || saving() }"
                    (checkedChange)="setRule(row['_source'], $event)" />
                </ng-template>
              </daf-data-table>
            </div>

            <!-- Pagination standard de l'application : taille de page au choix. -->
            <daf-pagination
              [currentPage]="pager.current()"
              [totalPages]="pager.totalPages()"
              [totalElements]="pager.total()"
              [pageSize]="pageSize()"
              [pageSizeOptions]="pageSizeOptions"
              [perPageLabel]="'PAYROLL.COMMON.PAGINATION.PER_PAGE' | translate"
              [summaryLabel]="'PAYROLL.COMMON.PAGINATION.SUMMARY' | translate"
              [firstPageLabel]="'PAYROLL.COMMON.PAGINATION.FIRST' | translate"
              [lastPageLabel]="'PAYROLL.COMMON.PAGINATION.LAST' | translate"
              [config]="{ showFirstLast: true }"
              (pageChange)="pager.go($event)"
              (pageSizeChange)="onPageSizeChange($event)" />
          }
          @if (ruleError()) {
            <div class="admin-error-banner" role="alert">{{ ruleError() }}</div>
          }
        </section>
      }
    </div>

    <!-- Pop-up : plafond d'un rôle -->
    <ng-template #roleCapTpl>
      <div class="ls-modal">
        <p class="ls-hint">{{ 'PAYROLL.LEAVE_SETTINGS.OT_ROLE_MODAL_HINT' | translate: { country: countryCapText() } }}</p>
        <daf-form-field
          [value]="roleCapDraft() ?? ''"
          (valueChange)="roleCapDraft.set(toNumber($event))"
          [options]="{ type: 'number', align: 'end', fullWidth: true, suffixText: 'h',
                       label: ('PAYROLL.LEAVE_SETTINGS.OT_CAP_LABEL' | translate),
                       hint: ('PAYROLL.LEAVE_SETTINGS.OT_CAP_HINT' | translate) }" />
        @if (roleCapError()) {
          <div class="admin-error-banner" role="alert">{{ roleCapError() }}</div>
        }
        <app-admin-modal-footer
          [saveLabel]="'PAYROLL.LEAVE_SETTINGS.OT_SAVE' | translate"
          [cancelLabel]="'PAYROLL.LEAVE_SETTINGS.RESET_PERIOD' | translate"
          [saving]="otSaving()"
          (save)="saveRoleCap()"
          (cancel)="roleModal?.close()" />
      </div>
    </ng-template>
  `,
  styles: [ADMIN_SECTION_STYLES, `
    .ls-block { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
    .ls-hint { margin: 0; font-size: 0.8125rem; color: var(--color-on-surface-variant); max-width: 900px; }
    .ls-hint--muted { font-size: 0.75rem; opacity: 0.85; }
    .ls-hint--strong { font-weight: 600; color: var(--color-on-surface); }
    .ls-band { display: flex; flex-direction: column; gap: 18px; padding: 16px 0 4px; }
    .ls-days { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 280px)); gap: 16px; }
    .ls-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .ls-saved { margin-right: auto; font-size: 0.8125rem; color: var(--color-on-surface-variant); }
    .ls-sub { font-size: 0.875rem; font-weight: 600; color: var(--color-on-surface); }
    .ls-modal { display: flex; flex-direction: column; gap: 16px; }
    .ls-type { display: flex; flex-direction: column; gap: 2px; }
    .ls-type__label { font-weight: 600; color: var(--color-on-surface); }
    .ls-type__code { font-size: 0.75rem; color: var(--color-on-surface-variant); font-family: var(--font-mono, monospace); }
  `],
})
export class LeaveSettingsAdminComponent {
  readonly table = viewChild(DataTableComponent);

  /** The page's entity (header flags / `?pays=`), from parameter-sets. */
  readonly paysId = input<number | null>(null);
  /** Its label, shown in the section subtitle. */
  readonly paysLabel = input<string>('');

  private readonly api       = inject(PayrollApiService);
  private readonly translate = inject(TranslateService);
  private readonly userStore = inject(UserStore);

  readonly settings    = signal<LeaveSettingsDto | null>(null);
  readonly loading     = signal(false);
  readonly loadError   = signal(false);
  readonly saving      = signal(false);
  readonly periodError = signal<string | null>(null);
  readonly ruleError   = signal<string | null>(null);

  /** Period being edited: start day 1 = calendar month. */
  readonly startDay = signal<number>(1);
  readonly mode = computed<PeriodMode>(() => (this.startDay() > 1 ? 'shifted' : 'calendar'));
  readonly endDay = computed<number | null>(() => (this.startDay() > 1 ? this.startDay() - 1 : null));

  readonly search  = signal('');
  readonly filters = signal<FilterResult>({});
  readonly pageSize = signal(DEFAULT_PAGE_SIZE);
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;

  readonly canEdit = computed(() =>
    PAYROLL_LEAVE_SETTINGS_EDIT_PERMISSIONS.some(code => this.userStore.hasPermission(code)));

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  private locale(): string {
    return this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
  }

  /** Reload whenever the page's entity changes (flags, `?pays=`). */
  private readonly followPays = effect(() => {
    const id = this.paysId();
    untracked(() => { this.load(id); this.loadOvertime(id); });
  });

  // ── Heures supplémentaires de week-end (V43) ─────────────────────────────

  private readonly modal = inject(ModalService);
  private readonly roleCapTpl = viewChild.required<TemplateRef<unknown>>('roleCapTpl');
  roleModal: ModalRef | null = null;

  readonly overtime = signal<OvertimeSettingsDto | null>(null);
  readonly otError  = signal<string | null>(null);
  readonly otSaving = signal(false);
  /** Majoration typed per weekend day (null = empty field = default). */
  readonly dayDraft = signal<Record<string, number | null>>({});
  readonly roleCapDraft = signal<number | null>(null);
  readonly roleCapError = signal<string | null>(null);
  private editedRole: { roleId: number } | null = null;

  private otSeq = 0;
  private loadOvertime(id: number | null): void {
    const seq = ++this.otSeq;
    this.overtime.set(null);
    this.otError.set(null);
    if (id == null) return;
    this.api.getOvertimeSettings(id).subscribe({
      next: o => { if (seq === this.otSeq) this.applyOvertime(o); },
      error: err => { if (seq === this.otSeq) this.otError.set(errorText(err) ?? this.t('PAYROLL.ADMIN_HOME.LOAD_ERROR')); },
    });
  }

  private applyOvertime(o: OvertimeSettingsDto): void {
    this.overtime.set(o);
    const draft: Record<string, number | null> = {};
    for (const d of o.days) draft[d.dayOfWeek] = d.ownPct;
    this.dayDraft.set(draft);
  }

  toNumber(value: unknown): number | null {
    if (value === '' || value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  dayLabel(dow: string): string {
    const idx = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].indexOf(dow);
    if (idx < 0) return dow;
    const s = new Date(2024, 0, 1 + idx).toLocaleDateString(this.locale(), { weekday: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** « Vide : 75 % (Taux et barèmes) » / « Vide : pas de majoration ». */
  readonly defaultPctHint = computed(() => {
    const d = this.overtime()?.defaultPct;
    return d == null
      ? this.t('PAYROLL.LEAVE_SETTINGS.OT_DEFAULT_NONE')
      : this.t('PAYROLL.LEAVE_SETTINGS.OT_DEFAULT_PCT', { pct: d });
  });

  /** « 8 h (Taux et barèmes) » / « 8 h (par défaut) ». */
  readonly countryCapText = computed(() => {
    const o = this.overtime();
    if (!o) return '';
    return this.t(o.countryCapFromParams ? 'PAYROLL.LEAVE_SETTINGS.OT_COUNTRY_CAP_PARAM' : 'PAYROLL.LEAVE_SETTINGS.OT_COUNTRY_CAP_DEFAULT',
      { hours: o.countryCap });
  });

  readonly countryCapLabel = computed(() =>
    this.t('PAYROLL.LEAVE_SETTINGS.OT_COUNTRY_CAP', { value: this.countryCapText() }));

  onDayPct(day: string, value: unknown): void {
    this.dayDraft.update(d => ({ ...d, [day]: this.toNumber(value) }));
    this.otError.set(null);
  }

  readonly daysDirty = computed(() => {
    const o = this.overtime();
    const draft = this.dayDraft();
    return !!o && o.days.some(d => (draft[d.dayOfWeek] ?? null) !== (d.ownPct ?? null));
  });

  resetDays(): void {
    const o = this.overtime();
    if (o) this.applyOvertime(o);
    this.otError.set(null);
  }

  /** Saves the changed days one after the other; the last answer is the up-to-date view. */
  saveDays(): void {
    const id = this.paysId();
    const o = this.overtime();
    if (id == null || !o || this.otSaving()) return;
    const draft = this.dayDraft();
    const changed = o.days.filter(d => (draft[d.dayOfWeek] ?? null) !== (d.ownPct ?? null));
    const bad = changed.find(d => { const v = draft[d.dayOfWeek]; return v != null && (v < 0 || v > 500); });
    if (bad) { this.otError.set(this.t('PAYROLL.LEAVE_SETTINGS.OT_ERR_PCT')); return; }
    if (!changed.length) return;
    this.otSaving.set(true);
    concat(...changed.map(d => this.api.saveOvertimeDayRate(id, d.dayOfWeek, draft[d.dayOfWeek] ?? null)))
      .pipe(last())
      .subscribe({
        next: view => { this.otSaving.set(false); this.applyOvertime(view); },
        error: err => { this.otSaving.set(false); this.otError.set(errorText(err) ?? this.t('PAYROLL.ADMIN.ERROR')); },
      });
  }

  // Plafond par rôle

  readonly rolePageSize = signal(DEFAULT_PAGE_SIZE);

  readonly roleColumns = computed<TableColumn[]>(() => [
    { key: 'role', label: this.t('PAYROLL.LEAVE_SETTINGS.OT_COL_ROLE'), sortable: true },
    { key: 'cap',  label: this.t('PAYROLL.LEAVE_SETTINGS.OT_COL_CAP'), type: 'badge', sortable: true,
      sortAccessor: row => (row['capValue'] as number | null) ?? -1 },
  ]);

  readonly roleRows = computed<TableRow[]>(() => {
    const o = this.overtime();
    if (!o) return [];
    const en = this.translate.currentLang() === 'en';
    return o.roles.map(r => ({
      role: (en ? r.labelEn : r.labelFr) || r.labelFr,
      cap: {
        label: r.capHours != null
          ? this.t('PAYROLL.LEAVE_SETTINGS.OT_HOURS', { hours: r.capHours })
          : this.t('PAYROLL.LEAVE_SETTINGS.OT_COUNTRY_VALUE', { value: this.countryCapText() }),
        options: { variant: r.capHours != null ? 'info' : 'neutral', size: 'sm' },
      } satisfies BadgeCell,
      capValue: r.capHours,
      _source: r,
    }));
  });

  readonly rolePager = new AdminPager(() => this.roleRows(), () => this.roleColumns(), () => this.rolePageSize());

  onRolePageSize(size: number): void {
    this.rolePageSize.set(size);
    this.rolePager.go(0);
  }

  readonly roleTableConfig = computed<TableConfig>(() => ({
    showHeader: false, hoverable: true,
    ...tableTools(this.translate),
    ...delegatedSort(untracked(this.rolePager.sort)),
    rowId: row => (row['_source'] as { roleId: number }).roleId,
    emptyMessage: this.t('PAYROLL.LEAVE_SETTINGS.OT_NO_ROLES'),
    actions: this.canEdit() ? [
      { id: 'edit', icon: 'edit', tooltip: this.t('PAYROLL.LEAVE_SETTINGS.OT_EDIT_ROLE'),
        onClick: row => this.openRoleCap(row['_source'] as { roleId: number; labelFr: string; labelEn: string; capHours: number | null }) },
    ] : [],
  }));

  openRoleCap(r: { roleId: number; labelFr: string; labelEn: string; capHours: number | null }): void {
    this.editedRole = { roleId: r.roleId };
    this.roleCapDraft.set(r.capHours);
    this.roleCapError.set(null);
    this.roleModal = this.modal.open({
      title: this.t('PAYROLL.LEAVE_SETTINGS.OT_ROLE_MODAL_TITLE', {
        role: (this.translate.currentLang() === 'en' ? r.labelEn : r.labelFr) || r.labelFr,
      }),
      icon: 'schedule',
      body: this.roleCapTpl(),
      size: 'sm',
      closeOnBackdrop: false,
    });
  }

  saveRoleCap(): void {
    const id = this.paysId();
    const role = this.editedRole;
    if (id == null || !role || this.otSaving()) return;
    const hours = this.roleCapDraft();
    if (hours != null && (hours < 0 || hours > 24)) {
      this.roleCapError.set(this.t('PAYROLL.LEAVE_SETTINGS.OT_ERR_CAP'));
      return;
    }
    this.otSaving.set(true);
    this.api.saveOvertimeRoleCap(id, role.roleId, hours).subscribe({
      next: view => { this.otSaving.set(false); this.applyOvertime(view); this.roleModal?.close(); },
      error: err => { this.otSaving.set(false); this.roleCapError.set(errorText(err) ?? this.t('PAYROLL.ADMIN.ERROR')); },
    });
  }

  private loadSeq = 0;
  private load(id: number | null): void {
    const seq = ++this.loadSeq;
    this.settings.set(null);
    this.periodError.set(null);
    this.ruleError.set(null);
    if (id == null) { this.loading.set(false); return; }
    this.loading.set(true);
    this.loadError.set(false);
    this.api.getLeaveSettings(id).subscribe({
      next: s => { if (seq === this.loadSeq) { this.apply(s); this.loading.set(false); } },
      error: () => { if (seq === this.loadSeq) { this.loadError.set(true); this.loading.set(false); } },
    });
  }

  private apply(s: LeaveSettingsDto): void {
    this.settings.set(s);
    this.startDay.set(s.periodStartDay > 1 ? s.periodStartDay : 1);
  }

  readonly subtitle = computed(() => {
    const hint = this.t('PAYROLL.LEAVE_SETTINGS.HINT');
    const pays = this.paysLabel();
    return pays ? this.t('PAYROLL.LEAVE_SETTINGS.SUBTITLE', { pays }) + ' ' + hint : hint;
  });

  // ── Période ───────────────────────────────────────────────────────────────

  private monthName(y: number, m: number): string {
    const s = new Date(y, m, 1).toLocaleDateString(this.locale(), { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** From / to of month m (0-based) of year y with a given start day. */
  private range(y: number, m: number, start: number): { from: Date; to: Date } {
    return start <= 1
      ? { from: new Date(y, m, 1), to: new Date(y, m + 1, 0) }
      : { from: new Date(y, m - 1, start), to: new Date(y, m, start - 1) };
  }

  private dm(d: Date): string {
    return d.toLocaleDateString(this.locale(), { day: '2-digit', month: '2-digit' });
  }

  /** « En vigueur : du 21 au 20 » / « En vigueur : mois civil » — the SAVED setting. */
  readonly savedPeriodLabel = computed(() => {
    const s = this.settings();
    if (!s) return '';
    const value = s.periodStartDay > 1
      ? this.t('PAYROLL.LEAVE_SETTINGS.KPI_SHIFTED', { start: s.periodStartDay, end: s.periodStartDay - 1 })
      : this.t('PAYROLL.LEAVE_SETTINGS.MODE_CALENDAR');
    return this.t('PAYROLL.LEAVE_SETTINGS.IN_FORCE', { value });
  });

  readonly modeOptions = computed<RadioOption[]>(() => [
    { value: 'calendar', label: this.t('PAYROLL.LEAVE_SETTINGS.MODE_CALENDAR'), hint: this.t('PAYROLL.LEAVE_SETTINGS.MODE_CALENDAR_HINT') },
    { value: 'shifted',  label: this.t('PAYROLL.LEAVE_SETTINGS.MODE_SHIFTED'),  hint: this.t('PAYROLL.LEAVE_SETTINGS.MODE_SHIFTED_HINT') },
  ]);

  readonly startDayOptions = computed<SelectOption[]>(() =>
    Array.from({ length: 27 }, (_, i) => i + 2).map(d => ({
      value: String(d), label: this.t('PAYROLL.LEAVE_SETTINGS.DAY_OPTION', { start: d, end: d - 1 }),
    })));

  onMode(value: string): void {
    this.periodError.set(null);
    if (value === 'calendar') this.startDay.set(1);
    else if (this.startDay() <= 1) {
      const saved = this.settings()?.periodStartDay ?? 1;
      this.startDay.set(saved > 1 ? saved : 21);
    }
  }

  onStart(value: string | undefined): void {
    const d = Number(value);
    if (Number.isInteger(d) && d >= 2 && d <= 28) this.startDay.set(d);
    this.periodError.set(null);
  }

  /** Previous, current and next month with the period being edited — the stepper's steps. */
  readonly timeline = computed<StepperStep[]>(() => {
    const start = this.startDay();
    const now = new Date();
    return [-1, 0, 1].map(offset => {
      const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const r = this.range(ref.getFullYear(), ref.getMonth(), start);
      return {
        title: this.monthName(ref.getFullYear(), ref.getMonth()),
        subtitle: this.dm(r.from) + ' → ' + this.dm(r.to),
        icon: offset === 0 ? 'today' : 'calendar_month',
      };
    });
  });

  readonly periodDirty = computed(() => {
    const s = this.settings();
    return !!s && (s.periodStartDay > 1 ? s.periodStartDay : 1) !== this.startDay();
  });

  resetPeriod(): void {
    const s = this.settings();
    if (s) this.startDay.set(s.periodStartDay > 1 ? s.periodStartDay : 1);
    this.periodError.set(null);
  }

  savePeriod(): void {
    const id = this.paysId();
    if (id == null || this.saving()) return;
    const start = this.startDay();
    this.saving.set(true);
    this.periodError.set(null);
    this.api.saveLeavePeriod(id, start, start > 1 ? start - 1 : null).subscribe({
      next: s => { this.saving.set(false); this.apply(s); },
      error: err => { this.saving.set(false); this.periodError.set(errorText(err) ?? this.t('PAYROLL.ADMIN.ERROR')); },
    });
  }

  // ── Types d'absence ───────────────────────────────────────────────────────

  private label(r: LeaveTypeRuleDto): string {
    return (this.translate.currentLang() === 'en' ? r.labelEn : r.labelFr) || r.code;
  }

  /** « 1 type retenu sur 14 » under the block title. */
  readonly deductedSummary = computed(() => {
    const list = this.settings()?.leaveTypes ?? [];
    return this.t('PAYROLL.LEAVE_SETTINGS.DEDUCTED_SUMMARY', {
      count: list.filter(r => r.deductsSalary).length, total: list.length,
    });
  });

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

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => {
    const seed = pickValue(this.filters(), 'deducts');
    return {
      title: this.t('PAYROLL.SALARY_ADVANCES.FILTER.TITLE'),
      triggerLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.TRIGGER'),
      applyLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.APPLY'),
      cancelLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.CANCEL'),
      resetLabel: this.t('PAYROLL.SALARY_ADVANCES.FILTER.RESET'),
      align: 'right',
      initialValues: { deducts: seed ? [seed] : [] },
    };
  });

  /** Search and filters go back to the first page, as on the other payroll lists. */
  onSearch(value: string): void {
    this.search.set(value);
    this.pager.go(0);
  }

  onFilters(value: FilterResult): void {
    this.filters.set(value);
    this.pager.go(0);
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.pager.go(0);
  }

  readonly columns = computed<TableColumn[]>(() => [
    { key: 'type',    label: this.t('PAYROLL.LEAVE_SETTINGS.COL_TYPE'), type: 'custom', sortable: true,
      sortAccessor: row => String(row['type']) },
    { key: 'balance', label: this.t('PAYROLL.LEAVE_SETTINGS.COL_BALANCE'), type: 'badge', sortable: true },
    { key: 'rh',      label: this.t('PAYROLL.LEAVE_SETTINGS.COL_RH'), type: 'badge', sortable: true },
    { key: 'deducts', label: this.t('PAYROLL.LEAVE_SETTINGS.COL_DEDUCTS'), type: 'custom', sortable: true,
      sortAccessor: row => (row['deductsValue'] ? 1 : 0) },
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
        balance: {
          label: r.tracksBalance && r.balanceField
            ? this.t('PAYROLL.LEAVE_SETTINGS.BALANCE_' + r.balanceField.toUpperCase())
            : this.t('PAYROLL.LEAVE_SETTINGS.BALANCE_NONE'),
          options: { variant: r.tracksBalance && r.balanceField ? 'info' : 'neutral', size: 'sm' },
        } satisfies BadgeCell,
        rh: {
          label: this.t(!r.inCatalogue ? 'PAYROLL.LEAVE_SETTINGS.RH_REMOVED'
            : r.active ? 'PAYROLL.LEAVE_SETTINGS.RH_ACTIVE' : 'PAYROLL.LEAVE_SETTINGS.RH_INACTIVE'),
          options: { variant: !r.inCatalogue ? 'danger' : r.active ? 'success' : 'neutral', size: 'sm', dot: true },
        } satisfies BadgeCell,
        deductsValue: r.deductsSalary,
        _source: r,
      }));
  });

  /** Sorted over the whole list, then cut in pages of the chosen size. */
  readonly pager = new AdminPager(() => this.rows(), () => this.columns(), () => this.pageSize());

  private readonly memory = rememberAdminState('leave-settings', {
    search: this.search, filters: this.filters, page: this.pager.page, sort: this.pager.sort,
  });

  readonly tableConfig = computed<TableConfig>(() => ({
    showHeader: false, hoverable: true,
    ...tableTools(this.translate),
    ...delegatedSort(untracked(this.pager.sort)),
    rowId: row => (row['_source'] as LeaveTypeRuleDto).code,
    emptyMessage: this.t('PAYROLL.LEAVE_SETTINGS.EMPTY'),
  }));

  setRule(r: LeaveTypeRuleDto, deducts: boolean): void {
    const id = this.paysId();
    if (id == null || this.saving() || r.deductsSalary === deducts) return;
    this.saving.set(true);
    this.ruleError.set(null);
    this.api.saveLeaveRule(id, r.code, deducts).subscribe({
      next: s => { this.saving.set(false); this.settings.set(s); },
      error: err => {
        this.saving.set(false);
        const message = errorText(err) ?? this.t('PAYROLL.ADMIN.ERROR');
        // The toggle had already moved: reload what is saved, then say why it failed.
        this.load(id);
        this.ruleError.set(message);
      },
    });
  }
}

function errorText(err: unknown): string | null {
  const body = (err as { error?: { detail?: string; message?: string } } | null)?.error;
  return body?.detail ?? body?.message ?? null;
}
