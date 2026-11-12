import { Component, TemplateRef, computed, inject, signal, untracked, viewChild } from '@angular/core';
import {
  ButtonComponent, CheckboxComponent, DafCellDirective, DataTableComponent, FilterField, FilterResult,
  FormFieldComponent, ModalRef, SearchToolbarFilterConfig, ModalService, PaginationComponent, SearchToolbarComponent, SelectComponent, SelectOption,
  SortDirection, StatusBadgeComponent, TabItem, TableColumn, TableConfig, TableRow, TabsComponent,
} from '@khalilrebhiitec/daf360';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { GUIDE_PAGES } from '../../../shared/guide/guide-pages';
import { TableSort, toTableSort } from '../../../shared/table-tools';
import { HelpFaqCustomService } from '../../../shared/guide/help-faq-custom.service';
import { HelpFaqEntry, HelpFaqService, SaveHelpFaqRequest } from './help-faq-admin.service';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from './admin-section-header.component';

const PAGE_SIZE = 8;

type Lang = 'fr' | 'en' | 'ar';

/**
 * Administration › Assistant & FAQ — the questions and answers payroll administrators add
 * themselves, on top of the FAQ shipped with the app, for a given page (the same pages as
 * « Aide & guides »). The help assistant answers with them. Ported from the Finance / RH
 * card (same API shape), under the payroll admin section header. French is required; English and Arabic are optional (the screens
 * fall back to French). A question is published (shown) or not; it can be edited,
 * unpublished or deleted.
 *
 * Company-wide: no pays picker effect. Writes need PAYROLL_SUPER_ADMIN (backend `PayrollHelpFaqController`).
 */
