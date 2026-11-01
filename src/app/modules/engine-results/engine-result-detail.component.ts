import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PayrollEngineService, RunPayrollResponse } from '../../core/payroll-engine.service';
import { NotificationService } from '../../core/notification.service';
import { readBlobError, saveBlob } from '../../shared/blob-download';
import { ButtonComponent, CardComponent, type ToolbarAction } from '@khalilrebhiitec/daf360';
import { monthName } from '../../shared/filter-utils';
import { PayslipBulletinComponent, employerCostOf, type PayslipTotals } from '../../shared/payslip-bulletin/payslip-bulletin.component';

/**
 * Bulletin d'un résultat de paie, affiché DANS la page historique
 * `/payroll/engine-results/:employeeId` (sous les KPI, à la place de la liste des
 * périodes ; « Retour à la liste » la ramène) — remplace l'ancienne pop-up `ModalService`.
 * Le parent garde le résultat ouvert dans l'URL (`?result=<id>`) : lien partageable et
 * bouton Retour du navigateur.
 *
 * Même bulletin que /payroll/engine-run (`app-payslip-bulletin`) : 4 indicateurs, Gains,
 * Retenues, Net à payer, « Où va le brut ? ». Exports Excel / PDF du serveur dans la barre
 * de recherche du bulletin. Un ANCIEN calcul (le mois a été relancé depuis) le signale et
 * propose d'ouvrir le dernier.
 */
@Component({
  selector: 'app-engine-result-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TranslatePipe, ButtonComponent, CardComponent, PayslipBulletinComponent],
  templateUrl: './engine-result-detail.component.html',
  styleUrl: './engine-result-detail.component.scss',
})
export class EngineResultDetailComponent {
  private readonly translate = inject(TranslateService);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  /** Tous les résultats du collaborateur, déjà chargés par la page. */
  readonly results  = input.required<RunPayrollResponse[]>();
  readonly resultId = input.required<number>();

  /** Nom du collaborateur, repris dans l'en-tête du PDF (le service paie ne lit pas l'annuaire RH). */
  readonly employeeName = input('');
  /** Devise du pays des résultats (code ISO 4217), calculée par la page. */
  readonly currency = input<string | null>(null);

  /** « Retour à la liste ». */
  readonly closed = output<void>();
  /** Ouvrir un autre résultat — le dernier calcul du mois, depuis un ancien. */
  readonly openResult = output<number>();

  private readonly engineApi = inject(PayrollEngineService);
  private readonly notify    = inject(NotificationService);

  readonly result = computed(() => this.results().find(r => r.resultId === this.resultId()) ?? null);
  /** « Coût pour l'entreprise » du bulletin (cotisations patronales, coût employeur). */
  readonly employerCost = computed(() => employerCostOf(this.result()));

  readonly title = computed(() => {
    const r = this.result();
    if (!r) return '';
    const period = `${monthName(r.periodMonth, this.translate.currentLang() ?? 'fr')} ${r.periodYear}`;
    return this.t('PAYROLL.ENGINE_RESULTS.PAYSLIP_TITLE', { period });
  });

  readonly calculatedOn = computed(() => {
    const r = this.result();
    if (!r?.calculatedAt) return null;
    const d = new Date(r.calculatedAt);
    if (Number.isNaN(d.getTime())) return null;
    const date = d.toLocaleString(this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR',
      { dateStyle: 'short', timeStyle: 'short' });
    return this.t('PAYROLL.ENGINE_RESULTS.CALCULATED_ON', { date });
  });

  /** Les quatre montants du bulletin, sur les strates réelles (S3 CNSS salariale, S4 IRPP,
   *  S5 net), comme /payroll/engine-run. */
  readonly totals = computed<PayslipTotals | null>(() => {
    const r = this.result();
    if (!r) return null;
    return {
      gross:           r.aggregateGross ?? (r.strate1 ?? 0) + (r.strate2 ?? 0),
      employeeCharges: r.strate3 ?? 0,
      irpp:            r.aggregateIrpp ?? r.strate4 ?? 0,
      net:             r.strate5 ?? 0,
    };
  });

