import { ChangeDetectionStrategy, Component, DestroyRef, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  AccordionCardComponent,
  ButtonComponent,
  CardComponent,
  ModalService,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  PermissionService,
  SectionCardComponent,
  SectionTitleComponent,
  StatusBadgeComponent,
  type BreadcrumbItem,
  type BadgeVariant,
  type ModalButton,
  type ModalRef,
  type MetricCardOptions,
  type MetricDelta,
  type PageHeaderBadge,
  type TableRow,
} from '@khalilrebhiitec/daf360';
import {
  CandidateCostApprovalDto,
  CandidateSimulationService,
  SimSnapshot,
} from '../../core/candidate-simulation.service';
import { PayrollApiService, ParameterSetDto, parseRubriquesApplied } from '../../core/payroll-api.service';
import { PAYROLL_SIMULATOR_PERMISSIONS } from '../../core/payroll-nav';
import { PaysNamesService } from '../../core/pays-names.service';
import { CandidateSimulationListStateService } from './candidate-simulation-list-state.service';

type Status = CandidateCostApprovalDto['status'];

/** Une simulation soumise, enrichie de ce que la fiche affiche partout. */
interface Round {
  /** R1 = la plus ancienne. */
  index: number;
  sim: CandidateCostApprovalDto;
  snap: SimSnapshot;
  currency: string;
}

interface DetailRow { key: string; value: string; tone?: 'minus' | 'plus' | 'total'; }
interface Kpi { label: string; value: string; delta: MetricDelta | null; options: MetricCardOptions; }

/**
 * `/payroll/candidate-simulation/:candidateId` — fiche d'un candidat : toutes les
 * simulations de rémunération soumises pour lui (pré-validations et rounds d'offre), leur
 * évolution, et le détail complet de chacune lu dans le snapshot que RH a figé à la
 * soumission (brut, charges, IRPP, coût chargé, rubriques, conversions).
 *
 * Même squelette que la fiche simulateur (`/payroll/simulator/:id`) : en-tête + carte
 * « Détails » + actions à gauche ; à droite les KPI de la négociation puis son fil (une étape
 * par proposition — l'ancien tableau d'historique et l'anneau de répartition du coût ont été
 * retirés). Le détail d'une proposition s'ouvre en pop-up au clic sur une étape.
 */
@Component({
  selector: 'app-candidate-simulation-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    AccordionCardComponent, ButtonComponent, CardComponent, MetricCardComponent, PageComponent, PageHeaderComponent,
    SectionCardComponent, SectionTitleComponent, StatusBadgeComponent,
  ],
  templateUrl: './candidate-simulation-detail.component.html',
  styleUrl: './candidate-simulation-detail.component.scss',
})
export class CandidateSimulationDetailComponent {
  private readonly candSvc     = inject(CandidateSimulationService);
  private readonly translate   = inject(TranslateService);
  private readonly router      = inject(Router);
  private readonly route       = inject(ActivatedRoute);
  private readonly paysNames   = inject(PaysNamesService);
  private readonly listState   = inject(CandidateSimulationListStateService);
  private readonly permissions = inject(PermissionService);

  readonly candidateId = signal<number | null>(null);
  readonly loading     = signal(true);
  readonly error       = signal<string | null>(null);
  readonly history     = signal<CandidateCostApprovalDto[]>([]);
  /** Simulation affichée dans le panneau de détail — la plus récente par défaut. */
  readonly selectedId  = signal<number | null>(null);

  /** Pop-up de détail — `ModalService` de la lib (comme le traitement des bulletins), corps
   *  = `#detailTpl` : « Simulation #… · R… », répartition du coût et rubriques. S'ouvre au
   *  clic sur une ligne du tableau, l'icône 👁. */
  private readonly modalService = inject(ModalService);
  private readonly detailTpl = viewChild<TemplateRef<unknown>>('detailTpl');
  private detailModalRef: ModalRef | null = null;

  /** Ouvrir / dupliquer une simulation demande l'accès au simulateur. */
  readonly canOpenSimulator = this.permissions.hasAny(PAYROLL_SIMULATOR_PERMISSIONS);