@Component({
  selector: 'app-help-faq-admin',
  standalone: true,
  imports: [
    ButtonComponent, CheckboxComponent, DafCellDirective, DataTableComponent, FormFieldComponent,
    PaginationComponent, SearchToolbarComponent, SelectComponent, StatusBadgeComponent, TabsComponent,
    TranslatePipe, AdminSectionHeaderComponent,
  ],
  template: `
    <div class="hfa-wrap">
      <!-- En-tête de section comme les autres sections de l'administration paie. -->
      <app-admin-section-header class="hfa-header"
        [title]="'PAYROLL.ADMIN_HOME.HELP_FAQ.title' | translate"
        [subtitle]="'PAYROLL.ADMIN_HOME.HELP_FAQ.subtitle' | translate:{ count: entries().length }">
        <daf-button
          [label]="'PAYROLL.ADMIN_HOME.HELP_FAQ.new' | translate"
          variant="teal"
          [options]="{ iconStart: 'add' }"
          (onClick)="openAdd()" />
      </app-admin-section-header>

      <daf-search-toolbar class="mb-4 block"
        [placeholder]="'PAYROLL.ADMIN_HOME.HELP_FAQ.search' | translate"
        [value]="searchQuery()"
        [debounce]="200"
        (valueChange)="onSearch($event)"
        [filterFields]="filterFields()"
        [filterConfig]="filterConfig()"
        (filterApply)="applyFilters($event)"
        [table]="table() ?? null" />

      @if (error()) {
        <div class="hfa-error">{{ error() }}</div>
      }

      <!-- Add / edit form, projected into the library modal. -->
      <ng-template #bodyTpl>
        <div class="flex flex-col gap-4">
          <daf-select
            [options]="pageOptions()"
            [selected]="form.pageKey ? [form.pageKey] : []"
            [config]="{ label: ('PAYROLL.ADMIN_HOME.HELP_FAQ.pageLabel' | translate), searchable: true, fullWidth: true }"
            (selectedChange)="form.pageKey = $event[0] ?? ''" />

          <daf-tabs
            variant="pill"
            [tabs]="langTabs()"
            [active]="lang()"
            (activeChange)="lang.set($any($event))"
            [scrollControls]="false"
            [tabsLabel]="'PAYROLL.ADMIN_HOME.HELP_FAQ.languages' | translate"
            idPrefix="hfa-lang" />

          <!-- One pair of fields per language; Arabic is typed right-to-left. -->
          @switch (lang()) {
            @case ('fr') {
              <daf-form-field
                [options]="{ label: ('PAYROLL.ADMIN_HOME.HELP_FAQ.question' | translate) + ' *', maxLength: 300, fullWidth: true,
                             placeholder: ('PAYROLL.ADMIN_HOME.HELP_FAQ.questionPh' | translate) }"
                [value]="form.questionFr" (valueChange)="form.questionFr = $any($event) ?? ''" />
              <daf-form-field
                [options]="{ label: ('PAYROLL.ADMIN_HOME.HELP_FAQ.answer' | translate) + ' *', type: 'textarea', rows: 5, maxLength: 2000, fullWidth: true,
                             placeholder: ('PAYROLL.ADMIN_HOME.HELP_FAQ.answerPh' | translate) }"
                [value]="form.answerFr" (valueChange)="form.answerFr = $any($event) ?? ''" />
            }
            @case ('en') {
              <p class="hfa-hint">{{ 'PAYROLL.ADMIN_HOME.HELP_FAQ.optionalLang' | translate }}</p>
              <daf-form-field
                [options]="{ label: ('PAYROLL.ADMIN_HOME.HELP_FAQ.question' | translate), maxLength: 300, fullWidth: true }"
                [value]="form.questionEn" (valueChange)="form.questionEn = $any($event) ?? ''" />
              <daf-form-field
                [options]="{ label: ('PAYROLL.ADMIN_HOME.HELP_FAQ.answer' | translate), type: 'textarea', rows: 5, maxLength: 2000, fullWidth: true }"
                [value]="form.answerEn" (valueChange)="form.answerEn = $any($event) ?? ''" />
            }
            @case ('ar') {
              <p class="hfa-hint">{{ 'PAYROLL.ADMIN_HOME.HELP_FAQ.optionalLang' | translate }}</p>
              <div dir="rtl" class="flex flex-col gap-4">
                <daf-form-field
                  [options]="{ label: ('PAYROLL.ADMIN_HOME.HELP_FAQ.question' | translate), maxLength: 300, fullWidth: true }"
                  [value]="form.questionAr" (valueChange)="form.questionAr = $any($event) ?? ''" />
                <daf-form-field
                  [options]="{ label: ('PAYROLL.ADMIN_HOME.HELP_FAQ.answer' | translate), type: 'textarea', rows: 5, maxLength: 2000, fullWidth: true }"
                  [value]="form.answerAr" (valueChange)="form.answerAr = $any($event) ?? ''" />
              </div>
            }
          }

          <div class="hfa-row">
            <daf-form-field class="hfa-order"
              [options]="{ label: ('PAYROLL.ADMIN_HOME.HELP_FAQ.order' | translate), type: 'number', fullWidth: true }"
              [value]="form.orderIndex"
              (valueChange)="form.orderIndex = $event === null || $event === '' ? 0 : +$event" />
            <daf-checkbox
              [options]="{ label: ('PAYROLL.ADMIN_HOME.HELP_FAQ.publish' | translate) }"
              [checked]="form.isActive"
              (checkedChange)="form.isActive = $event" />
          </div>
        </div>

        @if (modalError()) {
          <p class="hfa-field-error">{{ modalError() }}</p>
        }
        <div class="hfa-modal-footer">
          <daf-button [label]="'PAYROLL.ADMIN_HOME.HELP_FAQ.cancel' | translate" variant="secondary" (onClick)="modalRef?.close()" />
          <daf-button
            [label]="(saving() ? 'PAYROLL.ADMIN_HOME.HELP_FAQ.saving' : 'PAYROLL.ADMIN_HOME.HELP_FAQ.save') | translate"
            variant="teal"
            [options]="{ disabled: saving(), loading: saving() }"
            (onClick)="save()" />
        </div>
      </ng-template>

      <!-- Delete confirmation. -->
      <ng-template #deleteTpl>
        <p class="text-body-md text-on-surface">{{ 'PAYROLL.ADMIN_HOME.HELP_FAQ.deleteBody' | translate:{ question: deleteTarget()?.questionFr ?? '' } }}</p>
        <div class="hfa-modal-footer">
          <daf-button [label]="'PAYROLL.ADMIN_HOME.HELP_FAQ.cancel' | translate" variant="secondary" (onClick)="modalRef?.close()" />
          <daf-button [label]="'PAYROLL.ADMIN_HOME.HELP_FAQ.delete' | translate" variant="danger"
                      [options]="{ iconStart: 'delete' }" (onClick)="confirmDelete()" />
        </div>
      </ng-template>

      @if (entries().length === 0 && !loading()) {
        <p class="hfa-empty">{{ 'PAYROLL.ADMIN_HOME.HELP_FAQ.empty' | translate }}</p>
      } @else {
        <div class="table-scroll">
          <daf-data-table #table [columns]="columns()" [rows]="rows()" [config]="tableConfig()"
                          (sortChange)="onSortChange($event.key, $event.dir)"
                          (resetClick)="onSortChange('', null)">
            <ng-template dafCell="question" let-row>
              <div class="hfa-q">{{ row['question'] }}</div>
              <div class="hfa-a">{{ row['answer'] }}</div>
            </ng-template>
            <ng-template dafCell="questionEn" let-row>
              @if (row['questionEn']) {
                <div class="hfa-q">{{ row['questionEn'] }}</div>
                <div class="hfa-a">{{ row['answerEn'] }}</div>
              } @else {
                <span class="hfa-missing">{{ 'PAYROLL.ADMIN_HOME.HELP_FAQ.notTranslated' | translate }}</span>
              }
            </ng-template>
            <ng-template dafCell="langs" let-row>
              <div class="flex flex-wrap gap-1">
                @for (l of row['langs']; track l) {
                  <daf-badge [label]="l" [options]="{ variant: 'neutral', size: 'sm' }" />
                }
              </div>
            </ng-template>
            <ng-template dafCell="isActive" let-row>
              <daf-badge
                [label]="(row['isActive'] ? 'PAYROLL.ADMIN_HOME.HELP_FAQ.published' : 'PAYROLL.ADMIN_HOME.HELP_FAQ.unpublished') | translate"
                [options]="{ variant: row['isActive'] ? 'success' : 'neutral', size: 'sm' }" />
            </ng-template>
          </daf-data-table>
        </div>

        @if (filtered().length > 0) {
          <div class="hfa-footer">
            <span class="hfa-count"><strong>{{ filtered().length }}</strong> {{ 'PAYROLL.ADMIN_HOME.HELP_FAQ.word' | translate }}</span>
            @if (totalPages() > 1) {
              <daf-pagination [currentPage]="currentPage()" [totalPages]="totalPages()"
                              [totalElements]="filtered().length" (pageChange)="currentPage.set($event)" />
            }
          </div>
        }
      }
    </div>
  `,
  styles: [ADMIN_SECTION_STYLES, `
    .hfa-wrap   { width:100% }
    .hfa-header { display:block; margin-bottom:20px }
    .hfa-hint   { font-size:var(--text-body-sm);color:var(--color-on-surface-variant);margin:0 }
    .hfa-row    { display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap }
    .hfa-order  { display:block; width:120px }
    .hfa-field-error { font-size:var(--text-body-sm);color:var(--color-danger);margin:8px 0 0 }
    .hfa-modal-footer { display:flex;justify-content:flex-end;gap:12px;margin-top:16px;padding-top:16px;border-top:1px solid var(--color-outline-variant) }
    .hfa-error  { background:var(--color-error-container);border-radius:8px;padding:10px 14px;font-size:var(--text-body-sm);color:var(--color-on-error-container);margin-bottom:14px }
    .hfa-q      { font-size:var(--text-body-sm);font-weight:600;color:var(--color-on-surface) }
    .hfa-a      { font-size:var(--text-body-sm);color:var(--color-on-surface-variant);margin-top:2px;
                  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden }
    .hfa-missing { font-size:var(--text-body-sm);font-style:italic;color:var(--color-outline) }
    .hfa-empty  { font-size:var(--text-body-sm);color:var(--color-outline);text-align:center;padding:24px }
    .hfa-footer { display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px }
    .hfa-count  { font-size:var(--text-body-sm);color:var(--color-on-surface-variant) }
    .table-scroll { overflow-x:auto }
  `],
})
export class HelpFaqAdminComponent {
  private readonly svc       = inject(HelpFaqService);
  /** The assistant's copy of the published questions: refreshed after each change. */
  private readonly assistant = inject(HelpFaqCustomService);
  private readonly translate = inject(TranslateService);
  private readonly modal     = inject(ModalService);
  modalRef?: ModalRef;
  private readonly bodyTpl   = viewChild.required<TemplateRef<unknown>>('bodyTpl');
  private readonly deleteTpl = viewChild.required<TemplateRef<unknown>>('deleteTpl');
  readonly table = viewChild<DataTableComponent>('table');