  /** Dernier calcul du même mois, quand le résultat ouvert n'est PAS celui-là (le serveur
   *  ajoute un résultat à chaque lancement : plus grand id = plus récent). */
  readonly newerResult = computed(() => {
    const r = this.result();
    if (!r) return null;
    const latest = this.results()
      .filter(x => x.periodYear === r.periodYear && x.periodMonth === r.periodMonth)
      .reduce((a, b) => (b.resultId > a.resultId ? b : a), r);
    return latest.resultId !== r.resultId ? latest : null;
  });

  // ── Recherche du bulletin — remise à zéro quand un autre résultat s'ouvre ──
  readonly rubriqueSearch = signal('');
  private readonly bulletin = viewChild(PayslipBulletinComponent);

  constructor() {
    // Autre résultat ouvert (lien `?result=`) : repartir d'un bulletin non filtré.
    effect(() => {
      this.resultId();
      untracked(() => this.rubriqueSearch.set(''));
    });
  }

  // ── Exports Excel / PDF générés par le backend, comme ceux de Finance ─────────
  // Le serveur reçoit les codes des lignes affichées (après la recherche), dans l'ordre du
  // bulletin, et renvoie le fichier ; en cas d'échec, le `detail` du ProblemDetail en toast.
  readonly exportingXlsx = signal(false);
  readonly exportingPdf  = signal(false);

  private exportCodes(): string[] {
    return this.bulletin()?.searchedCodes()
      ?? (this.result()?.rubriqueDetails ?? []).map(r => r.rubriqueCode);
  }

  readonly toolbarActions = computed<ToolbarAction[]>(() => {
    const empty = (this.bulletin()?.searchedCodes().length ?? 1) === 0;
    return [
      { id: 'export-xlsx', icon: 'download', label: this.t('PAYROLL.ENGINE_RESULTS.EXPORT_XLSX'),
        position: 'right', disabled: empty || this.exportingXlsx() },
      { id: 'export-pdf', icon: 'picture_as_pdf', label: this.t('PAYROLL.ENGINE_RESULTS.EXPORT_PDF'),
        position: 'right', disabled: empty || this.exportingPdf() },
    ];
  });

  onToolbarAction(id: string): void {
    if (id === 'export-xlsx') this.exportXlsx();
    if (id === 'export-pdf') this.exportPdf();
  }

  private exportName(ext: string): string {
    const r = this.result()!;
    return `Bulletin_${r.employeeId}_${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}.${ext}`;
  }

  exportXlsx(): void {
    const r = this.result();
    if (!r || this.exportingXlsx()) return;
    this.exportingXlsx.set(true);
    this.engineApi.exportResultRubriquesXlsx(r.resultId, this.exportCodes(), this.translate.currentLang() || 'fr')
      .subscribe({
        next: blob => { this.exportingXlsx.set(false); saveBlob(blob, this.exportName('xlsx')); },
        error: err => this.exportFailed(err, this.exportingXlsx),
      });
  }

  exportPdf(): void {
    const r = this.result();
    if (!r || this.exportingPdf()) return;
    this.exportingPdf.set(true);
    this.engineApi.exportResultRubriquesPdf(r.resultId, this.exportCodes(), this.translate.currentLang() || 'fr', this.employeeName())
      .subscribe({
        next: blob => { this.exportingPdf.set(false); saveBlob(blob, this.exportName('pdf')); },
        error: err => this.exportFailed(err, this.exportingPdf),
      });
  }

  private exportFailed(err: unknown, busy: { set(v: boolean): void }): void {
    busy.set(false);
    readBlobError(err, this.t('PAYROLL.ENGINE_RESULTS.EXPORT_ERROR')).then(msg => this.notify.error(msg));
  }
}
