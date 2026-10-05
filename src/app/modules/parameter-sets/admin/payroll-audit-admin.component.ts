import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, untracked, viewChild } from '@angular/core';
import { catchError, of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  DataTableComponent, SearchToolbarComponent, SelectComponent,
  type BadgeCell, type FilterField, type FilterResult, type SearchToolbarFilterConfig, type SelectOption,
  type TableColumn, type TableConfig, type TableRow,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, type AuditEntryDto, type PaysDto } from '../../../core/payroll-api.service';
import { dayRange, distinctSorted, inDayRange, pickValue } from '../../../shared/filter-utils';
import { delegatedSort, tableTools } from '../../../shared/table-tools';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from './admin-section-header.component';
import { AdminPager, AdminSpinnerComponent, AdminTableFooterComponent } from './admin-section-kit';
import { UserStore } from '../../../core/user.store';
import { PaysNamesService } from '../../../core/pays-names.service';

/**
 * Section « Journal des modifications » de l'administration paie : qui a changé la
 * configuration de paie d'un collaborateur, et chaque changement de statut d'une avance,
 * pour un pays, du plus récent au plus ancien (`GET /admin/audit`). Le serveur n'inclut que
 * les historiques que l'utilisateur a le droit de lire, et refuse un pays hors de son
 * périmètre. Lecture seule.
 */
@Component({
  selector: 'app-payroll-audit-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe, AdminSectionHeaderComponent, AdminSpinnerComponent, AdminTableFooterComponent,
    DataTableComponent, SearchToolbarComponent, SelectComponent,
  ],
  // Comme une section de /rh/admin : en-tête (titre, aide, pays + recherche à droite), puis
  // le tableau.
  template: `
    <div class="admin-section">
      <app-admin-section-header
        [title]="'PAYROLL.ADMIN_HOME.CARDS.AUDIT' | translate"
        [subtitle]="'PAYROLL.ADMIN_HOME.AUDIT.HINT' | translate">
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
            [placeholder]="'PAYROLL.ADMIN_HOME.AUDIT.SEARCH' | translate"
            [value]="search()" [debounce]="200" (valueChange)="search.set($event ?? '')"
            [filterFields]="filterFields()"
            [filterConfig]="filterConfig()"
            (filterApply)="filters.set($event)"
            [table]="table() ?? null" />
        </div>
      </app-admin-section-header>

      <!-- Comme les sections RH : indicateur, message centré si vide, sinon tableau paginé. -->
      @if (loading()) {
        <app-admin-spinner />
      } @else if (!rows().length) {
        <div class="admin-empty"><p>{{ emptyKey() | translate }}</p></div>
      } @else {
        <div class="admin-table-scroll">
          <daf-data-table [columns]="columns()" [rows]="pager.rows()" [config]="tableConfig()"
            (sortChange)="pager.onSort($event)" (resetClick)="pager.onSort(null)" />
        </div>
        <app-admin-table-footer
          [total]="pager.total()" [page]="pager.current()" [totalPages]="pager.totalPages()"
          [unit]="'PAYROLL.ADMIN_HOME.COUNT.AUDIT' | translate"
          (pageChange)="pager.go($event)" />
      }
    </div>
  `,
  styles: [ADMIN_SECTION_STYLES],
})
export class PayrollAuditAdminComponent implements OnInit {
  /** Le tableau (absent pendant le chargement / liste vide) — passé au `[table]` de la barre pour
   *  placer réinitialiser + choix des colonnes à droite de Filtres, au lieu d'au-dessus. */
  readonly table = viewChild(DataTableComponent);

