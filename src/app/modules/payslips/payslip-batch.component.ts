import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';

import {
  ButtonComponent,
  CardComponent,
  DafCellDirective,
  DataTableComponent,
  FileUploadComponent,
  LoadingComponent,
  MetricCardComponent,
  ModalService,
  PageComponent,
  PageHeaderComponent,
  SearchToolbarComponent,
  SelectComponent,
  StatusBadgeComponent,
  type BadgeVariant,
  type BreadcrumbItem,
  type FilterField,
  type FilterResult,
  type SearchToolbarFilterConfig,
  type ModalRef,
  type SelectOption,
  type TableColumn,
  type TableRow,
  type UploadedFile,
} from '@khalilrebhiitec/daf360';
import { NotificationService } from '../../core/notification.service';
import { PayrollApiService, PaysDto } from '../../core/payroll-api.service';
import { PayslipBatchResult, PayslipBatchService, PayslipPageStatus } from '../../core/payslip-batch.service';
import { dayRange, distinctSorted, inDayRange, pickValue, rangeSeed } from '../../shared/filter-utils';
import { searchTableRows, tableTools } from '../../shared/table-tools';
import { PaysNamesService } from '../../core/pays-names.service';

const MONTH_KEYS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

/** localStorage key of the recent-imports log — see {@link PayslipBatchComponent.history}. */
const HISTORY_KEY = 'daf360.payroll.payslips.history';
const HISTORY_MAX = 20;
const MAX_SIZE_MB = 50;

/** One processed batch, as kept in the recent-imports log. */
interface PayslipHistoryEntry {
  id: string;
  processedAt: string;   // ISO
  paysId: number;
  paysLabel: string;
  paysIso: string;
  periodYear: number;
  periodMonth: number;
  fileName: string;
  result: PayslipBatchResult;
}

type HistoryStatusFilter = 'ALL' | 'SUCCESS' | 'PARTIAL';

/** Clé de période triable `YYYY-MM` — valeur du filtre « Période » de l'historique. */
function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * `/payroll/payslips` — upload the monthly multi-page payslip PDF (one employee per page,
 * from the external payroll system) and get back a per-page report: which pages matched an
 * employee by "Matricule" and were filed to SharePoint, and which need manual attention
 * (UNIDENTIFIED = no matricule found on the page, ERROR = matricule not in our data,
 * DUPLICATE = matricule seen twice in this same file).
 *
 * Layout: one full-width import card (period row → file → action bar), then the report of
 * the batch just processed, then the recent-imports log.
 *
 * The processing itself runs entirely on daf360-rh-service (see PayslipBatchService). That
 * service keeps no batch history, so the recent-imports log is kept client-side (this
 * browser only, last {@link HISTORY_MAX} batches) — enough to reopen a report after a
 * reload, not an audit trail.
 *
 * Built entirely from the `@khalilrebhiitec/daf360` library.
 */
