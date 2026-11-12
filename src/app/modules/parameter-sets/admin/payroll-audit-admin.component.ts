import { ChangeDetectionStrategy, Component, OnInit, TemplateRef, ViewChild, computed, inject, signal, untracked, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { catchError, of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  DataTableComponent, ModalRef, ModalService, SearchToolbarComponent, SelectComponent,
  type BadgeCell, type FilterField, type FilterResult, type SearchToolbarFilterConfig, type SelectOption,
  type TableColumn, type TableConfig, type TableRow,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, type AuditEntryDto, type PaysDto } from '../../../core/payroll-api.service';
import { dayRange, distinctSorted, inDayRange, pickValue, rangeSeed } from '../../../shared/filter-utils';
import { delegatedSort, tableTools } from '../../../shared/table-tools';
import { ADMIN_SECTION_STYLES, AdminSectionHeaderComponent } from './admin-section-header.component';
import { AdminPager, AdminSpinnerComponent, AdminTableFooterComponent } from './admin-section-kit';
import { rememberAdminState } from './admin-section-state';
import { UserStore } from '../../../core/user.store';
import { PaysNamesService } from '../../../core/pays-names.service';
import {
  actionVariant, computeFieldDiffs, type DisplayEntry, domainVariant, type FieldDiff,
  groupGenericBursts, recordIdentity, tableDomain, tableLabel,
} from './payroll-audit-display.util';

import { flagDataUri } from '../../../shared/country-flags';
/**
 * Section « Journal des modifications » de l'administration paie : qui a changé la
 * configuration de paie d'un collaborateur, et chaque changement de statut d'une avance,
 * pour un pays, du plus récent au plus ancien (`GET /admin/audit`). Le serveur n'inclut que
 * les historiques que l'utilisateur a le droit de lire, et refuse un pays hors de son
 * périmètre. Lecture seule.
 *
 * Les lignes GENERIC (audit_trail brut) passent par payroll-audit-display.util pour devenir
 * lisibles (nom de table, identité de l'enregistrement, détail champ par champ avant/après) --
 * EMPLOYEE_CONFIG/SALARY_ADVANCE restent inchangées, déjà rédigées par le serveur.
 */
@Component({
  selector: 'app-payroll-audit-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe, DatePipe, AdminSectionHeaderComponent, AdminSpinnerComponent, AdminTableFooterComponent,
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
            (sortChange)="pager.onSort($event)" (resetClick)="pager.onSort(null)"
            (rowClick)="onRowClick($event)">
            <ng-template dafCell="at" let-row>
              <span class="ledger-rail" [class.ledger-rail-group]="row['_group']" [style.--rail-color]="railColor(row)">
                {{ row['at'] | date:'short' }}
              </span>
            </ng-template>
          </daf-data-table>
        </div>
        <app-admin-table-footer
          [total]="pager.total()" [page]="pager.current()" [totalPages]="pager.totalPages()"
          [unit]="'PAYROLL.ADMIN_HOME.COUNT.AUDIT' | translate"
          (pageChange)="pager.go($event)" />
      }
    </div>

    <!-- ── Modale détail : métadonnées + champ par champ avant/après (GENERIC) ─────── -->
    <ng-template #detailTpl>
      @if (activeEntry(); as entry) {
        <div class="audit-detail-meta">
          <div><span class="audit-detail-label">{{ 'PAYROLL.ADMIN_HOME.AUDIT.COL_DATE' | translate }}</span>{{ entry.at.slice(0,19).replace('T',' ') }}</div>
          <div><span class="audit-detail-label">{{ 'PAYROLL.ADMIN_HOME.AUDIT.COL_DOMAIN' | translate }}</span>{{ tableDomain(entry.detail ?? '') }}</div>
          <div><span class="audit-detail-label">{{ 'PAYROLL.ADMIN_HOME.AUDIT.COL_DETAIL' | translate }}</span>{{ tableLabel(entry.detail ?? '') }}</div>
          <div><span class="audit-detail-label">{{ 'PAYROLL.ADMIN_HOME.AUDIT.COL_ACTION' | translate }}</span>{{ genericActionLabel(entry.action) }}</div>
          <div><span class="audit-detail-label">{{ 'PAYROLL.ADMIN_HOME.AUDIT.COL_SUBJECT' | translate }}</span>{{ recordIdentity(entry) }}</div>
          <div><span class="audit-detail-label">{{ 'PAYROLL.ADMIN_HOME.AUDIT.COL_ACTOR' | translate }}</span>{{ entry.actorName ?? ('PAYROLL.ADMIN_HOME.AUDIT.ACTOR_SYSTEM' | translate) }}</div>
        </div>

        @if (activeDiff().length === 0) {
          <p class="text-muted">{{ 'PAYROLL.ADMIN_HOME.AUDIT.DETAIL_NO_FIELDS' | translate }}</p>
        } @else {
          <div class="audit-diff-list">
            @for (d of activeDiff(); track d.field) {
              <div class="audit-diff-row">
                <div class="audit-diff-field-name">{{ d.field }}</div>
                @if (d.changed) {
                  <div class="audit-diff-line audit-diff-line-removed"><span class="audit-diff-marker">−</span>{{ d.before }}</div>
                  <div class="audit-diff-line audit-diff-line-added"><span class="audit-diff-marker">+</span>{{ d.after }}</div>
                } @else {
                  <div class="audit-diff-line audit-diff-line-unchanged">{{ d.after }}</div>
                }
              </div>
            }
          </div>
        }
      }
    </ng-template>

    <!-- ── Modale groupe : les entrées derrière une ligne "N modifications groupées" ── -->
    <ng-template #groupTpl>
      @if (activeGroup(); as members) {
        <p class="text-muted">{{ 'PAYROLL.ADMIN_HOME.AUDIT.GROUP_MODAL_HINT' | translate }}</p>
        <table class="audit-diff-table audit-group-members-table">
          <thead>
            <tr>
              <th>{{ 'PAYROLL.ADMIN_HOME.AUDIT.COL_DATE' | translate }}</th>
              <th>{{ 'PAYROLL.ADMIN_HOME.AUDIT.COL_SUBJECT' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (m of members; track m.id) {
              <tr class="audit-group-member-row" (click)="openDetailFromGroup(m)">
                <td>{{ m.at.slice(0,19).replace('T',' ') }}</td>
                <td>{{ recordIdentity(m) }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </ng-template>
  `,
  styles: [ADMIN_SECTION_STYLES, `
    /* ── Ledger rail: a thin coloured spine on the date cell, keyed to the action ── */
    .ledger-rail { position: relative; display: inline-block; padding-left: 0.65rem;
      font-family: ui-monospace, 'Consolas', monospace; font-size: 0.75rem; color: #475569; }
    .ledger-rail::before { content: ''; position: absolute; left: 0; top: 1px; bottom: 1px;
      width: 3px; border-radius: 2px; background: var(--rail-color, #cbd5e1); }
    .ledger-rail-group::before { background-image:
      repeating-linear-gradient(to bottom, var(--rail-color, #cbd5e1) 0 3px, transparent 3px 6px);
      background-color: transparent; }

    .audit-detail-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1.5rem; margin-bottom: 1.25rem; font-size: 0.8rem; }
    .audit-detail-label { display: block; font-size: 0.7rem; font-weight: 600; color: #94a3b8; }

    /* ── Field diff: a version-control-style +/- list, one entry per changed field ── */
    .audit-diff-list { display: flex; flex-direction: column; font-size: 0.8rem; font-family: ui-monospace, 'Consolas', monospace; }
    .audit-diff-row { padding: 0.5rem 0; border-bottom: 1px solid #f1f5f9; }
    .audit-diff-field-name { font-family: -apple-system, sans-serif; font-weight: 600; color: #64748b; font-size: 0.75rem; margin-bottom: 0.25rem; }
    .audit-diff-line { padding: 0.15rem 0.5rem; border-radius: 4px; white-space: pre-wrap; word-break: break-word; }
    .audit-diff-marker { display: inline-block; width: 1.2em; font-weight: 700; }
    .audit-diff-line-removed { background: #fef2f2; color: #991b1b; }
    .audit-diff-line-removed .audit-diff-marker { color: #dc2626; }
    .audit-diff-line-added { background: #f0fdf4; color: #166534; margin-top: 2px; }
    .audit-diff-line-added .audit-diff-marker { color: #16a34a; }
    .audit-diff-line-unchanged { color: #94a3b8; }

    /* Group-members listing keeps the plain table -- it's just two columns, not a field diff. */
    .audit-diff-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .audit-diff-table th { text-align: left; padding: 0.5rem 0.75rem; background: #f8fafc; color: #475569;
      font-weight: 700; font-size: 0.7rem; border-bottom: 1px solid #e2e8f0; }
    .audit-diff-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f1f5f9; vertical-align: top; word-break: break-word; }
    .audit-group-members-table .audit-group-member-row { cursor: pointer; }
    .audit-group-members-table .audit-group-member-row:hover { background: #eff6ff; }
  `],
})
export class PayrollAuditAdminComponent implements OnInit {
  /** Le tableau (absent pendant le chargement / liste vide) — passé au `[table]` de la barre pour
   *  placer réinitialiser + choix des colonnes à droite de Filtres, au lieu d'au-dessus. */
  readonly table = viewChild(DataTableComponent);

  private readonly api       = inject(PayrollApiService);
  private readonly translate = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);
  private readonly userStore = inject(UserStore);
  private readonly modal     = inject(ModalService);

  @ViewChild('detailTpl') detailTpl!: TemplateRef<unknown>;
  @ViewChild('groupTpl') groupTpl!: TemplateRef<unknown>;

  readonly pays    = signal<PaysDto[]>([]);
  readonly paysId  = signal<number | null>(null);
  readonly entries = signal<AuditEntryDto[]>([]);
  readonly loading = signal(false);
  readonly failed  = signal(false);
  readonly search  = signal('');
  readonly filters = signal<FilterResult>({});
  private seq = 0;

  /** La ligne actuellement montrée dans la modale détail/groupe. */
  readonly activeEntry = signal<AuditEntryDto | null>(null);
  readonly activeGroup = signal<AuditEntryDto[] | null>(null);
  private modalRef: ModalRef | null = null;

  readonly tableLabel = tableLabel;
  readonly tableDomain = tableDomain;
  readonly recordIdentity = recordIdentity;

  /** The ledger rail's colour -- same green/blue/red action convention as the badge, restated as
   *  a CSS colour since the rail is a plain border. Neutral grey for EMPLOYEE_CONFIG/SALARY_ADVANCE
   *  rows: this is a structural element, not a recoloured identity, so those stay untouched. */
  railColor(row: TableRow): string {
    const group = row['_group'] as AuditEntryDto[] | undefined;
    if (group) return railActionColor(group[0].action);
    const entry = row['_entry'] as AuditEntryDto | undefined;
    return entry?.source === 'GENERIC' ? railActionColor(entry.action) : '#cbd5e1';
  }

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  genericActionLabel(action: string): string {
    const key = `PAYROLL.ADMIN_HOME.AUDIT.GENERIC_ACTION.${action}`;
    const label = this.t(key);
    return label === key ? action : label;
  }

  ngOnInit(): void {
    this.api.listPayrollPays().pipe(catchError(() => of([] as PaysDto[]))).subscribe(list => {
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

  readonly paysOptions = computed<SelectOption[]>(() =>
    this.pays().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})`, imageUrl: flagDataUri(p.isoCode) })));

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
    if (e.source === 'GENERIC') return this.genericActionLabel(e.action);
    if (e.source === 'EMPLOYEE_CONFIG') return e.action;
    return e.fromStatus
      ? `${this.statusLabel(e.fromStatus)} → ${this.statusLabel(e.action)}`
      : this.t('PAYROLL.ADMIN_HOME.AUDIT.CREATED', { status: this.statusLabel(e.action) });
  }

  private subjectLabel(e: AuditEntryDto): string {
    if (e.source === 'GENERIC') return recordIdentity(e);
    const name = e.subjectName ?? '—';
    return e.source === 'SALARY_ADVANCE' && e.subjectId ? `${name} · AVS-${e.subjectId}` : name;
  }

  /** GENERIC uniquement : regroupe les rafales système (sans acteur) -- voir
   *  payroll-audit-display.util. EMPLOYEE_CONFIG/SALARY_ADVANCE passent inchangés. */
  readonly displayEntries = computed<DisplayEntry[]>(() => groupGenericBursts(this.entries()));

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
    // Amorçage de `daf-filter` (lu une fois), à sa forme interne : un `select` y est un `string[]`.
    initialValues: {
      source: seedSelect(this.filters(), 'source'),
      actor:  seedSelect(this.filters(), 'actor'),
      period: rangeSeed(this.filters()['period']),
    },
  }));

  readonly columns = computed<TableColumn[]>(() => [
    // `type: 'date'`'s own format is replaced by the `dafCell="at"` ledger-rail template above,
    // so the date pipe moved there -- the column still needs no `type` override for that.
    { key: 'at',      label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_DATE'), sortable: true },
    { key: 'domain',  label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_DOMAIN'), type: 'badge', sortable: true },
    { key: 'type',    label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_TYPE'), type: 'badge', sortable: true },
    { key: 'subject', label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_SUBJECT'), sortable: true },
    { key: 'action',  label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_ACTION'), type: 'badge', sortable: true },
    { key: 'detail',  label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_DETAIL'), sortable: true },
    { key: 'actor',   label: this.t('PAYROLL.ADMIN_HOME.AUDIT.COL_ACTOR'), sortable: true },
  ]);

  readonly rows = computed<TableRow[]>(() => {
    const q = this.search().trim().toLowerCase();
    const source = pickValue(this.filters(), 'source');
    const actor = pickValue(this.filters(), 'actor');
    const period = dayRange(this.filters()['period']);
    return this.displayEntries()
      .map((d): TableRow | null => {
        if (d.kind === 'group') {
          // Un lot système n'a pas de source/acteur individuel à filtrer -- il reste visible
          // tant que le filtre Type ne cible pas autre chose que "Modification technique".
          if (source && source !== 'GENERIC') return null;
          if (actor) return null;
          if (!inDayRange(d.at, period)) return null;
          return {
            id: `group-${d.detail}-${d.at}`,
            at: d.at,
            domain: { label: tableDomain(d.detail), options: { variant: domainVariant(tableDomain(d.detail)), size: 'sm' } } satisfies BadgeCell,
            type: { label: this.sourceLabel('GENERIC'), options: { variant: 'neutral', size: 'sm' } } satisfies BadgeCell,
            subject: this.t('PAYROLL.ADMIN_HOME.AUDIT.GROUP_LABEL', { count: d.members.length }),
            action: { label: this.genericActionLabel(d.action), options: { variant: actionVariant(d.action), size: 'sm' } } satisfies BadgeCell,
            detail: tableLabel(d.detail),
            actor: this.t('PAYROLL.ADMIN_HOME.AUDIT.ACTOR_SYSTEM'),
            _group: d.members,
          };
        }
        const e = d.entry;
        if (!(!source || e.source === source) || !(!actor || e.actorName === actor) || !inDayRange(e.at, period)) return null;
        return {
          id: `${e.source}-${e.id}`,
          at: e.at,
          domain: e.source === 'GENERIC'
            ? ({ label: tableDomain(e.detail ?? ''), options: { variant: domainVariant(tableDomain(e.detail ?? '')), size: 'sm' } } satisfies BadgeCell)
            : '—',
          type: {
            label: this.sourceLabel(e.source),
            options: { variant: e.source === 'EMPLOYEE_CONFIG' ? 'info' : e.source === 'SALARY_ADVANCE' ? 'warning' : 'neutral', size: 'sm' },
          } satisfies BadgeCell,
          subject: this.subjectLabel(e),
          action: e.source === 'GENERIC'
            ? ({ label: this.genericActionLabel(e.action), options: { variant: actionVariant(e.action), size: 'sm' } } satisfies BadgeCell)
            : this.actionLabel(e),
          detail: e.source === 'GENERIC' ? tableLabel(e.detail ?? '') : (e.detail || '—'),
          actor: e.actorName ?? (e.actorId ? `#${e.actorId}` : '—'),
          _entry: e,
        };
      })
      .filter((r): r is TableRow => r !== null)
      .filter(r => !q || `${searchable(r['subject'])} ${searchable(r['action'])} ${searchable(r['detail'])} ${searchable(r['domain'])} ${searchable(r['actor'])}`.toLowerCase().includes(q));
  });

  onRowClick(row: TableRow): void {
    const group = row['_group'] as AuditEntryDto[] | undefined;
    if (group) { this.openGroupModal(group); return; }
    const entry = row['_entry'] as AuditEntryDto | undefined;
    if (entry?.source === 'GENERIC') this.openDetailModal(entry);
  }

  openDetailModal(entry: AuditEntryDto): void {
    this.activeEntry.set(entry);
    this.modalRef = this.modal.open({
      resizable: true,
      maximizable: true,
      minWidth: '360px',
      minHeight: '260px',
      title: this.t('PAYROLL.ADMIN_HOME.AUDIT.DETAIL_TITLE'),
      body: this.detailTpl,
      size: 'lg',
      buttons: [{ label: this.t('PAYROLL.COMMON.CLOSE'), variant: 'secondary', action: r => r.close() }],
    });
  }

  openGroupModal(members: AuditEntryDto[]): void {
    this.activeGroup.set(members);
    this.modalRef = this.modal.open({
      resizable: true,
      maximizable: true,
      minWidth: '360px',
      minHeight: '260px',
      title: this.t('PAYROLL.ADMIN_HOME.AUDIT.GROUP_MODAL_TITLE'),
      body: this.groupTpl,
      size: 'lg',
      buttons: [{ label: this.t('PAYROLL.COMMON.CLOSE'), variant: 'secondary', action: r => r.close() }],
    });
  }

  openDetailFromGroup(entry: AuditEntryDto): void {
    this.modalRef?.close();
    this.openDetailModal(entry);
  }

  readonly activeDiff = computed<FieldDiff[]>(() => {
    const entry = this.activeEntry();
    return entry ? computeFieldDiffs(entry) : [];
  });

  /** Pages de 5 lignes, comme les sections de /rh/admin. Le tri porte sur tout le journal,
   *  avant la découpe — du plus récent au plus ancien par défaut. */
  readonly pager = (() => {
    const p = new AdminPager(() => this.rows(), () => this.columns());
    p.sort.set({ key: 'at', dir: 'desc' });
    return p;
  })();

  // ── Mémoire de la section ──────────────────────────────────────────────────
  /** Pays, recherche, filtres, tri et page gardés tant qu'on reste dans l'administration paie (voir `rememberAdminState`). */
  private readonly memory = rememberAdminState('audit', {
    paysId: this.paysId, search: this.search, filters: this.filters, page: this.pager.page, sort: this.pager.sort,
  });

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

/** Amorce d'un `select` de `daf-filter` (`string[]`) depuis le filtre appliqué. */
function seedSelect(applied: FilterResult, name: string): string[] {
  const v = pickValue(applied, name);
  return v ? [v] : [];
}

function railActionColor(action: string): string {
  return action === 'INSERT' ? '#15803d' : action === 'DELETE' ? '#b91c1c' : '#2563eb';
}

/** `domain`/`action` cells hold a plain string for EMPLOYEE_CONFIG/SALARY_ADVANCE rows and a
 *  BadgeCell for GENERIC rows -- the free-text search needs the badge's own label, not
 *  "[object Object]", to still match those columns. */
function searchable(value: unknown): string {
  return value && typeof value === 'object' && 'label' in value ? String((value as BadgeCell).label) : String(value ?? '');
}