  private readonly api       = inject(PayrollApiService);
  private readonly translate = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);
  private readonly userStore = inject(UserStore);

  readonly pays    = signal<PaysDto[]>([]);
  readonly paysId  = signal<number | null>(null);
  readonly entries = signal<AuditEntryDto[]>([]);
  readonly loading = signal(false);
  readonly failed  = signal(false);
  readonly search  = signal('');
  readonly filters = signal<FilterResult>({});
  private seq = 0;

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
    this.pays().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})` })));

  selectPays(raw: string | undefined): void {
    const id = raw ? Number(raw) : null;
    this.paysId.set(id);
    this.entries.set([]);
    this.failed.set(false);
    if (!id) return;
    const current = ++this.seq;
    this.loading.set(true);
    this.api.getAudit(id).subscribe({
      next: list => { if (current === this.seq) { this.entries.set(list); this.loading.set(false); } },
      error: () => { if (current === this.seq) { this.failed.set(true); this.loading.set(false); } },
    });
  }

  private sourceLabel(source: AuditEntryDto['source']): string {
    return this.t(`PAYROLL.ADMIN_HOME.AUDIT.SOURCE.${source}`);
  }

  private statusLabel(status: string | null): string {
    if (!status) return '';
    const key = `PAYROLL.SALARY_ADVANCES.STATUS.${status}`;
    const label = this.t(key);
    return label === key ? status : label;
  }

  private actionLabel(e: AuditEntryDto): string {
    if (e.source === 'EMPLOYEE_CONFIG') return e.action;
    return e.fromStatus
      ? `${this.statusLabel(e.fromStatus)} → ${this.statusLabel(e.action)}`
      : this.t('PAYROLL.ADMIN_HOME.AUDIT.CREATED', { status: this.statusLabel(e.action) });
  }

  private subjectLabel(e: AuditEntryDto): string {
    const name = e.subjectName ?? '—';
    return e.source === 'SALARY_ADVANCE' && e.subjectId ? `${name} · AVS-${e.subjectId}` : name;
  }

  readonly filterFields = computed<FilterField[]>(() => {
    const all = this.t('PAYROLL.ADMIN_HOME.FILTER_ALL');
    const sources = distinctSorted(this.entries().map(e => e.source));
    return [
      {
        name: 'source', label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_TYPE'), type: 'select', placeholder: all,
        options: sources.map(s => ({ value: s, label: this.sourceLabel(s) })),
      },
      {
        name: 'actor', label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_ACTOR'), type: 'select', searchable: true, placeholder: all,
        options: distinctSorted(this.entries().map(e => e.actorName)).map(n => ({ value: n, label: n })),
      },
      { name: 'period', label: this.t('PAYROLL.ADMIN_HOME.AUDIT.FILTER_PERIOD'), type: 'daterange' },
    ];
  });

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.ADMIN_HOME.AUDIT.FILTER_TITLE'),
    triggerLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_TRIGGER'),
    applyLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.ADMIN_HOME.FILTER_RESET'),
    align: 'right',
  }));

  readonly columns = computed<TableColumn[]>(() => [
    { key: 'at',      label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_DATE'), type: 'date', sortable: true,
      format: { dateStyle: 'short', timeStyle: 'short' } },
    { key: 'type',    label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_TYPE'), type: 'badge', sortable: true },
    { key: 'subject', label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_SUBJECT'), sortable: true },
    { key: 'action',  label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_ACTION'), sortable: true },
    { key: 'detail',  label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_DETAIL'), sortable: true },
    { key: 'actor',   label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_ACTOR'), sortable: true },
  ]);

  readonly rows = computed<TableRow[]>(() => {
    const q = this.search().trim().toLowerCase();
    const source = pickValue(this.filters(), 'source');
    const actor = pickValue(this.filters(), 'actor');
    const period = dayRange(this.filters()['period']);
    return this.entries()
      .filter(e => (!source || e.source === source)
        && (!actor || e.actorName === actor)
        && inDayRange(e.at, period))
      .map(e => ({
        id: `${e.source}-${e.id}`,
        at: e.at,
        type: {
          label: this.sourceLabel(e.source),
          options: { variant: e.source === 'EMPLOYEE_CONFIG' ? 'info' : 'warning', size: 'sm' },
        } satisfies BadgeCell,
        subject: this.subjectLabel(e),
        action: this.actionLabel(e),
        detail: e.detail || '—',
        actor: e.actorName ?? (e.actorId ? `#${e.actorId}` : '—'),
      }))
      .filter(r => !q || `${r.subject} ${r.action} ${r.detail} ${r.actor}`.toLowerCase().includes(q));
  });

  /** Pages de 5 lignes, comme les sections de /rh/admin. Le tri porte sur tout le journal,
   *  avant la découpe — du plus récent au plus ancien par défaut. */
  readonly pager = (() => {
    const p = new AdminPager(() => this.rows(), () => this.columns());
    p.sort.set({ key: 'at', dir: 'desc' });
    return p;
  })();

  /** Message de la liste vide : pas de pays, échec, aucun historique, ou filtre sans résultat. */
  readonly emptyKey = computed(() =>
    !this.paysId() ? 'PAYROLL.ADMIN_HOME.AUDIT.NO_PAYS'
      : this.failed() ? 'PAYROLL.ADMIN_HOME.LOAD_ERROR'
      : this.entries().length ? 'PAYROLL.ADMIN_HOME.NO_RESULT'
      : 'PAYROLL.ADMIN_HOME.AUDIT.EMPTY');

  readonly tableConfig = computed<TableConfig>(() => ({
    showHeader: false, hoverable: true,
    ...tableTools(this.translate),
    // La flèche « date décroissante » vient du tri initial du pager (voir son constructeur).
    ...delegatedSort(untracked(this.pager.sort)),
    // Tableau triable : identité de ligne stable (règle de `daf-data-table`), sinon un tri
    // ré-affiche chaque ligne et déplace son état sur celle qui prend sa place.
    rowId: row => row['id'],
    emptyMessage: this.t(
      !this.paysId() ? 'PAYROLL.ADMIN_HOME.AUDIT.NO_PAYS'
        : this.failed() ? 'PAYROLL.ADMIN_HOME.LOAD_ERROR'
        : 'PAYROLL.ADMIN_HOME.AUDIT.EMPTY'),
  }));
}