  /** Lien vers la fiche candidat du recrutement (`/rh/candidates/:id`) — mêmes codes que la
   *  route RH (`VIEW_CANDIDATES`, …), qui sinon renverrait vers « accès refusé ». */
  readonly canOpenRhCandidate = this.permissions.hasAny(['VIEW_CANDIDATES', 'HR_ONBOARDING', 'EDIT_CANDIDATE', 'CREATE_CANDIDATE']);

  openRhCandidate(): void {
    const id = this.candidateId();
    if (id != null) this.router.navigateByUrl(`/rh/candidates/${id}`);
  }

  // ── Règles de paie qui ont servi aux propositions — pour écrire les rubriques et les
  //    avantages en clair (le snapshot n'a que leurs codes), comme /payroll/simulator/:id. ──
  private readonly payrollApi = inject(PayrollApiService);
  private readonly paramSets = signal<Map<number, ParameterSetDto>>(new Map());
  private readonly paramSetsRequested = new Set<number>();

  private loadParamSet(id: number | null | undefined): void {
    if (id == null || this.paramSetsRequested.has(id)) return;
    this.paramSetsRequested.add(id);
    this.payrollApi.getParameterSet(id).subscribe({
      next: ps => this.paramSets.update(m => new Map(m).set(id, ps)),
      error: () => { /* illisible pour cet utilisateur : les codes restent affichés */ },
    });
  }

  private selectedParamSet(): ParameterSetDto | null {
    const id = this.selected()?.snap.parameterSetId;
    return id != null ? this.paramSets().get(id) ?? null : null;
  }

  /** « Proposition n° 3 ». */
  roundLabel(index: number): string {
    return this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.ROUND_LABEL', { n: index });
  }

  /**
   * Fil de la négociation : une étape par proposition, la plus ancienne d'abord — ce que la
   * RH a proposé, puis la réponse de la DAF (contre-proposition, décision, note). Un clic
   * ouvre le même détail que le tableau.
   */
  readonly negotiation = computed(() =>
    this.rounds().map(r => ({
      id:       r.sim.id,
      title:    `${this.roundLabel(r.index)} · ${this.date(r.sim.submittedAt)}`,
      proposed: this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.TIMELINE_PROPOSED', { amount: this.money(r.sim.salaireNetRh, r.currency) }),
      asked:    r.sim.salaireNetCandidat
        ? this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.TIMELINE_ASKED', { amount: this.money(r.sim.salaireNetCandidat, r.currency) })
        : null,
      answer:   r.sim.status === 'PENDING'
        ? this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.TIMELINE_WAITING')
        : r.sim.contrePropSalaire
          ? this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.TIMELINE_COUNTER', { amount: this.money(r.sim.contrePropSalaire, r.currency) })
          : this.t(r.sim.status === 'APPROVED'
              ? 'PAYROLL.CANDIDATE_SIMULATION.DETAIL.TIMELINE_APPROVED'
              : 'PAYROLL.CANDIDATE_SIMULATION.DETAIL.TIMELINE_REJECTED'),
      note:     r.sim.approvalNotes || null,
      status:   { label: this.statusLabel(r.sim.status), variant: this.statusVariant(r.sim.status) },
      kind:     this.kindLabel(r.sim),
    })));

  constructor() {
    // La pop-up est attachée à l'application, pas à la page : la fermer si on quitte la fiche.
    inject(DestroyRef).onDestroy(() => this.detailModalRef?.close());

    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(p => {
      const id = Number(p.get('candidateId'));
      this.candidateId.set(Number.isFinite(id) ? id : null);
      this.load();
    });
  }

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  private readonly locale = computed(() => (this.translate.currentLang() ?? '').startsWith('en') ? 'en-US' : 'fr-FR');