  readonly entries    = signal<HelpFaqEntry[]>([]);
  readonly loading    = signal(false);
  readonly error      = signal<string | null>(null);
  readonly saving     = signal(false);
  readonly modalError = signal<string | null>(null);
  readonly editTarget   = signal<HelpFaqEntry | null>(null);
  readonly deleteTarget = signal<HelpFaqEntry | null>(null);
  /** Language tab of the form. */
  readonly lang = signal<Lang>('fr');

  form: SaveHelpFaqRequest = emptyForm();

  readonly currentPage = signal(0);
  readonly sort        = signal<TableSort | null>(null);
  readonly searchQuery = signal('');
  /** '' = every page. */
  readonly pageFilter  = signal('');

  constructor() { this.load(); }

  /** Page label by guide key — the same pages as « Aide & guides ». */
  private readonly pageLabels = computed(() => {
    this.translate.currentLang();
    return new Map(GUIDE_PAGES.map(p => [p.guideKey, this.translate.instant(p.labelKey) as string]));
  });

  pageLabel(key: string): string {
    return this.pageLabels().get(key) ?? key;
  }

  readonly pageOptions = computed<SelectOption[]>(() =>
    GUIDE_PAGES.map(p => ({ value: p.guideKey, label: this.pageLabel(p.guideKey), icon: p.icon }))
      .sort((a, b) => a.label.localeCompare(b.label)));