@Component({
  selector: 'app-payslip-batch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    ButtonComponent, CardComponent, DafCellDirective, DataTableComponent, FileUploadComponent,
    MetricCardComponent, PageComponent, PageHeaderComponent,
    LoadingComponent, SearchToolbarComponent, SelectComponent, StatusBadgeComponent,
  ],
  templateUrl: './payslip-batch.component.html',
  styleUrl: './payslip-batch.component.scss',
})
export class PayslipBatchComponent implements OnInit {
  private readonly svc          = inject(PayslipBatchService);
  private readonly payrollApi   = inject(PayrollApiService);
  private readonly notification = inject(NotificationService);
  private readonly modalService = inject(ModalService);
  protected readonly translate  = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);

  /** Pop-up d'attente pendant le traitement — `ModalService` de la lib, corps =
   *  `#processingTpl` (un `daf-loading`). Le backend traite tout le lot en UNE requête
   *  et ne renvoie aucun avancement : c'est donc un indicateur d'attente, pas une barre
   *  de progression en %. Fermé dès que la réponse (ou l'erreur) arrive. */
  private readonly processingTpl = viewChild<TemplateRef<unknown>>('processingTpl');
  private processingModalRef: ModalRef | null = null;
  /** Nombre de fiches du lot en cours, figé à l'envoi (le fichier est retiré ensuite). */
  readonly processingPages = signal<number | null>(null);

  constructor() {
    // Le pop-up vit sous la racine de l'appli, hors de cette vue : on le ferme si
    // l'utilisateur quitte la page pendant le traitement.
    inject(DestroyRef).onDestroy(() => this.closeProcessingModal());
  }

  /** Même pattern que les autres pages : traduction synchrone pour ce qui ne passe pas
   *  par le pipe `| translate` du template. */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.PAYSLIPS.BREADCRUMB') },
  ]);

  // ── Pays : `daf-select`, liste chargée une fois.
  private readonly paysList = signal<PaysDto[]>([]);
  readonly paysId = signal<number | null>(null);
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})` })),
  );

  // First-load gate for `daf-page [loading]` — the pays dropdown is unusable until this
  // resolves. Kept separate from `processing`, which must never swap the whole page for
  // the skeleton.
  readonly loading = signal(false);

  ngOnInit(): void {
    this.history.set(this.readHistory());
    this.loading.set(true);
    this.payrollApi.listPays().subscribe({
      next: list => { this.paysList.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  readonly periodYear  = signal(new Date().getFullYear());
  readonly periodMonth = signal(new Date().getMonth() + 1);

  readonly monthOptions = computed<SelectOption[]>(() => {
    this.translate.currentLang();
    return MONTH_KEYS.map((key, i) => ({
      value: String(i + 1),
      label: this.t(`PAYROLL.PAYSLIPS.MONTHS.${key}`),
    }));
  });

  /** A handful of recent years covers the payroll batches this page actually processes
   *  (current + catch-up filing). */
  readonly yearOptions = computed<SelectOption[]>(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => current - i)
      .map(y => ({ value: String(y), label: String(y) }));
  });

  // ── Fichier ──────────────────────────────────────────────────────────────
  readonly uploadedFiles = signal<UploadedFile[]>([]);
  readonly processing    = signal(false);
  readonly result        = signal<PayslipBatchResult | null>(null);
  /** Which batch `result` belongs to — the file card and the report header both name it. */
  readonly resultFileName = signal<string | null>(null);

  readonly maxSizeMb = MAX_SIZE_MB;
  readonly selectedFile = computed(() => this.uploadedFiles()[0] ?? null);

  /** Page count read from the PDF itself before upload, `null` when it can't be read
   *  (compressed object streams hide the page objects from a plain text scan). Only a
   *  preview for the file card and the submit label — the server's count is the truth. */
  readonly detectedPages = signal<number | null>(null);

  onFilesChange(files: UploadedFile[]): void {
    this.uploadedFiles.set(files);
    this.detectedPages.set(null);
    const f = files[0];
    if (!f || f.error) return;
    f.file.text()
      .then(text => {
        if (this.uploadedFiles()[0] !== f) return;   // replaced meanwhile
        const count = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
        this.detectedPages.set(count > 0 ? count : null);
      })
      .catch(() => { /* preview only */ });
  }

  /** « Remplacer le fichier » — the hidden picker behind that button. Same shape and
   *  size check as `daf-file-upload`, so the rest of the page can't tell them apart. */
  onReplacePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.onFilesChange([{
      name: file.name, size: file.size, type: file.type, file,
      error: file.size > MAX_SIZE_MB * 1024 * 1024 ? `Dépasse ${MAX_SIZE_MB} Mo` : undefined,
    }]);
  }

  clearFile(): void {
    this.onFilesChange([]);
  }

  /** « Charger un autre lot » — back to an empty form, the period is kept. */
  startNewBatch(): void {
    this.clearFile();
    this.result.set(null);
    this.resultFileName.set(null);
  }

  formatSize(bytes: number): string {
    if (bytes < 1024)        return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  readonly canSubmit = computed(() => {
    const f = this.selectedFile();
    return !this.processing() && !!this.paysId() && !!f && !f.error;
  });

  readonly submitLabel = computed(() => {
    if (this.processing()) return this.t('PAYROLL.PAYSLIPS.FORM.PROCESSING');
    const n = this.detectedPages();
    return n
      ? this.t('PAYROLL.PAYSLIPS.FORM.SUBMIT_COUNT', { count: n })
      : this.t('PAYROLL.PAYSLIPS.FORM.SUBMIT');
  });

  readonly needsAttention = computed(() => {
    const r = this.result();
    return !!r && (r.errorCount > 0 || r.unidentifiedCount > 0 || r.duplicateCount > 0);
  });

  submit(): void {
    if (!this.canSubmit()) return;
    const file = this.selectedFile()!.file;
    const paysId = this.paysId()!;
    const year = this.periodYear();
    const month = this.periodMonth();

    this.processing.set(true);
    this.result.set(null);
    this.openProcessingModal();

    this.svc.processBatch(file, paysId, year, month).pipe(
      catchError(err => {
        this.notification.error(this.extractErrorMessage(err));
        return of(null);
      }),
    ).subscribe(result => {
      this.processing.set(false);
      this.closeProcessingModal();
      if (!result) return;
      this.result.set(result);
      this.detailSearch.set('');
      this.resultFileName.set(file.name);
      this.clearFile();
      this.addToHistory(paysId, year, month, file.name, result);
      this.notification.success(this.t('PAYROLL.PAYSLIPS.NOTIFY.DONE', {
        success: result.successCount, total: result.totalPages,
      }));
    });
  }

  private openProcessingModal(): void {
    const tpl = this.processingTpl();
    if (!tpl) return;
    this.processingPages.set(this.detectedPages());
    this.processingModalRef = this.modalService.open({
      title:           this.t('PAYROLL.PAYSLIPS.PROCESSING_MODAL.TITLE'),
      icon:            'cloud_upload',
      size:            'sm',
      body:            tpl,
      // Rien à annuler côté serveur : un clic à côté ne doit pas faire croire que le
      // traitement s'est arrêté.
      closeOnBackdrop: false,
    });
  }

  private closeProcessingModal(): void {
    this.processingModalRef?.close();
    this.processingModalRef = null;
  }

  // ── Rapport du lot ───────────────────────────────────────────────────────
  private statusVariant(status: PayslipPageStatus): BadgeVariant {
    switch (status) {
      case 'SUCCESS':      return 'success';
      case 'ERROR':        return 'danger';
      case 'UNIDENTIFIED': return 'warning';
      case 'DUPLICATE':    return 'info';
    }
  }

  /** Outils de tableau communs (`tableTools`). Tri local : le détail d'un import arrive entier. */
  readonly detailConfig = computed(() => ({
    emptyMessage: this.t('PAYROLL.PAYSLIPS.TABLE.EMPTY'),
    ...tableTools(this.translate),
  }));

  readonly detailColumns = computed<TableColumn[]>(() => [
    { key: 'pageNumber',     label: this.t('PAYROLL.PAYSLIPS.TABLE.PAGE'), width: '80px', sortable: true },
    { key: 'matricule',      label: this.t('PAYROLL.PAYSLIPS.TABLE.MATRICULE'), sortable: true },
    { key: 'employee',       label: this.t('PAYROLL.PAYSLIPS.TABLE.EMPLOYEE'), sortable: true },
    { key: 'status',         label: this.t('PAYROLL.PAYSLIPS.TABLE.STATUS'), type: 'badge', sortable: true },
    { key: 'sharePointUrl',  label: this.t('PAYROLL.PAYSLIPS.TABLE.SHAREPOINT_URL'), type: 'custom', sortable: true },
    { key: 'errorMessage',   label: this.t('PAYROLL.PAYSLIPS.TABLE.ERROR_MESSAGE'), sortable: true },
  ]);

  readonly detailRows = computed<TableRow[]>(() =>
    (this.result()?.details ?? []).map(d => ({
      id:            d.pageNumber,
      pageNumber:    d.pageNumber,
      matricule:     d.matricule ?? '—',
      employee:      d.employeeFullName ?? '—',
      status:        { label: this.t(`PAYROLL.PAYSLIPS.STATUS.${d.status}`), options: { variant: this.statusVariant(d.status), size: 'sm' as const } },
      sharePointUrl: d.sharePointUrl,
      errorMessage:  d.errorMessage ?? '—',
    })),
  );

  /** Recherche de la barre au-dessus du détail du lot. */
  readonly detailSearch = signal('');

  /** Détail filtré par la recherche — le lien SharePoint s'affiche « Ouvrir », son URL
   *  n'est donc pas cherchée. */
  readonly filteredDetailRows = computed<TableRow[]>(() =>
    searchTableRows(this.detailRows(), this.detailColumns().map(c =>
      c.key === 'sharePointUrl' ? { ...c, sortAccessor: () => '' } : c), this.detailSearch()),
  );

  // ── Historique des importations ──────────────────────────────────────────
  /** Recherche de la barre au-dessus de l'historique. */
  readonly historySearch = signal('');
  readonly history = signal<PayslipHistoryEntry[]>([]);
  readonly historyFilter = signal<HistoryStatusFilter>('ALL');
  readonly historyPaysFilter   = signal<number | null>(null);
  /** Période au format `YYYY-MM`. */
  readonly historyPeriodFilter = signal<string | null>(null);
  /** Plage « Date de traitement » telle qu'émise par le panneau (`Date[]`). */
  readonly historyProcessedFilter = signal<Date[] | null>(null);

  // `daf-filter` : champ vide = tous les statuts ('ALL'). Pays et période proposent les
  // valeurs présentes dans l'historique.
  readonly historyFilterFields = computed<FilterField[]>(() => {
    const history = this.history();
    const pays = new Map(history.map(h => [h.paysId, this.paysNames.name(h.paysId, h.paysLabel || h.paysIso)]));
    const periods = distinctSorted(history.map(h => periodKey(h.periodYear, h.periodMonth))).reverse();
    return [{
      name: 'status',
      label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_STATUS'),
      type: 'select',
      placeholder: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_ALL'),
      options: [
        { value: 'SUCCESS', label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_SUCCESS') },
        { value: 'PARTIAL', label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_PARTIAL') },
      ],
    }, {
      name: 'pays',
      label: this.t('PAYROLL.PAYSLIPS.HISTORY.PAYS'),
      type: 'select',
      searchable: true,
      placeholder: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_ALL_PAYS'),
      options: [...pays.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, label]) => ({ value: String(id), label })),
    }, {
      name: 'period',
      label: this.t('PAYROLL.PAYSLIPS.HISTORY.PERIOD'),
      type: 'select',
      placeholder: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_ALL_PERIODS'),
      options: periods.map(p => ({ value: p, label: this.periodLabel(p) })),
    }, {
      name: 'processedAt',
      label: this.t('PAYROLL.PAYSLIPS.HISTORY.DATE'),
      type: 'daterange',
    }];
  });

  /** Amorçage du panneau — forme interne de `daf-filter` (un `select` est un `string[]`). */
  readonly historyFilterSeed = computed<FilterResult>(() => ({
    status:      this.historyFilter() === 'ALL' ? [] : [this.historyFilter()],
    pays:        this.historyPaysFilter() != null ? [String(this.historyPaysFilter())] : [],
    period:      this.historyPeriodFilter() ? [this.historyPeriodFilter()!] : [],
    processedAt: this.historyProcessedFilter(),
  }));

  /** Panneau du filtre de la barre — mêmes libellés que l'ancien `daf-filter` de l'en-tête. */
  readonly historyFilterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title:        this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_TITLE'),
    triggerLabel: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_TRIGGER'),
    applyLabel:   this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_APPLY'),
    cancelLabel:  this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_CANCEL'),
    resetLabel:   this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_RESET'),
    align:        'right',
    initialValues: this.historyFilterSeed(),
  }));

  applyHistoryFilter(result: FilterResult): void {
    this.historyFilter.set(((result['status'] as string | null) || 'ALL') as HistoryStatusFilter);
    const pays = pickValue(result, 'pays');
    this.historyPaysFilter.set(pays ? Number(pays) : null);
    this.historyPeriodFilter.set(pickValue(result, 'period'));
    this.historyProcessedFilter.set(rangeSeed(result['processedAt']));
  }

  private periodLabel(key: string): string {
    const [year, month] = key.split('-').map(Number);
    return `${this.t(`PAYROLL.PAYSLIPS.MONTHS.${MONTH_KEYS[month - 1]}`)} ${year}`;
  }

  private isFullSuccess(r: PayslipBatchResult): boolean {
    return r.totalPages > 0 && r.successCount === r.totalPages;
  }

  readonly historyColumns = computed<TableColumn[]>(() => [
    { key: 'processedAt', label: this.t('PAYROLL.PAYSLIPS.HISTORY.DATE'), type: 'date', sortable: true,
      format: { dateStyle: 'short', timeStyle: 'short' } },
    { key: 'pays',        label: this.t('PAYROLL.PAYSLIPS.HISTORY.PAYS'), type: 'badge', sortable: true },
    // Mois écrit en toutes lettres : trié sur AAAA-MM, pas sur le libellé.
    { key: 'period',      label: this.t('PAYROLL.PAYSLIPS.HISTORY.PERIOD'), sortable: true,
      sortAccessor: row => row['_periodKey'] as string },
    { key: 'fileName',    label: this.t('PAYROLL.PAYSLIPS.HISTORY.FILE'), type: 'custom', sortable: true },
    { key: 'count',       label: this.t('PAYROLL.PAYSLIPS.HISTORY.COUNT'), sortable: true,
      sortAccessor: row => row['_count'] as number },
    { key: 'status',      label: this.t('PAYROLL.PAYSLIPS.HISTORY.STATUS'), type: 'badge', sortable: true },
  ]);

  readonly historyRows = computed<TableRow[]>(() => {
    const filter = this.historyFilter();
    const pays = this.historyPaysFilter();
    const period = this.historyPeriodFilter();
    const processed = dayRange(this.historyProcessedFilter());
    return this.history()
      .filter(h => (filter === 'ALL' || (filter === 'SUCCESS') === this.isFullSuccess(h.result))
        && (pays == null || h.paysId === pays)
        && (!period || periodKey(h.periodYear, h.periodMonth) === period)
        && inDayRange(h.processedAt, processed))
      .map(h => {
        const ok = this.isFullSuccess(h.result);
        return {
          id:          h.id,
          processedAt: h.processedAt,
          pays:        { label: h.paysIso || h.paysLabel, options: { variant: 'neutral' as const, size: 'sm' as const } },
          period:      `${this.t(`PAYROLL.PAYSLIPS.MONTHS.${MONTH_KEYS[h.periodMonth - 1]}`)} ${h.periodYear}`,
          fileName:    h.fileName,
          _periodKey:  periodKey(h.periodYear, h.periodMonth),
          _count:      h.result.totalPages,
          count:       this.t('PAYROLL.PAYSLIPS.HISTORY.COUNT_VALUE', { count: h.result.totalPages }),
          status: {
            label: this.t(ok ? 'PAYROLL.PAYSLIPS.HISTORY.STATUS_SUCCESS' : 'PAYROLL.PAYSLIPS.HISTORY.STATUS_PARTIAL', {
              success: h.result.successCount, total: h.result.totalPages,
            }),
            options: { variant: (ok ? 'success' : 'warning') as BadgeVariant, size: 'sm' as const, dot: true },
          },
        };
      });
  });

  /** Historique filtré par la recherche — sur le texte affiché : date de traitement
   *  formatée (pas l'ISO), période en toutes lettres et nombre de fiches écrit en clair
   *  (pas les clés de tri). */
  readonly filteredHistoryRows = computed<TableRow[]>(() => {
    const dateFmt = new Intl.DateTimeFormat(this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR',
      { dateStyle: 'short', timeStyle: 'short' });
    const display: Record<string, (row: TableRow) => string> = {
      processedAt: row => dateFmt.format(new Date(row['processedAt'] as string)),
      period:      row => row['period'] as string,
      count:       row => row['count'] as string,
    };
    return searchTableRows(this.historyRows(), this.historyColumns().map(c =>
      display[c.key] ? { ...c, sortAccessor: display[c.key] } : c), this.historySearch());
  });

  readonly historyConfig = computed(() => ({
    emptyMessage: this.t('PAYROLL.PAYSLIPS.HISTORY.EMPTY'),
    ...tableTools(this.translate),
    defaultSort: { key: 'processedAt', dir: 'desc' as const },
    actions: [{
      id: 'view',
      icon: 'visibility',
      tooltip: this.t('PAYROLL.PAYSLIPS.HISTORY.VIEW'),
      onClick: (row: TableRow) => this.openHistoryEntry(String(row['id'])),
    }],
  }));

  private openHistoryEntry(id: string): void {
    const entry = this.history().find(h => h.id === id);
    if (!entry) return;
    this.result.set(entry.result);
    this.detailSearch.set('');
    this.resultFileName.set(entry.fileName);
    document.getElementById('payslip-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private addToHistory(paysId: number, year: number, month: number, fileName: string, result: PayslipBatchResult): void {
    const pays = this.paysList().find(p => p.id === paysId);
    const entry: PayslipHistoryEntry = {
      id:          `${Date.now()}`,
      processedAt: new Date().toISOString(),
      paysId,
      paysLabel:   pays?.frenchLabel ?? String(paysId),
      paysIso:     pays?.isoCode ?? '',
      periodYear:  year,
      periodMonth: month,
      fileName,
      result,
    };
    const next = [entry, ...this.history()].slice(0, HISTORY_MAX);
    this.history.set(next);
    this.writeHistory(next);
  }

  private readHistory(): PayslipHistoryEntry[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeHistory(entries: PayslipHistoryEntry[]): void {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch { /* quota / private mode */ }
  }

  private extractErrorMessage(err: unknown): string {
    const httpErr = err as { error?: { message?: string } };
    return httpErr?.error?.message ?? this.t('PAYROLL.PAYSLIPS.NOTIFY.ERROR');
  }
}
