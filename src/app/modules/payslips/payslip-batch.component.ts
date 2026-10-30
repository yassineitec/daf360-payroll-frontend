import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
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
  PaginationComponent,
  SearchToolbarComponent,
  SectionCardComponent,
  SectionTitleComponent,
  SelectComponent,
  StatusBadgeComponent,
  type AvatarCell,
  type BreadcrumbItem,
  type FilterField,
  type FilterResult,
  type SearchToolbarFilterConfig,
  type TableConfig,
  type BadgeVariant,
  type ButtonOptions,
  type MetricCardOptions,
  type MetricDelta,
  type ModalRef,
  type PageHeaderBadge,
  type SelectOption,
  type TableColumn,
  type TableRow,
  type UploadedFile,
} from '@khalilrebhiitec/daf360';
import { NotificationService } from '../../core/notification.service';
import { PayrollApiService, PaysDto } from '../../core/payroll-api.service';
import { PayslipBatchService, PayslipPageResult } from '../../core/payslip-batch.service';
import { searchTableRows, tableTools } from '../../shared/table-tools';
import { pickValue } from '../../shared/filter-utils';
import { saveBlob } from '../../shared/blob-download';
import { flagDataUri } from '../../shared/country-flags';
import { PaysNamesService } from '../../core/pays-names.service';
import { MONTH_KEYS, PayslipHistoryStore, batchCounts } from './payslip-history';

const MAX_SIZE_MB = 50;

/** Ce que la page dit d'une page du PDF : son statut affiché et l'action à mener. */
type PageOutcome = 'FILED' | 'NOT_FILED' | 'UNIDENTIFIED' | 'UNKNOWN_MATRICULE' | 'TECHNICAL' | 'DUPLICATE';