  readonly langTabs = computed<TabItem[]>(() => {
    this.translate.currentLang();
    return [
      { id: 'fr', label: 'Français *' },
      { id: 'en', label: 'English' },
      // Arabe masqué pour l'instant : décommenter pour le réafficher dans le formulaire.
      // { id: 'ar', label: 'العربية' },
    ];
  });

  onSearch(value: string): void {
    if (value === this.searchQuery()) return;
    this.searchQuery.set(value);
    this.currentPage.set(0);
  }

  /** « Filtres » button of the toolbar: the page only. */
  readonly filterFields = computed<FilterField[]>(() => {
    this.translate.currentLang();
    const t = (k: string) => this.translate.instant(k) as string;
    return [{
      name: 'page',
      label: t('PAYROLL.ADMIN_HOME.HELP_FAQ.page'),
      type: 'select',
      searchable: true,
      placeholder: t('PAYROLL.ADMIN_HOME.HELP_FAQ.allPages'),
      options: this.pageOptions().map(o => ({ value: String(o.value), label: o.label })),
    }];
  });

  /** `daf-filter` reads `initialValues` once — the remembered page is restored before. */
  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => {
    this.translate.currentLang();
    const t = (k: string) => this.translate.instant(k) as string;
    return {
      title:        t('PAYROLL.ADMIN_HOME.HELP_FAQ.filters.title'),
      applyLabel:   t('PAYROLL.ADMIN_HOME.HELP_FAQ.filters.apply'),
      cancelLabel:  t('PAYROLL.ADMIN_HOME.HELP_FAQ.cancel'),
      resetLabel:   t('PAYROLL.ADMIN_HOME.HELP_FAQ.filters.reset'),
      triggerLabel: t('PAYROLL.ADMIN_HOME.HELP_FAQ.filters.trigger'),
      align:        'right',
      initialValues: { page: untracked(this.pageFilter) ? [untracked(this.pageFilter)] : [] },
    };
  });

  applyFilters(result: FilterResult): void {
    const v = result['page'];
    this.pageFilter.set(typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '');
    this.currentPage.set(0);
  }

  readonly filtered = computed(() => {
    const page = this.pageFilter();
    const list = page ? this.entries().filter(e => e.pageKey === page) : this.entries();
    return searchRows(list, this.searchQuery(), e => [
      this.pageLabel(e.pageKey), e.questionFr, e.answerFr, e.questionEn, e.answerEn, e.questionAr, e.answerAr,
    ]);
  });

  readonly totalPages = computed(() => Math.ceil(this.filtered().length / PAGE_SIZE));

  private readonly paged = computed(() => {
    const start = this.currentPage() * PAGE_SIZE;
    return sortByColumn(this.filtered(), this.sort(), {
      page:     e => this.pageLabel(e.pageKey),
      question: e => e.questionFr,
      questionEn: e => e.questionEn ?? '',
      order:    e => e.orderIndex,
      isActive: e => (e.isActive ? 1 : 0),
    }).slice(start, start + PAGE_SIZE);
  });

  onSortChange(key: string, dir: SortDirection): void {
    this.sort.set(toTableSort({ key, dir }));
    this.currentPage.set(0);
  }

  readonly columns = computed<TableColumn[]>(() => {
    this.translate.currentLang();
    const t = (k: string) => this.translate.instant(k) as string;
    return [
      { key: 'page',     label: t('PAYROLL.ADMIN_HOME.HELP_FAQ.colPage'), width: '180px', sortable: true },
      { key: 'question', label: t('PAYROLL.ADMIN_HOME.HELP_FAQ.colQuestion'), sortable: true },
      { key: 'questionEn', label: t('PAYROLL.ADMIN_HOME.HELP_FAQ.colQuestionEn'), sortable: true },
      { key: 'langs',    label: t('PAYROLL.ADMIN_HOME.HELP_FAQ.colLangs'), width: '120px' },
      { key: 'order',    label: t('PAYROLL.ADMIN_HOME.HELP_FAQ.colOrder'), align: 'center', width: '80px', sortable: true },
      { key: 'isActive', label: t('PAYROLL.ADMIN_HOME.HELP_FAQ.colStatus'), align: 'center', width: '120px', sortable: true },
    ];
  });

  readonly tableConfig = computed<TableConfig>(() => {
    this.translate.currentLang();
    const t = (k: string) => this.translate.instant(k) as string;
    const sort = untracked(this.sort);
    const src = (row: TableRow) => row['_source'] as HelpFaqEntry;
    return {
      showHeader: false,
      hoverable: true,
      loading: this.loading(),
      emptyMessage: t('PAYROLL.ADMIN_HOME.HELP_FAQ.noMatch'),
      rowId: (row: TableRow) => src(row).id,
      resizableColumns: true,
      columnPicker: true,
      columnPickerLabel: t('PAYROLL.COMMON.TABLE.COLUMN_PICKER'),
      showReset: true,
      resetLabel: t('PAYROLL.COMMON.TABLE.RESET'),
      sortLabel: t('PAYROLL.COMMON.TABLE.SORT_BY'),
      manualSort: true,
      ...(sort ? { defaultSort: sort } : {}),
      actions: [
        { id: 'edit', icon: 'edit', tooltip: t('PAYROLL.ADMIN_HOME.HELP_FAQ.edit'), onClick: (row: TableRow) => this.openEdit(src(row)) },
        { id: 'unpublish', icon: 'toggle_on', tooltip: t('PAYROLL.ADMIN_HOME.HELP_FAQ.unpublish'),
          hidden: (row: TableRow) => !src(row).isActive, onClick: (row: TableRow) => this.toggle(src(row)) },
        { id: 'publish', icon: 'toggle_off', tooltip: t('PAYROLL.ADMIN_HOME.HELP_FAQ.publishAction'),
          hidden: (row: TableRow) => src(row).isActive, onClick: (row: TableRow) => this.toggle(src(row)) },
        { id: 'delete', icon: 'delete', tooltip: t('PAYROLL.ADMIN_HOME.HELP_FAQ.delete'), onClick: (row: TableRow) => this.askDelete(src(row)) },
      ],
    };
  });

  readonly rows = computed<TableRow[]>(() =>
    this.paged().map(e => ({
      page: this.pageLabel(e.pageKey),
      question: e.questionFr,
      answer: e.answerFr,
      questionEn: e.questionEn && e.answerEn ? e.questionEn : '',
      answerEn: e.answerEn ?? '',
      langs: ['FR', ...(e.questionEn && e.answerEn ? ['EN'] : []), ...(e.questionAr && e.answerAr ? ['AR'] : [])],
      order: e.orderIndex,
      isActive: e.isActive,
      _source: e,
    })));

  private loadedOnce = false;

  private load(): void {
    this.loading.set(true);
    if (this.loadedOnce) this.currentPage.set(0);
    this.loadedOnce = true;
    this.svc.list().subscribe({
      next: list => {
        this.entries.set(list);
        this.loading.set(false);
        const last = Math.max(0, this.totalPages() - 1);
        if (this.currentPage() > last) this.currentPage.set(last);
      },
      error: err => { this.error.set(err?.error?.detail ?? this.translate.instant('PAYROLL.ADMIN_HOME.HELP_FAQ.loadError')); this.loading.set(false); },
    });
  }

  openAdd(): void {
    const page = this.pageFilter();
    const max = this.entries().filter(e => !page || e.pageKey === page).reduce((m, e) => Math.max(m, e.orderIndex), 0);
    this.editTarget.set(null);
    this.form = { ...emptyForm(), pageKey: page, orderIndex: max + 1 };
    this.openForm(this.translate.instant('PAYROLL.ADMIN_HOME.HELP_FAQ.newTitle'));
  }

  openEdit(e: HelpFaqEntry): void {
    this.editTarget.set(e);
    this.form = {
      pageKey: e.pageKey, questionFr: e.questionFr, answerFr: e.answerFr,
      questionEn: e.questionEn ?? '', answerEn: e.answerEn ?? '',
      questionAr: e.questionAr ?? '', answerAr: e.answerAr ?? '',
      orderIndex: e.orderIndex, isActive: e.isActive,
    };
    this.openForm(this.translate.instant('PAYROLL.ADMIN_HOME.HELP_FAQ.editTitle'));
  }

  private openForm(title: string): void {
    this.lang.set('fr');
    this.modalError.set(null);
    this.modalRef = this.modal.open({
      minWidth: '360px',
      minHeight: '260px',
      title, icon: 'smart_toy', body: this.bodyTpl(), width: '720px',
      closeOnBackdrop: false, resizable: true, maximizable: true,
    });
  }

  save(): void {
    const f = this.form;
    const t = (k: string) => this.translate.instant(k) as string;
    if (!f.pageKey) { this.modalError.set(t('PAYROLL.ADMIN_HOME.HELP_FAQ.pageRequired')); return; }
    if (!f.questionFr.trim() || !f.answerFr.trim()) {
      this.lang.set('fr');
      this.modalError.set(t('PAYROLL.ADMIN_HOME.HELP_FAQ.frRequired'));
      return;
    }
    // A language is either complete (question AND answer) or empty: half a translation
    // would show an English question with the French answer.
    if (!!f.questionEn.trim() !== !!f.answerEn.trim()) { this.lang.set('en'); this.modalError.set(t('PAYROLL.ADMIN_HOME.HELP_FAQ.pairRequired')); return; }
    if (!!f.questionAr.trim() !== !!f.answerAr.trim()) { this.lang.set('ar'); this.modalError.set(t('PAYROLL.ADMIN_HOME.HELP_FAQ.pairRequired')); return; }

    this.saving.set(true);
    this.modalError.set(null);
    const target = this.editTarget();
    (target ? this.svc.update(target.id, f) : this.svc.create(f)).subscribe({
      next: () => { this.saving.set(false); this.modalRef?.close(); this.load(); this.assistant.reload(); },
      error: err => {
        this.saving.set(false);
        this.modalError.set(err?.error?.detail ?? t('PAYROLL.ADMIN_HOME.HELP_FAQ.saveError'));
      },
    });
  }

  toggle(e: HelpFaqEntry): void {
    this.error.set(null);
    this.svc.setActive(e.id, !e.isActive).subscribe({
      next: updated => {
        this.entries.update(list => list.map(x => (x.id === updated.id ? updated : x)));
        this.assistant.reload();
      },
      error: err => this.error.set(err?.error?.detail ?? this.translate.instant('PAYROLL.ADMIN_HOME.HELP_FAQ.saveError')),
    });
  }

  askDelete(e: HelpFaqEntry): void {
    this.deleteTarget.set(e);
    this.modalRef = this.modal.open({
      resizable: true,
      maximizable: true,
      minWidth: '360px',
      minHeight: '260px',
      title: this.translate.instant('PAYROLL.ADMIN_HOME.HELP_FAQ.deleteTitle'), icon: 'delete', size: 'sm', body: this.deleteTpl(),
    });
  }

  confirmDelete(): void {
    const e = this.deleteTarget();
    this.modalRef?.close();
    if (!e) return;
    this.svc.delete(e.id).subscribe({
      next: () => { this.load(); this.assistant.reload(); },
      error: err => this.error.set(err?.error?.detail ?? this.translate.instant('PAYROLL.ADMIN_HOME.HELP_FAQ.deleteError')),
    });
  }
}