  private num(v: number | null | undefined, digits = 0): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return new Intl.NumberFormat(this.locale(), { maximumFractionDigits: digits }).format(v);
  }

  money(v: number | null | undefined, currency: string): string {
    return v == null ? '—' : `${this.num(v)} ${currency}`.trim();
  }

  /** Montant d'une rubrique : `+` au crédit, `−` au débit. */
  signedMoney(v: number, currency: string): string {
    return `${v < 0 ? '−' : '+'} ${this.money(Math.abs(v), currency)}`;
  }

  private date(v: string | null | undefined, withTime = false): string {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat(this.locale(), withTime
      ? { dateStyle: 'short', timeStyle: 'short' }
      : { dateStyle: 'short' }).format(d);
  }

  load(): void {
    const id = this.candidateId();
    if (id == null) {
      this.loading.set(false);
      this.error.set(this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.NOT_FOUND'));
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.candSvc.getCandidateHistory(id).subscribe({
      next: h => {
        this.history.set(h ?? []);
        this.selectedId.set(this.latestOf(h ?? [])?.id ?? null);
        this.loading.set(false);
      },
      error: e => {
        this.history.set([]);
        this.error.set(e?.error?.message ?? this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.ERROR_HISTORY'));
        this.loading.set(false);
      },
    });
  }

  private latestOf(h: CandidateCostApprovalDto[]): CandidateCostApprovalDto | undefined {
    return [...h].sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))[0];
  }

  // ── Données ────────────────────────────────────────────────────────────────────────

  /** Chronologique : R1 = première soumission. */
  readonly rounds = computed<Round[]>(() =>
    [...this.history()]
      .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '') || a.id - b.id)
      .map((sim, i) => {
        const snap = this.candSvc.parseSnapshot(sim.simulationSnapshot);
        return { index: i + 1, sim, snap, currency: snap.localCurrency ?? '' };
      }),
  );
  readonly latest  = computed(() => this.rounds().at(-1) ?? null);
  readonly previous = computed(() => this.rounds().at(-2) ?? null);
  readonly selected = computed(() =>
    this.rounds().find(r => r.sim.id === this.selectedId()) ?? this.latest());

  /** Résumé de la liste quittée (affiché tant que l'historique n'est pas là ou s'il est vide). */
  private readonly summary = computed(() => {
    const id = this.candidateId();
    return id != null ? this.listState.candidate(id) : undefined;
  });

  readonly candidateName = computed(() => {
    const s = this.latest()?.sim;
    const first = s?.candidateFirstName ?? this.summary()?.firstName ?? '';
    const last  = s?.candidateLastName  ?? this.summary()?.lastName  ?? '';
    const name = `${first} ${last}`.trim();
    return name || this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.UNKNOWN_CANDIDATE', { id: this.candidateId() });
  });
  readonly position = computed(() => this.latest()?.sim.appliedPosition ?? this.summary()?.appliedPosition ?? null);
  readonly location = computed(() => this.latest()?.sim.candidateLocation ?? this.summary()?.candidateLocation ?? null);
  readonly paysId   = computed(() => this.latest()?.sim.paysId ?? this.summary()?.paysId ?? null);
  readonly status   = computed<Status | null>(() => this.latest()?.sim.status ?? this.summary()?.latestStatus ?? null);

  readonly headerBadges = computed<PageHeaderBadge[]>(() => {
    const s = this.status();
    return s ? [{ label: this.statusLabel(s), variant: this.statusVariant(s), size: 'sm', dot: true }] : [];
  });

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.CANDIDATE_SIMULATION.BREADCRUMB'), link: '/payroll/candidate-simulation' },
    { label: this.candidateName() },
  ]);

  /** Carte « Détails » de la colonne gauche. Pas de sous-titre d'en-tête (poste · lieu sont
   *  ici), ni de dates de première / dernière soumission (chaque étape du fil a la sienne). */
  readonly identityRows = computed<DetailRow[]>(() => {
    const r = this.rounds();
    const lastDecision = [...r].reverse().find(x => x.sim.approvedAt)?.sim.approvedAt;
    const pays = this.paysId();
    return [
      { key: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_POSITION'), value: this.position() || '—' },
      { key: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_ENTITY'),   value: this.location() || '—' },
      { key: this.t('PAYROLL.CANDIDATE_SIMULATION.PAYS_SELECT_LABEL'), value: pays != null ? this.paysNames.name(pays, `#${pays}`) : '—' },
      { key: this.t('PAYROLL.CANDIDATE_SIMULATION.CAND_COL_SIMULATIONS'), value: String(r.length || this.summary()?.simulationCount || 0) },
      { key: this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.LAST_DECISION'),    value: this.date(lastDecision) },
    ];
  });

  // ── KPI de la négociation (dernière soumission) ───────────────────────────────────

  readonly kpis = computed<Kpi[]>(() => {
    const l = this.latest();
    if (!l) return [];
    const cur = l.currency;
    const prevNet = this.previous()?.sim.salaireNetRh;
    const netRh = l.sim.salaireNetRh;
    const netDelta: MetricDelta | null = prevNet && netRh != null
      ? this.pctDelta((netRh - prevNet) / prevNet * 100, this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.VS_PREVIOUS'))
      : null;

    const asked = [...this.rounds()].reverse().find(r => r.sim.salaireNetCandidat)?.sim.salaireNetCandidat ?? null;

    const annual = l.snap.loadedCost != null ? l.snap.loadedCost * 12 : null;
    const annualEur = l.snap.loadedCostEur != null ? l.snap.loadedCostEur * 12 : null;
    const monthlyLine = [
      l.snap.loadedCost != null ? this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.PER_MONTH', { amount: this.money(l.snap.loadedCost, cur) }) : null,
      annualEur != null ? `≈ ${this.money(annualEur, 'EUR')}` : null,
    ].filter(Boolean).join(' · ');

    return [
      { label: this.t('PAYROLL.CANDIDATE_SIMULATION.KPI_NET_RH'), value: this.money(netRh, cur), delta: netDelta,
        options: { icon: 'payments' } },
      this.askedCard(asked, netRh, cur),
      { label: this.t('PAYROLL.CANDIDATE_SIMULATION.KPI_LOADED_ANNUAL'), value: this.money(annual, cur),
        delta: monthlyLine ? { value: monthlyLine, direction: 'neutral' } : null,
        options: { icon: 'account_balance', valueColor: 'text-primary' } },
      this.surcostCard(l, asked, cur, true),
    ];
  });

  /** « Net demandé » avec l'écart à l'offre dessous (« +8,5 % au-dessus de l'offre »). */
  private askedCard(asked: number | null, netRh: number | null | undefined, cur: string): Kpi {
    const gapPct = asked && netRh ? (asked - netRh) / netRh * 100 : null;
    const gapKey = gapPct == null ? null
      : gapPct > 0 ? 'PAYROLL.CANDIDATE_SIMULATION.DETAIL.GAP_ABOVE'
      : gapPct < 0 ? 'PAYROLL.CANDIDATE_SIMULATION.DETAIL.GAP_BELOW'
      : 'PAYROLL.CANDIDATE_SIMULATION.DETAIL.GAP_EQUAL';
    return {
      label: this.t('PAYROLL.CANDIDATE_SIMULATION.KPI_NET_CANDIDATE'),
      value: this.money(asked, cur),
      delta: gapKey ? { value: this.t(gapKey, { pct: this.num(Math.abs(gapPct!), 1) }), direction: 'neutral' } : null,
      options: {
        icon: 'person',
        ...(gapPct != null && gapPct > 0 ? { iconColor: 'text-warning', iconBg: 'bg-warning/10' } : {}),
      },
    };
  }

  /**
   * « Surcoût si la demande est acceptée » — ESTIMATION : (net demandé − net proposé) ×
   * coefficient de charge de la proposition (coût employeur ÷ net) × 12. L'impôt n'étant pas
   * proportionnel, ce n'est qu'un ordre de grandeur (« ≈ »).
   */
  private surcostCard(r: Round, asked: number | null, cur: string, last = false): Kpi {
    const net = r.snap.inputNet ?? r.sim.salaireNetRh;
    const coef = r.snap.loadedCost != null && net ? r.snap.loadedCost / net : null;
    const extra = asked != null && net && coef != null ? (asked - net) * coef * 12 : null;
    const sign = extra != null && extra < 0 ? '−' : '+';
    return {
      label: this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.KPI_SURCOST'),
      value: extra == null ? '—'
        : this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.SURCOST_VALUE', { amount: `${sign} ${this.money(Math.abs(extra), cur)}` }),
      delta: {
        value: asked == null
          ? this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.SURCOST_NO_ASK')
          : coef == null ? '' : this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.SURCOST_BASE', { coef: this.num(coef, 2) }),
        direction: 'neutral',
      },
      options: {
        icon: 'trending_up',
        ...(extra != null && extra > 0 ? { valueColor: 'text-warning', iconColor: 'text-warning', iconBg: 'bg-warning/10' } : {}),
        help: this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.SURCOST_HELP'),
        ...(last ? { helpPlacement: 'top' as const } : {}),
      },
    };
  }

  private pctDelta(pct: number, suffix: string): MetricDelta {
    const sign = pct > 0 ? '+' : '';
    return {
      value: `${sign}${this.num(pct, 1)} % ${suffix}`,
      direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral',
    };
  }

  // ── Pop-up de détail d'une proposition ──────────────────────────────────────────
  // De haut en bas : la décision de la DAF (ce que la RH cherche en l'ouvrant), trois
  // chiffres clés, la décomposition en bulletin (salaire du mois, puis coût pour
  // l'entreprise), les avantages et éléments du bulletin. Navigation ‹ précédente /
  // suivante › sans fermer la pop-up.

  /** Réponse de la DAF à la proposition ouverte : bandeau coloré en tête de pop-up. */
  readonly decision = computed(() => {
    const r = this.selected();
    if (!r) return null;
    const { sim, currency } = r;
    const counter = sim.contrePropSalaire ? this.money(sim.contrePropSalaire, currency) : null;
    const date = sim.status === 'PENDING' ? null : this.date(sim.approvedAt);
    let tone: 'success' | 'danger' | 'warning';
    let icon: string;
    let title: string;
    if (sim.status === 'PENDING') {
      tone = 'warning'; icon = 'schedule';
      title = this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.DECISION_PENDING');
    } else if (sim.status === 'APPROVED') {
      tone = 'success'; icon = 'task_alt';
      title = counter
        ? this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.DECISION_APPROVED_AT', { amount: counter })
        : this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.DECISION_APPROVED');
    } else if (counter) {
      tone = 'warning'; icon = 'swap_horiz';
      title = this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.DECISION_COUNTER', { amount: counter });
    } else {
      tone = 'danger'; icon = 'block';
      title = this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.DECISION_REJECTED');
    }
    return {
      tone, icon, title, note: sim.approvalNotes || null,
      date: date && date !== '—' ? this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.DECISION_ON', { date }) : null,
    };
  });

  /** Proposition précédente de la ouverte (pour l'écart « vs n° 2 » et la navigation). */
  private readonly selectedPrevious = computed(() => {
    const r = this.selected();
    return r ? this.rounds().find(x => x.index === r.index - 1) ?? null : null;
  });
  readonly selectedNext = computed(() => {
    const r = this.selected();
    return r ? this.rounds().find(x => x.index === r.index + 1) ?? null : null;
  });
  readonly selectedPrev = this.selectedPrevious;

  /** Net proposé de la proposition ouverte et son évolution vs la précédente. */
  readonly keyFigures = computed(() => {
    const r = this.selected();
    if (!r) return null;
    const { sim, currency } = r;
    const netRh = sim.salaireNetRh ?? null;
    const prevNet = this.selectedPrevious()?.sim.salaireNetRh;
    const evolution = prevNet && netRh != null
      ? this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.VS_ROUND', {
          pct: `${netRh >= prevNet ? '+' : '−'}${this.num(Math.abs((netRh - prevNet) / prevNet * 100), 1)} %`,
          n: r.index - 1,
        })
      : null;
    return { netRh: this.money(netRh, currency), evolution };
  });

  /** Les trois chiffres clés en `daf-metric-card` (comme les tuiles de la page) : net
   *  proposé (évolution dessous), net demandé (écart à l'offre dessous), surcoût estimé. */
  readonly figureCards = computed<Kpi[]>(() => {
    const k = this.keyFigures();
    const r = this.selected();
    if (!k || !r) return [];
    // Mêmes tuiles que la page, pour la proposition ouverte : l'écart passe sous le net
    // demandé, et le surcoût estimé remplace l'ancienne tuile « Écart ».
    const asked = r.sim.salaireNetCandidat ?? null;
    return [
      { label: this.t('PAYROLL.CANDIDATE_SIMULATION.KPI_NET_RH'), value: k.netRh,
        delta: k.evolution ? { value: k.evolution, direction: 'neutral' } : null,
        options: { icon: 'payments' } },
      this.askedCard(asked, r.sim.salaireNetRh, r.currency),
      this.surcostCard(r, asked, r.currency),
    ];
  });

  /** Décomposition en bulletin : salaire du mois (brut − cotisations − impôt = net), puis
   *  coût pour l'entreprise (+ cotisations patronales = coût employeur, mois et an). */
  readonly breakdown = computed(() => {
    const r = this.selected();
    if (!r) return null;
    const { sim, snap, currency: c } = r;
    const m = (v: number | null | undefined) => this.money(v, c);
    const annual = snap.loadedCost != null ? snap.loadedCost * 12 : null;
    const fx = [
      snap.loadedCostEur != null ? `≈ ${this.money(snap.loadedCostEur * 12, 'EUR')}` : null,
      snap.loadedCostUsd != null ? `≈ ${this.money(snap.loadedCostUsd * 12, 'USD')}` : null,
    ].filter(Boolean).join(' · ');
    // UN seul tableau, comme un bulletin, sans doublon : brut (et ses éléments « dont »),
    // − cotisations − impôt = net, + avantages exonérés (dont…) + cotisations patronales
    // = coût employeur. Les avantages exonérés sont déduits de l'identité du moteur
    // (coût = brut + exonérés + patronales) : la ligne retombe exactement sur le coût.
    const D = 'PAYROLL.CANDIDATE_SIMULATION.DETAIL.';
    const rows: { key: string; value: string; kind: 'base' | 'sub' | 'minus' | 'plus' | 'total' }[] = [];
    const items = this.rubriquesRows();
    rows.push({ key: this.t(`${D}GROSS`), value: m(snap.gross), kind: 'base' });
    for (const x of items.filter(x => +(x['amount'] as number) > 0)) {
      rows.push({ key: this.t(`${D}INCLUDING`, { label: x['code'] }), value: m(+(x['amount'] as number)), kind: 'sub' });
    }
    rows.push({ key: this.t(`${D}EMPLOYEE_CHARGES`), value: m(snap.employeeCharges), kind: 'minus' });
    rows.push({ key: this.t(`${D}IRPP`), value: m(snap.irppAmount), kind: 'minus' });
    for (const x of items.filter(x => +(x['amount'] as number) < 0)) {
      rows.push({ key: this.t(`${D}INCLUDING`, { label: x['code'] }), value: `− ${m(Math.abs(+(x['amount'] as number)))}`, kind: 'sub' });
    }
    rows.push({ key: this.t(`${D}NET`), value: m(snap.inputNet ?? sim.salaireNetRh), kind: 'total' });
    const exempt = snap.loadedCost != null && snap.gross != null && snap.employerCharges != null
      ? snap.loadedCost - snap.gross - snap.employerCharges : 0;
    if (exempt > 0.5) {
      rows.push({ key: this.t(`${D}EXEMPT_BENEFITS`), value: m(exempt), kind: 'plus' });
      const taken = new Set(items.map(x => x['code'] as string));
      for (const label of this.benefits().filter(b => !taken.has(b))) {
        rows.push({ key: this.t(`${D}INCLUDING`, { label }), value: '', kind: 'sub' });
      }
    }
    rows.push({ key: this.t(`${D}EMPLOYER_CHARGES`), value: m(snap.employerCharges), kind: 'plus' });
    rows.push({ key: this.t('PAYROLL.CANDIDATE_SIMULATION.KPI_LOADED_MONTHLY'), value: m(snap.loadedCost), kind: 'total' });
    return {
      rows,
      costMonthly: m(snap.loadedCost),
      costAnnual: this.t(`${D}PER_YEAR`, { amount: m(annual) }) + (fx ? `  (${fx})` : ''),
      rules: sim.fiscalYear ? this.t(`${D}RULES_YEAR`, { year: sim.fiscalYear }) : null,
    };
  });

  /** « Détail du calcul » de la pop-up : replié à l'ouverture (l'essentiel tient au-dessus). */
  readonly calcOpen = signal(false);

  /** Sous-titre de la pop-up : « Proposition n° 3 · 22/10/2026 · Offre · CDI ». */
  private modalSubtitle(r: Round): string {
    return [
      this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.SELECTED_TITLE', { round: r.index, date: this.date(r.sim.submittedAt) }),
      this.kindLabel(r.sim),
      r.sim.contractTypeLabel || r.sim.contractTypeCode || null,
    ].filter(Boolean).join(' · ');
  }

  private isEn(): boolean {
    return (this.translate.currentLang() ?? '').startsWith('en');
  }

  /** Nature traduite (« Avantage », « Retenue »…), le code en repli. */
  private natureText(nature: string | null): string {
    if (!nature) return '—';
    const key = `PAYROLL.PARAMETER_SETS.NATURE.${nature}.LABEL`;
    const label = this.t(key);
    return label === key ? nature : label;
  }

  /** Rubriques de la simulation sélectionnée — liste compacte de la pop-up (montant signé),
   *  en clair : libellé lu dans les règles de paie utilisées, nature traduite ; le code ne
   *  reste qu'en repli si ces règles ne sont pas lisibles. */
  readonly rubriquesRows = computed<TableRow[]>(() => {
    const defs = new Map((this.selectedParamSet()?.rubriques ?? []).map(d => [d.code, d]));
    return parseRubriquesApplied(this.selected()?.snap.rubriquesApplied)
      .filter(rb => rb.amount)
      .map(rb => {
        const def = defs.get(rb.code);
        return {
          id:       rb.code,
          code:     (this.isEn() && def?.labelEn) || def?.labelFr || rb.code,
          nature:   this.natureText(rb.nature ?? def?.nature ?? null),
          calcMode: rb.calcMode === 'FORMULE' ? 'ƒ(x)' : rb.calcMode,
          amount:   rb.direction === 'DEBIT' ? -rb.amount : rb.amount,
        };
      });
  });

  /** Avantages appliqués, en clair (libellé des règles de paie utilisées, code en repli). */
  readonly benefits = computed<string[]>(() => {
    const raw = this.selected()?.snap.benefitsApplied;
    if (!raw) return [];
    const defs = new Map((this.selectedParamSet()?.benefits ?? []).map(b => [b.benefitCode, b]));
    try {
      const parsed = JSON.parse(raw) as Array<{ code?: string }>;
      return Array.isArray(parsed)
        ? parsed.map(b => b.code).filter((c): c is string => !!c).map(c => {
            const def = defs.get(c);
            return (this.isEn() && def?.benefitLabelEn) || def?.benefitLabelFr || c;
          })
        : [];
    } catch {
      return [];
    }
  });

  /** Proposition voisine dans la pop-up (‹ précédente / suivante ›), sans la fermer. */
  goToRound(r: Round | null): void {
    if (r) this.selectById(r.sim.id);
  }

  // ── Libellés ──────────────────────────────────────────────────────────────────────

  /** « Offre » ou « Pré-validation » — sans le numéro technique de l'offre. */
  kindLabel(sim: CandidateCostApprovalDto): string {
    return sim.jobOfferId
      ? this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.KIND_OFFER')
      : this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.KIND_PREVALIDATION');
  }

  statusLabel(s: string): string { return this.t(`PAYROLL.CANDIDATE_SIMULATION.STATUS.${s}`); }

  statusVariant(s: string): BadgeVariant {
    switch (s) {
      case 'APPROVED': return 'success';
      case 'REJECTED': return 'danger';
      default:         return 'warning';
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────────────

  /** Ligne du tableau ou icône 👁 → ouvre la pop-up sur cette simulation. */
  selectById(id: number): void {
    this.selectedId.set(id);
    const r = this.selected();
    const tpl = this.detailTpl();
    if (!r || !tpl) return;
    // Libellés des rubriques et avantages : règles de paie de CETTE proposition (la pop-up
    // se met à jour à leur arrivée).
    this.loadParamSet(r.snap.parameterSetId);

    this.detailModalRef?.close();
    const buttons: ModalButton[] = [
      { label: this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.CLOSE'), variant: 'secondary', action: ref => ref.close() },
    ];
    if (this.canOpenSimulator && r.snap.id) {
      // Plus de « Voir le calcul détaillé » : la simulation d'origine n'existe plus dans la
      // base paie pour les propositions existantes (le simulateur retombait sur un formulaire
      // vide). Les montants affichés viennent de la copie enregistrée avec la proposition.
      buttons.push({
        label: this.t('PAYROLL.CANDIDATE_SIMULATION.DETAIL.DUPLICATE_THIS'),
        variant: 'secondary',
        action: ref => { ref.close(); this.duplicateInSimulator(r); },
      });
    }
    // La personne en titre ; « Proposition n° · date · type · contrat » en sous-titre.
    this.detailModalRef = this.modalService.open({
      title:    this.candidateName(),
      subtitle: this.modalSubtitle(r),
      icon:     'request_quote',
      size:     'lg',
      body:     tpl,
      buttons,
    });
  }

  duplicateInSimulator(r: Round | null): void {
    if (r?.snap.id) this.router.navigate(['/payroll/simulator/new'], { queryParams: { from: r.snap.id } });
  }
}