/**
 * `/payroll/payslips/new` et `/payroll/payslips/:id` — une seule route, comme le simulateur.
 *
 * - `new` : import du PDF mensuel multi-fiches (une fiche par page, système de paie
 *   externe) en deux étapes — ① pays et mois, ② fichier — puis une confirmation qui
 *   rappelle que les fiches déjà déposées pour ce mois seront remplacées.
 * - `:id` : rapport d'un lot du journal ({@link PayslipHistoryStore}) — combien de fiches
 *   ont été distribuées, et pour chaque page à corriger, en clair, ce qu'il faut faire.
 *
 * Le traitement lui-même tourne entièrement sur daf360-rh-service (PayslipBatchService) :
 * découpage, rapprochement par matricule, dépôt SharePoint. Après la réponse, le lot est
 * ajouté au journal et la page bascule sur son rapport.
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
    MetricCardComponent, PageComponent, PageHeaderComponent, SectionCardComponent, SectionTitleComponent,
    LoadingComponent, PaginationComponent, SearchToolbarComponent, SelectComponent, StatusBadgeComponent,
  ],
  templateUrl: './payslip-batch.component.html',
  styleUrl: './payslip-batch.component.scss',
})
export class PayslipBatchComponent implements OnInit {
  private readonly svc          = inject(PayslipBatchService);
  private readonly payrollApi   = inject(PayrollApiService);
  private readonly notification = inject(NotificationService);
  private readonly modalService = inject(ModalService);
  private readonly store        = inject(PayslipHistoryStore);
  private readonly router       = inject(Router);
  private readonly route        = inject(ActivatedRoute);
  protected readonly translate  = inject(TranslateService);
  private readonly paysNames    = inject(PaysNamesService);

  /** Pop-up d'attente pendant le traitement — `ModalService` de la lib, corps =
   *  `#processingTpl` (un `daf-loading`). Le backend traite tout le lot en UNE requête
   *  et ne renvoie aucun avancement : c'est donc un indicateur d'attente, pas une barre
   *  de progression en %. Fermé dès que la réponse (ou l'erreur) arrive. */
  private readonly processingTpl = viewChild<TemplateRef<unknown>>('processingTpl');
  private processingModalRef: ModalRef | null = null;
  /** Nombre de fiches du lot en cours, figé à l'envoi (le fichier est retiré ensuite). */
  readonly processingPages = signal<number | null>(null);

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Le pop-up vit sous la racine de l'appli, hors de cette vue : on le ferme si
    // l'utilisateur quitte la page pendant le traitement.
    this.destroyRef.onDestroy(() => this.closeProcessingModal());
  }

  /** Même pattern que les autres pages : traduction synchrone pour ce qui ne passe pas
   *  par le pipe `| translate` du template. */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  private numberLocale(): string {
    return this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR';
  }

  private periodLabel(year: number, month: number): string {
    return `${this.t(`PAYROLL.PAYSLIPS.MONTHS.${MONTH_KEYS[month - 1]}`)} ${year}`;
  }

  // ── Route : `new` ou id d'un lot du journal ──────────────────────────────
  readonly routeId = signal<string | null>(null);
  readonly isNew   = computed(() => this.routeId() === 'new');
  readonly entry   = computed(() => this.isNew() ? null : this.store.find(this.routeId()));
  readonly result  = computed(() => this.entry()?.result ?? null);

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(p => {
      this.routeId.set(p.get('id'));
      this.detailSearch.set('');
      // Rapport avec des pages à corriger : on les montre seules d'office (case décochable).
      const opened = this.store.find(p.get('id'));
      this.toFixOnly.set(!!opened && batchCounts(opened.result).toFix > 0);
      this.statusFilter.set(null);
      this.detailPage.set(0);
    });
    this.loading.set(true);
    this.payrollApi.listPays().subscribe({
      next: list => { this.paysList.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  // First-load gate for `daf-page [loading]` — the pays dropdown is unusable until this
  // resolves. Kept separate from `processing`, which must never swap the whole page for
  // the skeleton.
  readonly loading = signal(false);

  // ── En-tête ──────────────────────────────────────────────────────────────
  readonly title = computed(() => {
    if (this.isNew()) return this.t('PAYROLL.PAYSLIPS.FORM.PAGE_TITLE');
    const e = this.entry();
    return e
      ? `${this.periodLabel(e.periodYear, e.periodMonth)} · ${this.paysNames.name(e.paysId, e.paysLabel || e.paysIso)}`
      : this.t('PAYROLL.PAYSLIPS.REPORT.NOT_FOUND_TITLE');
  });

  /** Sous-titre du formulaire uniquement — le rapport n'en a pas : fichier et date sont dans
   *  sa carte « Détails », comme les autres fiches. */
  readonly subtitle = computed(() => this.isNew() ? this.t('PAYROLL.PAYSLIPS.FORM.SUBTITLE') : '');

  /** Carte « Détails » du rapport (colonne gauche) : le lot, puis son résultat. « Lot du
   *  mois » : premier envoi de ce pays + mois, ou nouvel envoi qui a remplacé des fiches. */
  readonly reportDetails = computed(() => {
    const e = this.entry();
    if (!e) return [];
    const c = batchCounts(e.result);
    const fmt = (iso: string, style: 'short' | 'long') =>
      new Intl.DateTimeFormat(this.numberLocale(), { dateStyle: style, timeStyle: 'short' }).format(new Date(iso));
    const sameMonth = this.store.entries()
      .filter(h => h.paysId === e.paysId && h.periodYear === e.periodYear && h.periodMonth === e.periodMonth)
      .sort((a, b) => a.processedAt.localeCompare(b.processedAt));
    const rank = sameMonth.findIndex(h => h.id === e.id);
    const previous = rank > 0 ? sameMonth[rank - 1] : null;
    const pct = c.total ? Math.round(c.filed / c.total * 100) : 0;
    const R = 'PAYROLL.PAYSLIPS.REPORT.DETAIL_';
    return [
      { id: 'batch', title: this.t(`${R}BLOCK_BATCH`), rows: [
        { key: this.t(`${R}PAYS`), value: this.paysNames.name(e.paysId, e.paysLabel || e.paysIso) },
        { key: this.t(`${R}PERIOD`), value: this.periodLabel(e.periodYear, e.periodMonth) },
        { key: this.t(`${R}FILE`), value: e.fileName },
        { key: this.t(`${R}PROCESSED`), value: fmt(e.processedAt, 'short') },
      ] },
      { id: 'result', title: this.t(`${R}BLOCK_RESULT`), rows: [
        { key: this.t(`${R}RATE`), value: `${pct} %` },
        { key: this.t(`${R}MONTH_BATCH`), value: previous
            ? this.t(`${R}MONTH_BATCH_NEXT`, { n: rank + 1, date: fmt(previous.processedAt, 'short') })
            : this.t(`${R}MONTH_BATCH_FIRST`) },
      ] },
    ];
  });

  print(): void {
    window.print();
  }

  readonly headerBadges = computed<PageHeaderBadge[]>(() => {
    if (this.isNew()) return this.formBadges();
    const r = this.result();
    if (!r) return [];
    const toFix = batchCounts(r).toFix;
    return [toFix
      ? { label: this.t('PAYROLL.PAYSLIPS.LIST.STATUS_TO_CHECK', { count: toFix }), variant: 'warning', size: 'sm', dot: true }
      : { label: this.t('PAYROLL.PAYSLIPS.LIST.STATUS_COMPLETE'), variant: 'success', size: 'sm', dot: true }];
  });

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.PAYSLIPS.BREADCRUMB'), link: '/payroll/payslips' },
    { label: this.isNew() ? this.t('PAYROLL.PAYSLIPS.FORM.BREADCRUMB') : this.title() },
  ]);

  // ── Étape 1 : pays et période ────────────────────────────────────────────
  private readonly paysList = signal<PaysDto[]>([]);
  readonly paysId = signal<number | null>(null);
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({
      value: String(p.id),
      label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})`,
      imageUrl: flagDataUri(p.isoCode),
    })),
  );

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

  private selectedPaysName(): string {
    const id = this.paysId();
    const p = this.paysList().find(x => x.id === id);
    return id ? this.paysNames.name(id, p?.frenchLabel ?? String(id)) : '';
  }

  /** Lot déjà traité pour ce pays et ce mois (depuis ce navigateur) — bandeau d'alerte
   *  et rappel dans la confirmation : le dépôt SharePoint REMPLACE les fiches existantes. */
  readonly existingForPeriod = computed(() => {
    const id = this.paysId();
    return id ? this.store.findPeriod(id, this.periodYear(), this.periodMonth()) : null;
  });

  readonly existingDate = computed(() => {
    const e = this.existingForPeriod();
    return e
      ? new Intl.DateTimeFormat(this.numberLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(e.processedAt))
      : '';
  });

  openExisting(): void {
    const e = this.existingForPeriod();
    if (e) this.router.navigate(['/payroll/payslips', e.id]);
  }

  // ── Étape 2 : fichier ────────────────────────────────────────────────────
  readonly uploadedFiles = signal<UploadedFile[]>([]);
  readonly processing    = signal(false);

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

  cancel(): void {
    this.router.navigate(['/payroll/payslips']);
  }

  // ── Formulaire : même squelette que /finance/affaires/new et le simulateur, en UNE vue ──
  // Carte de formulaire (en-tête + les deux blocs) + barre d'actions flottante, sans rail :
  // deux blocs courts ne justifient pas un parcours en étapes.

  /** La seule action dessinée de la barre — teal, pilule, comme les assistants Finance. */
  readonly submitButtonOptions = computed((): ButtonOptions => ({
    variant:  'teal',
    pill:     true,
    label:    this.submitLabel(),
    iconEnd:  'cloud_upload',
    loading:  this.processing(),
    disabled: !this.canSubmit(),
  }));

  /** Pastilles de l'en-tête du formulaire — le résumé de la saisie, comme l'assistant
   *  affaire : pays · période · fichier. Une pastille n'apparaît que quand sa donnée est connue. */
  private readonly formBadges = computed((): PageHeaderBadge[] => {
    const badges: PageHeaderBadge[] = [];
    if (this.paysId()) badges.push({ label: this.selectedPaysName(), variant: 'primary', size: 'sm' });
    badges.push({ label: this.periodLabel(this.periodYear(), this.periodMonth()), variant: 'secondary', size: 'sm' });
    const f = this.selectedFile();
    if (f && !f.error) {
      const n = this.detectedPages();
      badges.push({
        label: n ? this.t('PAYROLL.PAYSLIPS.FILE.PAGES', { count: n }) : f.name,
        variant: 'success', size: 'sm',
      });
    }
    return badges;
  });

  /** Confirmation avant l'envoi : rien n'est réversible une fois les fiches déposées. */
  confirmSubmit(): void {
    if (!this.canSubmit()) return;
    const params = {
      count:  this.detectedPages() ?? '',
      period: this.periodLabel(this.periodYear(), this.periodMonth()),
      pays:   this.selectedPaysName(),
    };
    const body = [
      this.t(this.detectedPages() ? 'PAYROLL.PAYSLIPS.CONFIRM.BODY_COUNT' : 'PAYROLL.PAYSLIPS.CONFIRM.BODY', params),
      this.t(this.existingForPeriod() ? 'PAYROLL.PAYSLIPS.CONFIRM.REPLACE_KNOWN' : 'PAYROLL.PAYSLIPS.CONFIRM.REPLACE', {
        date: this.existingDate(),
      }),
    ].join(' ');
    this.modalService.open({
      title: this.t('PAYROLL.PAYSLIPS.CONFIRM.TITLE'),
      icon: 'cloud_upload',
      size: 'sm',
      body,
      buttons: [
        { label: this.t('PAYROLL.PAYSLIPS.CONFIRM.CANCEL'), variant: 'secondary', action: ref => ref.close() },
        { label: this.t('PAYROLL.PAYSLIPS.CONFIRM.OK'), variant: 'primary', icon: 'cloud_upload',
          action: ref => { ref.close(); this.submit(); } },
      ],
    });
  }

  private submit(): void {
    if (!this.canSubmit()) return;
    const file = this.selectedFile()!.file;
    const paysId = this.paysId()!;
    const year = this.periodYear();
    const month = this.periodMonth();

    this.processing.set(true);
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
      const pays = this.paysList().find(p => p.id === paysId);
      const entry = this.store.add({
        paysId,
        paysLabel:   pays?.frenchLabel ?? String(paysId),
        paysIso:     pays?.isoCode ?? '',
        periodYear:  year,
        periodMonth: month,
        fileName:    file.name,
        result,
      });
      this.clearFile();
      const c = batchCounts(result);
      this.notification.success(this.t('PAYROLL.PAYSLIPS.NOTIFY.DONE', { success: c.filed, total: c.total }));
      // L'import est remplacé par le rapport : « Précédent » ramène à la liste, pas au formulaire vidé.
      this.router.navigate(['/payroll/payslips', entry.id], { replaceUrl: true });
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
  readonly counts = computed(() => {
    const r = this.result();
    return r ? batchCounts(r) : null;
  });

  private kpiOptions(icon: string, tone: 'primary' | 'secondary' | 'warning' | 'danger' | 'info', value: number,
                     help: string, last = false): MetricCardOptions {
    // Classes écrites en entier (pas `bg-${tone}`) pour que Tailwind les détecte.
    const TONES = {
      primary:   { bg: 'bg-primary/10',   text: 'text-primary' },
      secondary: { bg: 'bg-secondary/10', text: 'text-secondary' },
      warning:   { bg: 'bg-warning/10',   text: 'text-warning' },
      danger:    { bg: 'bg-danger/10',    text: 'text-danger' },
      info:      { bg: 'bg-tertiary/10',  text: 'text-tertiary' },
    };
    const active = tone === 'primary' || tone === 'secondary' || value > 0;
    return {
      icon,
      iconBg:     active ? TONES[tone].bg : 'bg-surface-container',
      iconColor:  active ? TONES[tone].text : 'text-on-surface-variant',
      valueColor: active && tone !== 'primary' ? TONES[tone].text : undefined,
      help: this.t(`PAYROLL.PAYSLIPS.SUMMARY.${help}`),
      ...(last ? { helpPlacement: 'top' as const } : {}),
    };
  }

  /** Quatre tuiles dont la somme fait toujours le total : Distribuées + Problèmes dans le
   *  fichier (non identifiées, erreurs, doublons — à corriger dans le PDF ou la fiche RH) +
   *  Non déposées (collaborateur reconnu, dépôt SharePoint impossible — à corriger dans la
   *  configuration) = Pages. La tuile « Non déposées » remplace l'ancien bandeau. */
  readonly kpis = computed(() => {
    const c = this.counts();
    if (!c) return [];
    const fileProblems = c.unidentified + c.errors + c.duplicates;
    const pct = c.total
      ? new Intl.NumberFormat(this.numberLocale(), { maximumFractionDigits: 0 }).format(c.filed / c.total * 100)
      : '0';
    const parts = [
      c.unidentified ? this.t('PAYROLL.PAYSLIPS.SUMMARY.PART_UNIDENTIFIED', { count: c.unidentified }) : null,
      c.errors       ? this.t('PAYROLL.PAYSLIPS.SUMMARY.PART_ERROR',        { count: c.errors })       : null,
      c.duplicates   ? this.t('PAYROLL.PAYSLIPS.SUMMARY.PART_DUPLICATE',    { count: c.duplicates })   : null,
    ].filter(Boolean).join(' · ');
    const delta = (value: string): MetricDelta => ({ value, direction: 'neutral' });
    return [
      { label: this.t('PAYROLL.PAYSLIPS.SUMMARY.TOTAL'), value: c.total,
        delta: delta(this.t('PAYROLL.PAYSLIPS.SUMMARY.TOTAL_SUB')),
        options: this.kpiOptions('description', 'primary', c.total, 'TOTAL_HELP') },
      { label: this.t('PAYROLL.PAYSLIPS.SUMMARY.FILED'), value: c.filed,
        delta: delta(this.t('PAYROLL.PAYSLIPS.SUMMARY.FILED_SUB', { pct })),
        options: this.kpiOptions('cloud_done', 'secondary', c.filed, 'FILED_HELP') },
      { label: this.t('PAYROLL.PAYSLIPS.SUMMARY.FILE_PROBLEMS'), value: fileProblems,
        delta: delta(parts || this.t('PAYROLL.PAYSLIPS.SUMMARY.NONE')),
        options: this.kpiOptions('error', 'danger', fileProblems, 'FILE_PROBLEMS_HELP') },
      { label: this.t('PAYROLL.PAYSLIPS.SUMMARY.NOT_FILED'), value: c.notFiled,
        delta: delta(this.t(c.notFiled ? 'PAYROLL.PAYSLIPS.SUMMARY.NOT_FILED_SUB' : 'PAYROLL.PAYSLIPS.SUMMARY.NONE')),
        options: this.kpiOptions('cloud_off', 'warning', c.notFiled, 'NOT_FILED_HELP', true) },
    ].map(k => ({ ...k, value: String(k.value) }));
  });

  private outcome(d: PayslipPageResult): PageOutcome {
    switch (d.status) {
      case 'SUCCESS':      return d.sharePointUrl ? 'FILED' : 'NOT_FILED';
      case 'UNIDENTIFIED': return 'UNIDENTIFIED';
      case 'DUPLICATE':    return 'DUPLICATE';
      // Le service RH renvoie « Matricule 'X' non trouve… » pour un matricule inconnu,
      // « Erreur inattendue : … » pour tout le reste.
      case 'ERROR':        return d.matricule && !(d.errorMessage ?? '').startsWith('Erreur inattendue')
                             ? 'UNKNOWN_MATRICULE' : 'TECHNICAL';
    }
  }

  private outcomeVariant(o: PageOutcome): BadgeVariant {
    switch (o) {
      case 'FILED':             return 'success';
      case 'NOT_FILED':         return 'warning';
      case 'UNIDENTIFIED':      return 'warning';
      case 'UNKNOWN_MATRICULE': return 'danger';
      case 'TECHNICAL':         return 'danger';
      case 'DUPLICATE':         return 'info';
    }
  }

  /** Explication d'une page (petite ligne sous l'action). Doublon : la page qui a été
   *  distribuée à sa place (première page du même matricule). */
  private guidance(d: PayslipPageResult, o: PageOutcome): string {
    if (o === 'FILED') return this.t('PAYROLL.PAYSLIPS.GUIDE.FILED');
    const message = (d.errorMessage ?? '').replace(/^Erreur inattendue\s*:\s*/, '');
    const first = o === 'DUPLICATE'
      ? (this.result()?.details ?? []).find(x => x.matricule === d.matricule && x.pageNumber < d.pageNumber)?.pageNumber
      : undefined;
    return this.t(`PAYROLL.PAYSLIPS.GUIDE.${o}`, { matricule: d.matricule ?? '', message, page: first ?? '—' });
  }

  /** Action courte, en gras dans la colonne « Action ». */
  private action(o: PageOutcome): string {
    return this.t(`PAYROLL.PAYSLIPS.TABLE.ACTION_${o}`);
  }

  /** Ordre du tableau : les problèmes d'abord, du plus bloquant au moins bloquant, puis les
   *  pages distribuées — chacun par numéro de page. */
  private static readonly RANK: Record<PageOutcome, number> = {
    UNKNOWN_MATRICULE: 0, TECHNICAL: 1, UNIDENTIFIED: 2, DUPLICATE: 3, NOT_FILED: 4, FILED: 5,
  };

  /** Seulement les pages à corriger — case du panneau Filtres (cochée d'office quand le lot
   *  a des pages à corriger, voir `ngOnInit`). */
  readonly toFixOnly = signal(false);
  /** Statut choisi dans le panneau Filtres (null = tous). */
  readonly statusFilter = signal<PageOutcome | null>(null);

  /** Tableau de la lib, comme les listes Finance et le simulateur : nu (il porte son propre
   *  cadre), sans en-tête de carte, lignes survolées, outils communs (`tableTools`), et
   *  l'ouverture de la fiche en ACTION DE LIGNE (icône), affichée seulement si elle est
   *  déposée. Tri local : le détail d'un import arrive entier. */
  readonly detailConfig = computed((): TableConfig => ({
    showHeader: false,
    hoverable: true,
    emptyMessage: this.t(this.toFixOnly() ? 'PAYROLL.PAYSLIPS.TABLE.EMPTY_TO_FIX' : 'PAYROLL.PAYSLIPS.TABLE.EMPTY'),
    ...tableTools(this.translate),
    actions: [{
      id: 'open',
      icon: 'open_in_new',
      tooltip: this.t('PAYROLL.PAYSLIPS.TABLE.OPEN_PAYSLIP'),
      hidden: row => !row['sharePointUrl'],
      onClick: row => window.open(row['sharePointUrl'] as string, '_blank', 'noopener'),
    }],
  }));

  /** Colonnes de la lib : page, collaborateur (avatar : nom + matricule dessous), statut
   *  (pastille), fichier SharePoint (modèle Prénom_NOM_Mois_Année.pdf), et ce qu'il faut faire
   *  — seule colonne « custom » : action en gras + explication dessous. */
  readonly detailColumns = computed<TableColumn[]>(() => [
    { key: 'pageNumber', label: this.t('PAYROLL.PAYSLIPS.TABLE.PAGE'), type: 'number', width: '80px', sortable: true },
    { key: 'employee',   label: this.t('PAYROLL.PAYSLIPS.TABLE.EMPLOYEE'), type: 'avatar', sortable: true,
      sortAccessor: row => `${(row['employee'] as AvatarCell).name} ${(row['employee'] as AvatarCell).subtitle ?? ''}` },
    { key: 'status',     label: this.t('PAYROLL.PAYSLIPS.TABLE.STATUS'), type: 'badge', sortable: true,
      sortAccessor: row => row['_rank'] as number },
    { key: 'spName',     label: this.t('PAYROLL.PAYSLIPS.TABLE.SP_NAME'), sortable: true },
    { key: 'action',     label: this.t('PAYROLL.PAYSLIPS.TABLE.ACTION'), type: 'custom', sortable: true,
      sortAccessor: row => `${row['actionLabel'] ?? ''} ${row['actionDetail'] ?? ''}` },
  ]);

  /**
   * Nom du fichier de la fiche dans SharePoint. Déposée : lu dans son lien. Reconnue mais non
   * déposée : le nom qu'elle AURAIT eu, même règle que le service RH (`buildFileName` +
   * `SharePointPaths.safeFileName`) — `Prénom_NOM_Mois_Année.pdf`, mois en français. Sans
   * collaborateur reconnu : aucun nom.
   */
  private spFileName(d: PayslipPageResult, o: PageOutcome): { name: string | null; planned: boolean } {
    if (o === 'FILED' && d.sharePointUrl) {
      try {
        const last = new URL(d.sharePointUrl).pathname.split('/').filter(Boolean).pop() ?? '';
        const name = decodeURIComponent(last);
        if (name) return { name, planned: false };
      } catch { /* lien illisible : on retombe sur le nom calculé */ }
    }
    const e = this.entry();
    if (!d.employeeFullName || !e || (o !== 'FILED' && o !== 'NOT_FILED')) return { name: null, planned: false };
    const month = new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(new Date(2000, e.periodMonth - 1, 1));
    const raw = `${d.employeeFullName.trim().replace(/\s+/g, '_')}_${month.charAt(0).toUpperCase()}${month.slice(1)}_${e.periodYear}.pdf`;
    const name = raw.replace(/[\\/:*?"<>|#%]+/g, '_').replace(/^[.\s]+/, '');
    return { name, planned: o !== 'FILED' };
  }

  private readonly detailRows = computed<TableRow[]>(() =>
    (this.result()?.details ?? [])
      .filter(d => {
        const o = this.outcome(d);
        return (!this.toFixOnly() || o !== 'FILED') && (!this.statusFilter() || o === this.statusFilter());
      })
      .map(d => {
        const o = this.outcome(d);
        const sp = this.spFileName(d, o);
        const name = d.employeeFullName ?? '—';
        return {
          id:           d.pageNumber,
          pageNumber:   d.pageNumber,
          employee:     {
            name,
            initials: d.employeeFullName ? initials(d.employeeFullName) : '?',
            subtitle: d.matricule
              ? this.t('PAYROLL.PAYSLIPS.TABLE.MATRICULE_VALUE', { value: d.matricule })
              : this.t('PAYROLL.PAYSLIPS.TABLE.NO_MATRICULE'),
          } satisfies AvatarCell,
          status:       { label: this.t(`PAYROLL.PAYSLIPS.OUTCOME.${o}`), options: { variant: this.outcomeVariant(o), size: 'sm' as const, dot: true } },
          spName:       sp.name
            ? (sp.planned ? this.t('PAYROLL.PAYSLIPS.TABLE.SP_PLANNED_NAME', { name: sp.name }) : sp.name)
            : '—',
          sharePointUrl: o === 'FILED' ? d.sharePointUrl : null,
          actionLabel:  this.action(o),
          actionDetail: o === 'FILED' ? null : this.guidance(d, o),
          _rank:        PayslipBatchComponent.RANK[o],
        };
      })
      .sort((a, b) => a._rank - b._rank || a.pageNumber - b.pageNumber),
  );

  /** Recherche de la barre au-dessus du détail du lot. */
  readonly detailSearch = signal('');

  /** Détail filtré par la recherche (nom, matricule, statut, fichier, action). */
  readonly filteredDetailRows = computed<TableRow[]>(() =>
    searchTableRows(this.detailRows(), this.detailColumns().map(c =>
      c.key === 'status' ? { ...c, sortAccessor: (row: TableRow) => (row['status'] as { label: string }).label } : c),
      this.detailSearch()),
  );

  // ── Panneau Filtres de la barre (comme les listes) ─────────────────────────
  /** Statuts proposés : seulement ceux présents dans le lot, dans l'ordre de gravité. */
  readonly detailFilterFields = computed<FilterField[]>(() => {
    const present = new Set((this.result()?.details ?? []).map(d => this.outcome(d)));
    const outcomes = (Object.keys(PayslipBatchComponent.RANK) as PageOutcome[])
      .filter(o => present.has(o))
      .sort((a, b) => PayslipBatchComponent.RANK[a] - PayslipBatchComponent.RANK[b]);
    return [
      { name: 'toFix', label: this.t('PAYROLL.PAYSLIPS.REPORT.TO_FIX_ONLY'), type: 'checkbox' },
      { name: 'status', label: this.t('PAYROLL.PAYSLIPS.TABLE.STATUS'), type: 'select',
        placeholder: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_ALL'),
        options: outcomes.map(o => ({ value: o, label: this.t(`PAYROLL.PAYSLIPS.OUTCOME.${o}`) })) },
    ];
  });

  readonly detailFilterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title:        this.t('PAYROLL.PAYSLIPS.TABLE.FILTER_TITLE'),
    triggerLabel: this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_TRIGGER'),
    applyLabel:   this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_APPLY'),
    cancelLabel:  this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_CANCEL'),
    resetLabel:   this.t('PAYROLL.PAYSLIPS.HISTORY.FILTER_RESET'),
    align:        'right',
    initialValues: {
      toFix:  this.toFixOnly(),
      status: this.statusFilter() ? [this.statusFilter()!] : [],
    },
  }));

  applyDetailFilter(result: FilterResult): void {
    this.toFixOnly.set(result['toFix'] === true);
    this.statusFilter.set((pickValue(result, 'status') as PageOutcome | null) ?? null);
    this.detailPage.set(0);
  }

  resetDetailFilter(): void {
    this.toFixOnly.set(false);
    this.statusFilter.set(null);
    this.detailPage.set(0);
  }

  onDetailSearch(value: string): void {
    this.detailSearch.set(value);
    this.detailPage.set(0);
  }

  // ── Pagination de la lib (`daf-pagination`), comme les listes ──────────────
  readonly detailPage = signal(0);
  readonly detailPageSize = signal(20);
  readonly detailTotalPages = computed(() => Math.max(1, Math.ceil(this.filteredDetailRows().length / this.detailPageSize())));
  readonly pagedDetailRows = computed(() => {
    const size = this.detailPageSize();
    const page = Math.min(this.detailPage(), this.detailTotalPages() - 1);
    return this.filteredDetailRows().slice(page * size, page * size + size);
  });

  onDetailPageSize(size: number): void {
    this.detailPageSize.set(size);
    this.detailPage.set(0);
  }

  newBatch(): void {
    this.router.navigate(['/payroll/payslips', 'new']);
  }

  /** Rapport page par page en CSV (séparateur `;`, BOM UTF-8) — s'ouvre tel quel dans
   *  Excel. Fait dans le navigateur : le service RH ne garde pas les lots. */
  exportReport(): void {
    const e = this.entry();
    if (!e) return;
    const header = ['PAGE', 'MATRICULE', 'EMPLOYEE', 'STATUS', 'SP_NAME', 'SHAREPOINT_URL', 'GUIDANCE']
      .map(k => this.t(`PAYROLL.PAYSLIPS.TABLE.${k}`));
    const lines = e.result.details.map(d => {
      const o = this.outcome(d);
      const what = o === 'FILED' ? this.guidance(d, o) : `${this.action(o)} : ${this.guidance(d, o)}`;
      const sp = this.spFileName(d, o);
      const spName = sp.name ? (sp.planned ? `${sp.name} (${this.t('PAYROLL.PAYSLIPS.TABLE.SP_PLANNED')})` : sp.name) : '';
      return [String(d.pageNumber), d.matricule ?? '', d.employeeFullName ?? '',
        this.t(`PAYROLL.PAYSLIPS.OUTCOME.${o}`), spName, d.sharePointUrl ?? '', what];
    });
    const csv = [header, ...lines]
      .map(cols => cols.map(v => `"${v.replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const name = `fiches-de-paie-${e.paysIso || e.paysId}-${e.periodYear}-${String(e.periodMonth).padStart(2, '0')}.csv`;
    saveBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), name);
  }


  private extractErrorMessage(err: unknown): string {
    const httpErr = err as { error?: { message?: string } };
    return httpErr?.error?.message ?? this.t('PAYROLL.PAYSLIPS.NOTIFY.ERROR');
  }
}

/** Initiales de l'avatar : premières lettres des deux premiers mots du nom. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