function emptyForm(): SaveHelpFaqRequest {
  return { pageKey: '', questionFr: '', answerFr: '', questionEn: '', answerEn: '', questionAr: '', answerAr: '', orderIndex: 1, isActive: true };
}

/** Sorts the whole filtered list (the table holds one page): empty values last, text « naturally ». */
function sortByColumn<T>(
  items: readonly T[], sort: TableSort | null, values: Record<string, (item: T) => string | number | null | undefined>,
): T[] {
  const value = sort && values[sort.key];
  if (!sort || !value) return [...items];
  const sign = sort.dir === 'asc' ? 1 : -1;
  const isEmpty = (v: unknown) => v === null || v === undefined || v === '';
  return [...items].sort((a, b) => {
    const va = value(a), vb = value(b);
    const ea = isEmpty(va), eb = isEmpty(vb);
    if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1;
    const cmp = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true });
    return cmp * sign;
  });
}

/** Every word of `query` in one of the item's texts — case- and accent-insensitive. */
function searchRows<T>(items: readonly T[], query: string, texts: (item: T) => unknown[]): T[] {
  const norm = (v: string) => v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const words = norm(query.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  return items.filter(item => {
    const hay = norm(texts(item).filter(v => v != null && v !== '').map(String).join(' '));
    return words.every(w => hay.includes(w));
  });
}
