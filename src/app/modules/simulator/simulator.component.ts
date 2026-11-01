import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
  effect,
  untracked,
  OnDestroy,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  PayrollApiService,
  SimulationResultDto,
  SimulationMode,
  ParameterSetDto,
  PaysDto,
  RubriqueAppliedItem,
  SocialChargeRateDto,
  PayrollRubriqueDto,
  parseRubriquesApplied,
} from '../../core/payroll-api.service';
import { HrRefApiService, ConfigurableListValueDto } from '../../core/hr-ref-api.service';
import { UserStore } from '../../core/user.store';
import { NotificationService } from '../../core/notification.service';
import { readBlobError, saveBlob } from '../../shared/blob-download';
import { HrProfileService, contractTypeLabel, type EmployeeListItem } from '../../core/hr-profile.service';
import { searchTableRows, tableTools } from '../../shared/table-tools';
import { Subject, takeUntil, forkJoin, of, combineLatest } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent,
  CardComponent,
  CheckboxComponent,
  DataTableComponent,
  FieldMessageComponent,
  FormFieldComponent,
  MetricCardComponent,
  PageComponent,
  PageHeaderComponent,
  RadioGroupComponent,
  SectionCardComponent,
  SearchToolbarComponent,
  SelectComponent,
  StatusBadgeComponent,
  StepperComponent,
  TabsComponent,
} from '@khalilrebhiitec/daf360';
import type {
  BadgeOptions,
  BreadcrumbItem,
  MetricCardOptions,
  MetricDelta,
  BadgeCell,
  BadgeVariant,
  TabItem,
  PageHeaderBadge,
  RadioOption,
  SelectOption,
  StepperStep,
  StepperConfig,
  ButtonOptions,
  TableColumn,
  TableConfig,
  TableRow,
} from '@khalilrebhiitec/daf360';

/** Who the simulation is for. Drives which identity fields are collected, and whether
 *  the backend hydrates the contract/grade/discipline from the RH profile. */
export type SimulationSubject = 'CANDIDATE' | 'EMPLOYEE';

/** State of the active parameter set for the country currently selected. */
export type ParameterSetState = 'IDLE' | 'LOADING' | 'READY' | 'MISSING';

/** One slice of the loaded cost, for the 10px stacked bar and the table under it. */
interface BreakdownSegment {
  /** Identifiant stable du segment — sert de `track`, contrairement au libellé traduit. */
  key:    string;
  label:  string;
  amount: number;
  /** Share of the loaded cost, 0–100. */
  pct:    number;
  /** Complete literal classes — a runtime-built `bg-${x}` compiles to nothing (§3). */
  bar:    string;
  dot:    string;
}

/** One line of the IRPP scale, parsed out of `ParameterSetDto.irppBrackets`. */
interface IrppBracketRow {
  lower: number;
  upper: number | null;
  rate:  number;
}

@Component({
  selector: 'app-simulator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule, TranslatePipe,
    ButtonComponent, CardComponent, CheckboxComponent,
    DataTableComponent, FieldMessageComponent, FormFieldComponent, MetricCardComponent,
    PageComponent, PageHeaderComponent, RadioGroupComponent, SearchToolbarComponent,
    SectionCardComponent, SelectComponent, StatusBadgeComponent, StepperComponent,
    TabsComponent,
  ],
  templateUrl: './simulator.component.html',
  // Squelette de la FICHE uniquement (deux colonnes, rangées de tuiles, panneau de détails),
  // repris de `affaire-detail.component.ts` de la facturation. En styles de composant et non
  // en classes Tailwind neuves : le styles.css d'un remote ne contient que les classes déjà
  // vues par son scan, une classe inédite (`lg:w-[30%]`…) n'existerait pas tant que le
  // remote n'est pas reconstruit, et la fiche retomberait en une colonne. Le reste (couleurs,
  // typo, espacements internes) reste en classes de la lib.
  styles: [`
    /* ── Les deux colonnes ─────────────────────────────────────────────── */
    .detail-split { display: flex; flex-wrap: wrap; gap: 2rem; align-items: flex-start; }
    .detail-aside { flex: 0 1 30%; min-width: 320px; max-width: 420px; }
    .detail-aside__sticky { position: sticky; top: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }
    .detail-main  { flex: 1 1 480px; min-width: 0; display: flex; flex-direction: column; gap: 1.5rem; }

    /* ── Rangées de cartes : des grilles à colonnes égales ─────────────── */
    .kpi-row, .tile-row { display: grid; gap: 1.5rem; align-items: stretch; }
    .kpi-row  { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
    .tile-row { grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); }
    .kpi-cell, .tile-cell { display: flex; flex-direction: column; min-width: 0; }
    .kpi-cell  { min-height: 118px; }
    .tile-cell { min-height: 210px; height: auto; }

    @media (max-width: 1400px) {
      .detail-split { gap: 1.5rem; }
      .detail-aside { min-width: 300px; max-width: 360px; }
    }
    @media (max-width: 1150px) {
      .detail-aside { flex: 1 1 100%; max-width: none; min-width: 0; }
      .detail-aside__sticky { position: static; }
    }
    @media (max-width: 640px) {
      .kpi-row, .tile-row { gap: 1rem; }
    }

    /* ── Panneau de détails (colonne gauche) — mêmes styles que la fiche affaire ── */
    .dp { display: flex; flex-direction: column; gap: 12px; }
    .dp-card { display: flex; flex-direction: column; }
    .dp-block { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; }
    .dp-label {
      margin: 0; font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
      color: var(--color-on-surface-variant, #44474c);
    }
    .dp-rule { height: 1px; background: var(--color-outline-variant, #c5c6cd); opacity: .55; }
    .dp-subject { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
    .dp-subject__name {
      flex: 1 1 auto; min-width: 0; font-size: 16px; font-weight: 600;
      color: var(--color-on-surface, #191c1e); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dp-subject__meta { flex-shrink: 0; font-size: 11px; color: var(--color-on-surface-variant, #44474c); }
    .dp-rows { margin: 0; }
    /* Pas de filet entre les lignes d'un bloc : seul « .dp-rule » sépare les blocs (Profil,
       Contexte, Entrées du calcul). */
    .dp-row {
      display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
      padding: 5px 0;
    }
    .dp-row:last-child { padding-bottom: 0; }
    .dp-row__key { margin: 0; font-size: 12px; color: var(--color-on-surface-variant, #44474c); }
    .dp-row__val {
      margin: 0; font-size: 12.5px; font-weight: 600; text-align: right;
      color: var(--color-on-surface, #191c1e);
    }
    .dp-flag { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--color-warning, #b45309); }
    .dp-flag__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
    .dp-flag--ok { color: var(--color-tertiary, #00c1ad); }

    /* ══ FORMULAIRE — squelette de l'assistant « Nouvelle affaire » ══════════
       Repris de affaire-wizard.component.scss (facturation), jetons SCSS résolus en
       valeurs : carte de formulaire, en-tête d'étape, messages de pied, barre d'actions
       flottante. */
    .sim-wizard { display: flex; flex-direction: column; gap: 1rem; }

    .form-card {
      overflow: hidden; background: #ffffff; border-radius: 16px;
      border: 1px solid #f1f5f9; box-shadow: 0 2px 8px rgba(0,0,0,.07), 0 1px 3px rgba(0,0,0,.05);
    }
    .card-head {
      display: flex; align-items: center; gap: 14px; padding: 24px 32px 20px;
      border-bottom: 1px solid #f1f5f9; background: rgba(121, 215, 190, 0.04);
    }
    .card-head__icon {
      width: 44px; height: 44px; border-radius: 12px; background: rgba(0, 107, 88, 0.1);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #006b58;
    }
    .card-head__icon .material-symbols-outlined { font-size: 22px; }
    .card-head__title { font-size: 1.1rem; font-weight: 700; color: #0b1c30; margin: 0 0 3px; line-height: 1.3; }
    .card-head__sub { font-size: 0.8125rem; color: #64748b; margin: 0; line-height: 1.5; }
    /* État de l'étape (badge, « Tout cocher ») à droite du titre — pas de ligne à lui
       dans le corps de la carte. */
    .card-head__aside { margin-left: auto; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    .step-body { padding: 28px 32px; }

    .validation-hint {
      margin: 0 32px 12px; padding: 10px 14px; background: rgba(26, 107, 124, 0.06);
      border: 1px solid rgba(26, 107, 124, 0.18); border-radius: 10px;
      display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; color: #1a6b7c; line-height: 1.5;
    }
    .validation-hint .material-symbols-outlined { font-size: 15px; flex-shrink: 0; margin-top: 1px; }
    .error-banner {
      margin: 0 32px 16px; padding: 12px 16px; background: #fee2e2; border: 1px solid #fca5a5;
      border-radius: 12px; display: flex; align-items: flex-start; gap: 10px; font-size: 13px; color: #991b1b;
    }
    .error-banner .material-symbols-outlined { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
    .saving-hint {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 8px 0; font-size: 13px; color: #6b7280;
    }
    .saving-spin { animation: sim-spin 0.8s linear infinite; font-size: 16px; }
    @keyframes sim-spin { to { transform: rotate(360deg); } }

    /* Barre d'actions : sticky dans le flux (pas fixed) — voir le gabarit. */
    .action-bar {
      display: block; position: sticky; bottom: 1rem; z-index: 40;
      width: 100%; max-width: 820px; margin-inline: auto;
    }
    .action-bar__inner { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
    .action-bar__side { display: flex; flex: 0 0 auto; align-items: center; gap: 0.5rem; }
    .action-bar__side--end { justify-content: flex-end; }
    .action-bar__rail {
      flex: 1 1 auto; min-width: 0; padding-inline: 0.875rem;
      border-inline: 1px solid var(--color-outline-variant);
    }
    .footer-action {
      display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; border: none;
      background: none; border-radius: 8px; font: inherit; font-size: 13px; font-weight: 600;
      color: var(--color-on-surface-variant); cursor: pointer; transition: color 0.15s;
    }
    .footer-action .material-symbols-outlined { font-size: 18px; }
    .footer-action:hover:not(:disabled) { color: var(--color-teal); }
    .footer-action:focus-visible { outline: 2px solid var(--color-teal); outline-offset: 2px; }
    .footer-action:disabled { color: var(--color-outline); cursor: not-allowed; }

    @media (max-width: 720px) {
      .action-bar__rail {
        order: 1; flex-basis: 100%; padding-inline: 0; padding-top: 0.75rem;
        border-inline: none; border-top: 1px solid var(--color-outline-variant);
      }
      .action-bar__side { flex: 1 1 auto; }
    }
    @media (max-width: 1100px) {
      .step-body { padding: 20px 24px; }
      .card-head { padding: 18px 24px 16px; }
      .validation-hint, .error-banner { margin-left: 24px; margin-right: 24px; }
    }
    @media (max-width: 768px) {
      .card-head { padding: 14px 16px 12px; gap: 10px; }
      .card-head__icon { width: 36px; height: 36px; }
      .card-head__icon .material-symbols-outlined { font-size: 18px; }
      .card-head__title { font-size: 0.95rem; }
      .step-body { padding: 16px; }
      .validation-hint, .error-banner { margin-left: 16px; margin-right: 16px; }
    }
    @media (max-width: 480px) {
      .step-body { padding: 12px; }
      .card-head { padding: 12px 12px 10px; }
    }
  `],
})
export class SimulatorComponent implements OnDestroy {
  private readonly api      = inject(PayrollApiService);
  private readonly hrRef    = inject(HrRefApiService);
  private readonly hrProfiles = inject(HrProfileService);
  private readonly fb       = inject(FormBuilder);
  private readonly translate = inject(TranslateService);
  private readonly notify   = inject(NotificationService);
  private readonly router   = inject(Router);
  private readonly route    = inject(ActivatedRoute);
  readonly userStore        = inject(UserStore);

  /**
   * Fiche résultat (`/payroll/simulator/:id`) ou formulaire (`/payroll/simulator/new`) —
   * piloté par l'URL (`onRouteChange`). Les deux partagent ce composant : `new` ↔ `:id`
   * ne fait que changer le paramètre, le formulaire rempli reste donc en place.
   */
  readonly resultView = signal(false);
  /** Lecture d'une simulation par son URL (`GET /simulations/:id`), ou de la source d'un
   *  « Dupliquer » (`new?from=:id`). */
  readonly resultLoading = signal(false);
  readonly loadError     = signal<string | null>(null);
  /** Contrat et avantages à reposer une fois le référentiel du pays chargé (pré-remplissage) :
   *  `loadCountryData` les écraserait sinon par leurs valeurs par défaut. */
  private pendingPrefill: { contractType: string; benefitCodes: string[] | null } | null = null;
  /** Id de la simulation dont le formulaire a été pré-rempli — un seul pré-remplissage. */
  private prefilledFrom: number | null = null;
  private readonly destroy$ = new Subject<void>();

  /**
   * Traduction synchrone pour tout ce qui ne passe PAS par le pipe : libellés d'options,
   * badges, titres d'étapes, messages d'erreur — la lib les reçoit en `string`, pas en
   * gabarit. `currentLang()` est lu à chaque appel : c'est ce qui inscrit le signal de
   * langue dans le `computed` appelant, donc ce qui retraduit l'écran quand l'utilisateur
   * change de langue dans le shell (les catalogues sont préchargés dans `app.routes.ts`,
   * `instant()` ne peut donc pas rendre la clé brute au premier passage).
   */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  /** Locale de formatage des nombres, alignée sur la langue active. */
  private readonly numberLocale = computed(() =>
    this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR',
  );

  /**
   * First reference load only — drives `daf-page [loading]`, which swaps the whole page
   * (header included) for the library skeleton. Kept strictly separate from `loading`,
   * which every "Simuler" click flips: wiring the skeleton to that one would blank the
   * form the user had just filled in (UI-PLAYBOOK §5).
   */
  readonly firstLoad     = signal(true);
  readonly loading       = signal(false);
  readonly error         = signal<string | null>(null);
  readonly result        = signal<SimulationResultDto | null>(null);
  readonly pdfGenerating = signal(false);
  readonly xlsxGenerating = signal(false);

  // ── Reference data, all straight from the DB ───────────────────────────────
  /** `GET /api/payroll/ref/pays` — the payroll service's synced country reference. */
  readonly paysList    = signal<PaysDto[]>([]);
  /** `GET /api/hr/lists/GRADE` — RH's configurable list, global + country values. */
  readonly grades      = signal<ConfigurableListValueDto[]>([]);
  /** `GET /api/hr/lists/DISCIPLINE` — same list mechanism. */
  readonly disciplines = signal<ConfigurableListValueDto[]>([]);
  /** `GET /api/payroll/parameter-sets/active` — rates, benefits and the IRPP scale. */
  readonly activePs    = signal<ParameterSetDto | null>(null);
  readonly psState     = signal<ParameterSetState>('IDLE');

  readonly selectedCodes = signal<Set<string>>(new Set());
  /** Candidate (free-text identity) or collaborator (hydrated by the backend from RH). */
  readonly subject       = signal<SimulationSubject>('CANDIDATE');
  /** Current simulation direction — drives the segmented toggle and conditional input. */
  readonly mode          = signal<SimulationMode>('NET_TO_BRUT');
  /** Monthly or yearly input — the API always receives monthly figures; yearly values are divided by 12. */
  readonly period        = signal<'MONTHLY' | 'YEARLY'>('MONTHLY');

  readonly form = this.fb.group({
    paysId:         [null as number | null, [Validators.required]],
    profileUserId:  [null as number | null],
    inputNet:       [null as number | null, [Validators.required, Validators.min(1)]],
    inputGross:     [null as number | null],  // used when mode = BRUT_TO_NET
    contractType:   ['CDI'],
    joursTravailes: [22, [Validators.min(1), Validators.max(31)]],
    candidateLabel: [''],
    poste:          [''],
    grade:          [''],
    discipline:     [''],
  });

  /** Reactive mirror of the form, so computeds re-run when a control changes. */
  private readonly formValue = signal(this.form.getRawValue());

  // ── Selected country ───────────────────────────────────────────────────────

  readonly selectedPaysId = computed(() => this.formValue().paysId);

  readonly selectedPays = computed((): PaysDto | null => {
    const id = this.selectedPaysId();
    return id == null ? null : this.paysList().find(p => p.id === id) ?? null;
  });

  /**
   * Currency shown next to the amounts. The country's `devise` before a run, the
   * result's own `localCurrency` after one — they agree, but the result is authoritative
   * (it is what the engine actually used).
   */
  readonly currency = computed(() =>
    this.result()?.localCurrency ?? this.selectedPays()?.devise ?? '',
  );

  // ── Parameter set ──────────────────────────────────────────────────────────

  readonly availableBenefits = computed(() => this.activePs()?.benefits ?? []);

  /**
   * Contract types offered by the active parameter set's social-charge rates — i.e. the
   * ones the engine can actually cost. There is no hardcoded fallback list any more: a
   * country with no active parameter set can't be simulated at all, and offering
   * "CDI, CDD, STAGE, CIVP" there only produced a 500 on submit.
   */
  readonly availableContractTypes = computed((): string[] => {
    const rates = this.activePs()?.socialChargeRates ?? [];
    return [...new Set(rates.map(r => r.contractType))].sort();
  });

  // ── Jeu de paramètres UTILISÉ par la simulation affichée ─────────────────────
  // La fiche montre les taux et le barème du jeu qui a servi au calcul
  // (`result.parameterSetId`), pas le jeu actif du pays : un jeu ACTIF ou ARCHIVÉ n'est plus
  // modifiable, ce sont donc exactement les règles du calcul. Si l'utilisateur n'a pas le
  // droit de le lire (ou s'il est introuvable), `usedPs` reste null et les onglets
  // « Charges appliquées » / « Barème IRPP appliqué » ne s'affichent pas.

  readonly usedPs = signal<ParameterSetDto | null>(null);
  private usedPsLoadedFor: number | null = null;

  private readonly loadUsedPs = effect(() => {
    const r = this.result();
    const id = this.resultView() ? r?.parameterSetId ?? null : null;
    if (id == null || id === this.usedPsLoadedFor) return;
    this.usedPsLoadedFor = id;
    this.usedPs.set(null);
    untracked(() => this.api.getParameterSet(id)
      .pipe(catchError(() => of(null)), takeUntil(this.destroy$))
      .subscribe(ps => { if (this.usedPsLoadedFor === id) this.usedPs.set(ps); }));
  });

  /** Lignes de charges du jeu UTILISÉ, pour le contrat de la simulation. */
  readonly applicableCharges = computed((): SocialChargeRateDto[] => {
    const contract = this.result()?.contractType;
    return (this.usedPs()?.socialChargeRates ?? [])
      .filter(r => r.contractType === contract)
      .sort((a, b) => (a.evalOrder ?? 0) - (b.evalOrder ?? 0));
  });

  /** Tranches IRPP stockées en JSON, `{lower,upper,rate}` avec `{min,max}` acceptés en
   *  alias (le moteur lit les deux). */
  private parseBrackets(raw: string | null | undefined): IrppBracketRow[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Array<Record<string, number | null>>;
      return parsed
        .map(b => ({
          lower: Number(b['lower'] ?? b['min'] ?? 0),
          upper: b['upper'] ?? b['max'] ?? null,
          rate:  Number(b['rate'] ?? 0),
        }))
        .map(b => ({ ...b, upper: b.upper == null ? null : Number(b.upper) }))
        .sort((a, b) => a.lower - b.lower);
    } catch {
      return [];
    }
  }

  /** Barème du jeu ACTIF du pays — aide de l'étape 1 du formulaire. */
  readonly irppBrackets = computed(() => this.parseBrackets(this.activePs()?.irppBrackets));

  /** Barème du jeu UTILISÉ par la simulation — onglet « Barème IRPP appliqué ». */
  readonly usedIrppBrackets = computed(() => this.parseBrackets(this.usedPs()?.irppBrackets));

  /** Everything needed before the "Simuler" button means anything. */
  readonly blockingReason = computed((): string | null => {
    if (this.selectedPaysId() == null) return this.t('PAYROLL.SIMULATOR.BLOCKING.NO_PAYS');
    if (this.psState() === 'LOADING')  return this.t('PAYROLL.SIMULATOR.BLOCKING.LOADING');
    if (this.psState() === 'MISSING')  {
      return this.t('PAYROLL.SIMULATOR.BLOCKING.NO_PARAMETER_SET');
    }
    if (this.subject() === 'EMPLOYEE' && this.formValue().profileUserId == null) {
      return this.t('PAYROLL.SIMULATOR.BLOCKING.NO_EMPLOYEE');
    }
    // A candidate has no RH profile to fall back on, so a contract the referential
    // actually prices must be chosen. A collaborator may leave it empty — the backend
    // then takes the one on the HR fiche.
    if (this.subject() === 'CANDIDATE' && !this.formValue().contractType) {
      return this.t('PAYROLL.SIMULATOR.BLOCKING.NO_CONTRACT');
    }
    return null;
  });

  readonly canSimulate = computed(() =>
    !this.blockingReason() && !this.amountError() && !this.loading(),
  );

  /** Message under the amount field — the one control the form's own validators cover. */
  readonly amountError = computed((): string | null => {
    const v = this.formValue();
    const amount = this.mode() === 'NET_TO_BRUT' ? v.inputNet : v.inputGross;
    if (amount == null || (amount as unknown as string) === '') {
      return this.t('PAYROLL.SIMULATOR.BLOCKING.AMOUNT_REQUIRED');
    }
    if (Number(amount) <= 0) return this.t('PAYROLL.SIMULATOR.BLOCKING.AMOUNT_POSITIVE');
    return null;
  });

  // ── Result-derived state ───────────────────────────────────────────────────

  readonly convergenceWarning = computed(() => {
    const r = this.result();
    return r && !r.convergenceOk;
  });

  /** Rubrique lines with their computed amounts, parsed from the JSON blob. */
  readonly parsedRubriques = computed((): RubriqueAppliedItem[] => {
    const r = this.result();
    return r ? parseRubriquesApplied(r.rubriquesApplied) : [];
  });

  // ── daf-data-table columns/rows — result view (read-only) ─────────────────
  // Same approach as the parameter-sets page, which shows the same charges/rubriques.

  /**
   * Tableau « Rubriques », lisible par un non-spécialiste :
   *   Rubrique — le LIBELLÉ (« Prime de rendement »), lu dans le jeu de paramètres utilisé
   *              (`usedPs`, chargé pour les onglets de taux) ; le code en repli si ce jeu
   *              n'a pas pu être lu ;
   *   Nature   — Prime / Indemnité / Avantage / Retenue, traduite, en pastille de couleur ;
   *   Calcul   — en clair : « 5 % du brut », « 60,00 TND / mois », « 3,50 TND / jour »… ;
   *   Montant  — signé (+ gain, − retenue).
   * Textes formatés à gauche, flèche au bord droit, tri sur les valeurs brutes (`_…`).
   */
  readonly rubriquesColumns = computed((): TableColumn[] => [
    { key: 'label',  label: this.t('PAYROLL.SIMULATOR.RUBRIQUES.COL_RUBRIQUE'), sortable: true },
    { key: 'nature', label: this.t('PAYROLL.SIMULATOR.RUBRIQUES.COL_NATURE'), type: 'badge', sortable: true,
      sortAccessor: row => (row['nature'] as BadgeCell).label },
    { key: 'calc',   label: this.t('PAYROLL.SIMULATOR.RUBRIQUES.COL_CALC'), sortable: true },
    { key: 'amount', label: this.t('PAYROLL.SIMULATOR.RUBRIQUES.COL_AMOUNT'), sortable: true,
      sortAccessor: row => row['_amount'] as number },
  ]);

  /** Définition d'une rubrique dans le jeu UTILISÉ (libellé, taux, montant paramétré). */
  private readonly rubriqueDefs = computed(() =>
    new Map((this.usedPs()?.rubriques ?? []).map(d => [d.code, d])));

  private static readonly NATURE_VARIANT: Record<string, BadgeVariant> = {
    PRIME: 'primary', INDEMNITE: 'secondary', AVANTAGE: 'success', RETENUE: 'danger',
  };

  readonly rubriquesRows = computed((): TableRow[] => {
    const cur = this.currency();
    const isEn = (this.translate.currentLang() ?? '').startsWith('en');
    const defs = this.rubriqueDefs();
    return this.parsedRubriques().map(rb => {
      const def = defs.get(rb.code);
      const signed = rb.direction === 'DEBIT' ? -rb.amount : rb.amount;
      const nature = rb.nature ?? def?.nature ?? null;
      const natureKey = nature ? `PAYROLL.PARAMETER_SETS.NATURE.${nature}.LABEL` : null;
      const natureLabel = natureKey ? this.t(natureKey) : '—';
      return {
        id:     rb.code,
        label:  (isEn && def?.labelEn) || def?.labelFr || rb.code,
        _code:  rb.code,
        nature: {
          label: natureLabel === natureKey ? (nature ?? '—') : natureLabel,
          options: { variant: SimulatorComponent.NATURE_VARIANT[nature ?? ''] ?? 'neutral', size: 'sm' },
        } satisfies BadgeCell,
        calc:   this.rubriqueCalcText(rb.calcMode, def, cur),
        // « +60,00 TND » / « −30,00 TND » : le signe dit gain ou retenue.
        amount: `${signed > 0 ? '+' : signed < 0 ? '−' : ''}${this.money(Math.abs(signed), cur, 2)}`,
        _amount: signed,
      };
    });
  });

  /** Mode de calcul en clair, avec le taux ou le montant paramétré quand on le connaît. */
  private rubriqueCalcText(calcMode: string, def: PayrollRubriqueDto | undefined, cur: string): string {
    const pct = (rate: number | null | undefined) =>
      rate == null ? null : `${this.money(rate * 100, '', 2).replace(/[,.]00$/, '')} %`;
    const key = `PAYROLL.SIMULATOR.RUBRIQUES.CALC.${calcMode}`;
    switch (calcMode) {
      case 'FIXE_MENSUEL':
        return def?.amount != null ? this.t(key, { amount: this.money(def.amount, cur, 2) })
                                   : this.t('PAYROLL.SIMULATOR.RUBRIQUES.CALC.FIXE_MENSUEL_NO_AMOUNT');
      case 'FIXE_JOURNALIER':
        return def?.amount != null ? this.t(key, { amount: this.money(def.amount, cur, 2) })
                                   : this.t('PAYROLL.SIMULATOR.RUBRIQUES.CALC.FIXE_JOURNALIER_NO_AMOUNT');
      case 'POURCENTAGE_BRUT':
      case 'POURCENTAGE_CHARGES':
        return pct(def?.rate) ? this.t(key, { rate: pct(def?.rate) })
                              : this.t(`${key}_NO_RATE`);
      case 'POURCENTAGE_PLAFONNE':
        return pct(def?.rate) && def?.capAmount != null
          ? this.t(key, { rate: pct(def?.rate), cap: this.money(def.capAmount, cur, 0) })
          : this.t(`${key}_NO_RATE`);
      case 'FORMULE':
        return this.t(key);
      default:
        return calcMode;
    }
  }

  // Tableaux « Barème IRPP appliqué » et « Charges appliquées » : textes formatés, à gauche,
  // flèche de tri au bord droit (même rendu que les autres tableaux de la fiche), tri sur
  // les valeurs brutes (`_…`).

  readonly irppColumns = computed((): TableColumn[] => [
    { key: 'bracket', label: this.t('PAYROLL.SIMULATOR.REFERENTIAL.COL_BRACKET'), sortable: true,
      sortAccessor: row => row['_lower'] as number },
    { key: 'rate',    label: this.t('PAYROLL.SIMULATOR.REFERENTIAL.COL_RATE'), sortable: true,
      sortAccessor: row => row['_rate'] as number },
  ]);

  readonly irppRows = computed((): TableRow[] =>
    this.usedIrppBrackets().map(b => ({
      id:      b.lower,
      bracket: `${this.money(b.lower, '', 0)} — ${this.bracketUpper(b)}`,
      rate:    this.percent(b.rate),
      _lower:  b.lower,
      _rate:   b.rate,
    })),
  );

  /**
   * Montant de chaque charge, recalculé depuis son taux et sa base (brut, ou brut plafonné).
   * Affiché seulement si la somme retombe sur les totaux enregistrés par le moteur
   * (à 5 centimes près) : une base élargie par une rubrique, une charge fixe ou une
   * formule donneraient sinon des montants faux — on n'affiche alors que les taux.
   */
  private readonly chargeAmounts = computed((): Map<string, { ee: number; er: number }> | null => {
    const r = this.result();
    const charges = this.applicableCharges();
    if (!r || !charges.length) return null;
    const map = new Map<string, { ee: number; er: number }>();
    let sumEe = 0;
    let sumEr = 0;
    for (const c of charges) {
      if (c.formulaEe || c.formulaEr || c.baseCalculation === 'FIXED') return null;
      const base = c.baseCalculation === 'CAPPED_GROSS' && c.capAmount != null
        ? Math.min(r.gross, c.capAmount) : r.gross;
      const ee = base * c.employeeRate;
      const er = base * c.employerRate;
      map.set(c.chargeCode, { ee, er });
      sumEe += ee;
      sumEr += er;
    }
    const close = (a: number, b: number) => Math.abs(a - b) < 0.05;
    return close(sumEe, r.employeeCharges) && close(sumEr, r.employerCharges) ? map : null;
  });

  readonly chargesColumns = computed((): TableColumn[] => {
    const cols: TableColumn[] = [
      { key: 'charge',   label: this.t('PAYROLL.SIMULATOR.REFERENTIAL.COL_CHARGE'), sortable: true },
      { key: 'employee', label: this.t('PAYROLL.SIMULATOR.REFERENTIAL.COL_EMPLOYEE'), sortable: true,
        sortAccessor: row => row['_employeeRate'] as number },
    ];
    if (this.chargeAmounts()) {
      cols.push({ key: 'employeeAmount', label: this.t('PAYROLL.SIMULATOR.REFERENTIAL.COL_EMPLOYEE_AMOUNT'),
        sortable: true, sortAccessor: row => row['_employeeAmount'] as number });
    }
    cols.push({ key: 'employer', label: this.t('PAYROLL.SIMULATOR.REFERENTIAL.COL_EMPLOYER'), sortable: true,
      sortAccessor: row => row['_employerRate'] as number });
    if (this.chargeAmounts()) {
      cols.push({ key: 'employerAmount', label: this.t('PAYROLL.SIMULATOR.REFERENTIAL.COL_EMPLOYER_AMOUNT'),
        sortable: true, sortAccessor: row => row['_employerAmount'] as number });
    }
    return cols;
  });

  readonly chargesRows = computed((): TableRow[] => {
    const amounts = this.chargeAmounts();
    const cur = this.currency();
    return this.applicableCharges().map(c => {
      const a = amounts?.get(c.chargeCode);
      // « CNSS · Cotisation CNSS », plus le plafond s'il y en a un.
      const name = [c.chargeCode, c.chargeLabel].filter(Boolean).join(' · ');
      return {
        id:       c.chargeCode,
        charge:   c.baseCalculation === 'CAPPED_GROSS' && c.capAmount != null
                    ? `${name} · ${this.t('PAYROLL.SIMULATOR.REFERENTIAL.CAP', { amount: this.money(c.capAmount, '', 0) })}`
                    : name,
        employee: this.percent(c.employeeRate),
        employer: this.percent(c.employerRate),
        employeeAmount: a ? this.money(a.ee, cur, 2) : '—',
        employerAmount: a ? this.money(a.er, cur, 2) : '—',
        _employeeRate: c.employeeRate,
        _employerRate: c.employerRate,
        _employeeAmount: a?.ee ?? 0,
        _employerAmount: a?.er ?? 0,
      };
    });
  });

  // ── Recherche des trois tableaux ───────────────────────────────────────────
  // Chaque tableau a sa `daf-search-toolbar` (qui porte aussi réinitialiser + choix des
  // colonnes). Le filtre porte sur le texte AFFICHÉ : les colonnes de recherche
  // ci-dessous rendent la cellule formatée, là où les `sortAccessor` des colonnes du
  // tableau rendent la valeur brute (montant, borne, taux décimal).

  readonly rubriquesSearch = signal('');
  readonly irppSearch      = signal('');
  readonly chargesSearch   = signal('');

  /** Recherche sur le texte affiché, plus le code technique (« PRIME_RENDEMENT »). */
  private readonly rubriquesSearchColumns = computed((): TableColumn[] => [
    { key: 'label',  label: 'label' },
    { key: '_code',  label: 'code' },
    { key: 'nature', label: 'nature', sortAccessor: row => (row['nature'] as BadgeCell).label },
    { key: 'calc',   label: 'calc' },
    { key: 'amount', label: 'amount' },
  ]);

  /** `bracket`, `rate`, `charge`, `employee`, `employer` sont déjà des chaînes affichées. */
  private readonly irppSearchColumns: TableColumn[] = [
    { key: 'bracket', label: 'bracket' },
    { key: 'rate',    label: 'rate' },
  ];

  private readonly chargesSearchColumns: TableColumn[] = [
    { key: 'charge',         label: 'charge' },
    { key: 'employee',       label: 'employee' },
    { key: 'employeeAmount', label: 'employeeAmount' },
    { key: 'employer',       label: 'employer' },
    { key: 'employerAmount', label: 'employerAmount' },
  ];

  readonly filteredRubriquesRows = computed(() =>
    searchTableRows(this.rubriquesRows(), this.rubriquesSearchColumns(), this.rubriquesSearch()),
  );

  readonly filteredIrppRows = computed(() =>
    searchTableRows(this.irppRows(), this.irppSearchColumns, this.irppSearch()),
  );

  readonly filteredChargesRows = computed(() =>
    searchTableRows(this.chargesRows(), this.chargesSearchColumns, this.chargesSearch()),
  );

  /** Outils de tableau communs (`tableTools`) pour les trois tableaux de résultat. */
  readonly resultTableConfig = computed((): TableConfig => ({
    showHeader: false,
    ...tableTools(this.translate),
  }));

  /** La liste demande ses propres codes : sans eux, « Retour à la liste » ne mènerait qu'au
   *  formulaire (le garde de la liste y renvoie) — le bouton n'est donc pas proposé. */
  readonly canViewList = computed(() =>
    this.userStore.hasPermission('PAYROLL_VIEW_INDIVIDUAL') ||
    this.userStore.hasPermission('PAYROLL_VIEW_AGGREGATE'),
  );

  // ── daf-select option lists ────────────────────────────────────────────────
  // Built in computeds, not inline in the template: an inline `.map()` rebuilds the
  // array on every change-detection cycle and re-renders the panel with it.

  readonly paysOptions = computed((): SelectOption[] =>
    this.paysList().map(p => ({ value: String(p.id), label: `${p.frenchLabel} (${p.isoCode})` })),
  );

  readonly gradeOptions = computed((): SelectOption[] =>
    this.grades().map(g => ({ value: g.labelFr, label: g.labelFr })),
  );

  readonly disciplineOptions = computed((): SelectOption[] =>
    this.disciplines().map(d => ({ value: d.labelFr, label: d.labelFr })),
  );

  readonly contractOptions = computed((): SelectOption[] =>
    this.availableContractTypes().map(ct => ({ value: ct, label: ct })),
  );

  // `daf-select` speaks `string[]`; the form controls hold a single value.
  // ── Collaborateur — `daf-select` de la lib avec sa recherche intégrée ────────
  // La lib filtre les options qu'elle tient : on charge donc tous les collaborateurs en
  // poste du pays d'un coup (au plus quelques centaines ; le service RH accepte 2 000
  // lignes par page), triés par nom. Libellé : « Nom · matricule · contrat ».

  readonly employeesOfPays  = signal<EmployeeListItem[]>([]);
  readonly employeesLoading = signal(false);

  readonly employeeOptions = computed((): SelectOption[] =>
    this.employeesOfPays().map(e => ({
      value: String(e.userId),
      label: [e.fullName, e.employeeId, e.contractType ? contractTypeLabel(e.contractType, this.translate) : null]
        .filter(Boolean).join(' · '),
    })),
  );

  readonly employeeSelection = computed(() => {
    const id = this.formValue().profileUserId;
    return id == null ? [] : [String(id)];
  });

  setEmployeeSelection(selected: string[]): void {
    const raw = selected[0];
    this.form.get('profileUserId')!.setValue(raw ? Number(raw) : null);
  }

  private employeesSeq = 0;
  private loadEmployees(paysId: number | null): void {
    const seq = ++this.employeesSeq;
    this.employeesOfPays.set([]);
    if (paysId == null) { this.employeesLoading.set(false); return; }
    this.employeesLoading.set(true);
    this.hrProfiles.listEmployees({ paysId, page: 0, size: 1000, sort: 'fullName,asc' })
      .pipe(catchError(() => of(null)), takeUntil(this.destroy$))
      .subscribe(page => {
        if (seq !== this.employeesSeq) return;   // réponse dépassée (pays changé entre-temps)
        this.employeesOfPays.set(page?.content ?? []);
        this.employeesLoading.set(false);
      });
  }

  readonly paysSelection       = computed(() => this.selectionOf('paysId'));
  readonly gradeSelection      = computed(() => this.selectionOf('grade'));
  readonly disciplineSelection = computed(() => this.selectionOf('discipline'));
  readonly contractSelection   = computed(() => this.selectionOf('contractType'));

  readonly breadcrumbs = computed((): BreadcrumbItem[] => {
    const r = this.result();
    return [
      { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
      { label: this.t('PAYROLL.SIMULATOR.BREADCRUMB'), link: '/payroll/simulator' },
      {
        label: this.resultView() && r
          ? this.t('PAYROLL.SIMULATOR.BREADCRUMB_RESULT', { id: r.id })
          : this.t('PAYROLL.SIMULATOR.BREADCRUMB_NEW'),
      },
    ];
  });

  /**
   * Titre de page. Formulaire : « Nouvelle simulation ». Fiche : QUI est simulé, comme
   * l'intitulé sur la fiche affaire — « Nom · poste » ; le numéro reste dans le fil d'Ariane.
   * Replis : collaborateur dont le nom n'est pas (encore) chargé → « Collaborateur n° X » ;
   * candidat sans nom → « Candidat · poste » ; ni nom ni poste → « Simulation n° X ».
   */
  readonly pageTitle = computed(() => {
    const r = this.result();
    if (!this.resultView() || !r) return this.t('PAYROLL.SIMULATOR.NEW_TITLE');

    let who: string | null = null;
    if (r.profileUserId != null) {
      who = this.employeesOfPays().find(e => e.userId === r.profileUserId)?.fullName
        ?? this.t('PAYROLL.SIMULATOR.LIST.SUBJECT.EMPLOYEE_ID', { id: r.profileUserId });
    } else if (r.candidateLabel) {
      who = r.candidateLabel;
    }
    const poste = r.poste?.trim() || null;

    if (who && poste) return `${who} · ${poste}`;
    if (who) return who;
    if (poste) return `${this.t('PAYROLL.SIMULATOR.LIST.SUBJECT.CANDIDATE')} · ${poste}`;
    return this.t('PAYROLL.SIMULATOR.RESULT_TITLE', { id: r.id });
  });

  /** Sous-titre du formulaire uniquement — la fiche n'en a pas (sujet, contrat et date
   *  sont dans sa carte Détails). */
  readonly pageSubtitle = computed(() => this.t('PAYROLL.SIMULATOR.NEW_SUBTITLE'));

  // ── Exclusive choices — `daf-radio-group`, horizontal ──────────────────────
  // Radio rather than a hand-rolled segmented control: three of these on one form, and
  // the group is the lib's component for "pick exactly one", label and a11y included.

  // Ce sont des `computed` et non des tableaux figés : la lib reçoit des libellés déjà
  // traduits, ils doivent donc être reconstruits au changement de langue.

  readonly subjectOptions = computed((): RadioOption[] => [
    {
      value: 'CANDIDATE',
      label: this.t('PAYROLL.SIMULATOR.STEP1.SUBJECT_CANDIDATE'),
      hint:  this.t('PAYROLL.SIMULATOR.STEP1.SUBJECT_CANDIDATE_HINT'),
    },
    {
      value: 'EMPLOYEE',
      label: this.t('PAYROLL.SIMULATOR.STEP1.SUBJECT_EMPLOYEE'),
      hint:  this.t('PAYROLL.SIMULATOR.STEP1.SUBJECT_EMPLOYEE_HINT'),
    },
  ]);

  readonly modeOptions = computed((): RadioOption[] => [
    {
      value: 'NET_TO_BRUT',
      label: this.t('PAYROLL.SIMULATOR.MODE.NET_TO_BRUT'),
      hint:  this.t('PAYROLL.SIMULATOR.MODE.NET_TO_BRUT_HINT'),
    },
    {
      value: 'BRUT_TO_NET',
      label: this.t('PAYROLL.SIMULATOR.MODE.BRUT_TO_NET'),
      hint:  this.t('PAYROLL.SIMULATOR.MODE.BRUT_TO_NET_HINT'),
    },
  ]);

  readonly periodOptions = computed((): RadioOption[] => [
    { value: 'MONTHLY', label: this.t('PAYROLL.SIMULATOR.PERIOD.MONTHLY') },
    {
      value: 'YEARLY',
      label: this.t('PAYROLL.SIMULATOR.PERIOD.YEARLY'),
      hint:  this.t('PAYROLL.SIMULATOR.PERIOD.YEARLY_HINT'),
    },
  ]);

  /** Libellé du sens de calcul en cours — badge, sous-titre d'étape, en-tête. */
  readonly modeLabel = computed(() => this.t(`PAYROLL.SIMULATOR.MODE.${this.mode()}`));

  /** « mensuel » / « annuel », adjectif accolé aux libellés de montant. */
  readonly periodAdjective = computed(() =>
    this.t(`PAYROLL.SIMULATOR.PERIOD.${this.period() === 'MONTHLY' ? 'MONTHLY_ADJ' : 'YEARLY_ADJ'}`),
  );

  // ── Parcours en 3 étapes ───────────────────────────────────────────────────

  /** Step currently shown in the left column. */
  readonly currentStep = signal(0);

  /**
   * The rail. **No step is ever `disabled`** — the three are a reading order, not a
   * gate: a user who only wants to change the amount jumps straight to 02, and one who
   * reopens a past run lands wherever they like. `completed` is therefore set
   * explicitly per step (which also switches the lib off positional inference, so 03 can
   * read as done while the user sits on 01).
   */
  // ── Habillage « assistant », comme /finance/affaires/new ────────────────────

  private static readonly STEP_ICONS = ['public', 'payments', 'redeem'];
  private static readonly STEP_KEYS  = ['STEP1', 'STEP2', 'STEP3'];

  /** En-tête de la carte : icône, titre et « Étape n sur 3 · description ». */
  readonly cardIcon  = computed(() => SimulatorComponent.STEP_ICONS[this.currentStep()] ?? 'calculate');
  readonly cardTitle = computed(() =>
    this.t(`PAYROLL.SIMULATOR.${SimulatorComponent.STEP_KEYS[this.currentStep()]}.TITLE`));
  readonly cardSub = computed(() =>
    this.t('PAYROLL.SIMULATOR.STEPPER.COUNTER', { current: this.currentStep() + 1, total: this.steps().length })
    + ' · '
    + this.t(`PAYROLL.SIMULATOR.STEPPER.S${this.currentStep() + 1}_DESC`));

  /** Rail de la barre d'actions : la bande seule (`header-only`), libellés discrets
   *  (`quiet`) puisque le nom de l'étape est déjà en titre de carte. Contrairement à
   *  l'assistant affaire, les trois étapes restent cliquables dans n'importe quel ordre. */
  readonly stepperConfig = computed((): StepperConfig => ({
    chrome: 'header-only',
    labelDensity: 'quiet',
    clickableSteps: true,
    stepperLabel: this.t('PAYROLL.SIMULATOR.STEPPER.ARIA'),
  }));

  /** La seule action dessinée de la barre — teal, pilule, comme les assistants Finance. */
  readonly nextButtonOptions = computed((): ButtonOptions => {
    const last = this.currentStep() === this.steps().length - 1;
    return {
      variant:  'teal',
      pill:     true,
      label:    this.t(last ? 'PAYROLL.SIMULATOR.RESULT.SIMULATE' : 'PAYROLL.SIMULATOR.STEPPER.NEXT'),
      iconEnd:  last ? 'calculate' : 'arrow_forward',
      loading:  last && this.loading(),
      disabled: last && !this.canSimulate(),
    };
  });

  /** Pastilles de l'en-tête du formulaire — le résumé de la saisie, comme l'assistant
   *  affaire : pays · sujet · contrat · montant et sens. Une pastille n'apparaît que
   *  quand sa donnée est connue. */
  readonly formBadges = computed((): PageHeaderBadge[] => {
    const v = this.formValue();
    const badges: PageHeaderBadge[] = [];
    const pays = this.selectedPays();
    if (pays) badges.push({ label: `${pays.frenchLabel} (${pays.isoCode})`, variant: 'primary', size: 'sm' });
    if (this.subject() === 'EMPLOYEE') {
      badges.push({ label: this.t('PAYROLL.SIMULATOR.LIST.SUBJECT.EMPLOYEE'), variant: 'secondary', size: 'sm' });
    } else {
      badges.push({ label: v.candidateLabel || this.t('PAYROLL.SIMULATOR.LIST.SUBJECT.CANDIDATE'), variant: 'secondary', size: 'sm' });
    }
    if (v.contractType) badges.push({ label: v.contractType, variant: 'neutral', size: 'sm' });
    const amount = this.mode() === 'NET_TO_BRUT' ? v.inputNet : v.inputGross;
    if (amount != null && Number(amount) > 0) {
      badges.push({
        label: `${this.modeLabel()} · ${this.money(Number(amount), this.currency(), 0)} ${this.periodAdjective()}`,
        variant: 'success', size: 'sm',
      });
    }
    return badges;
  });

  /** Titre seul, numéro dans le cercle — comme le rail de l'assistant affaire. */
  readonly steps = computed((): StepperStep[] => [
    { title: this.t('PAYROLL.SIMULATOR.STEPPER.S1_TITLE'), completed: this.step1Done() },
    { title: this.t('PAYROLL.SIMULATOR.STEPPER.S2_TITLE'), completed: this.step2Done() },
    { title: this.t('PAYROLL.SIMULATOR.STEPPER.S3_TITLE'), completed: this.step3Done() },
  ]);

  private readonly step1Done = computed(() =>
    this.psState() === 'READY' &&
    (this.subject() === 'CANDIDATE' || this.formValue().profileUserId != null),
  );

  private readonly step2Done = computed(() =>
    !this.amountError() &&
    (this.subject() === 'EMPLOYEE' || !!this.formValue().contractType),
  );

  /** Nothing is mandatory here — the step is done as soon as a referential exists. */
  private readonly step3Done = computed(() => this.psState() === 'READY');

  /** Trailing badge of card 01 — the state of the country's referential. */
  readonly referentialBadge = computed((): { label: string; options: BadgeOptions } => {
    switch (this.psState()) {
      case 'LOADING':
        return {
          label: this.t('PAYROLL.COMMON.LOADING'),
          options: { variant: 'neutral', size: 'sm' },
        };
      case 'READY': {
        const ps = this.activePs()!;
        return {
          label:   this.t('PAYROLL.SIMULATOR.STEP1.BADGE_READY', {
                     version:  ps.version,
                     year:     ps.fiscalYear,
                     currency: this.currency(),
                   }),
          options: { variant: 'success', size: 'sm', dot: true },
        };
      }
      case 'MISSING':
        return {
          label: this.t('PAYROLL.SIMULATOR.STEP1.BADGE_MISSING'),
          options: { variant: 'warning', size: 'sm', dot: true },
        };
      default:
        return {
          label: this.t('PAYROLL.SIMULATOR.STEP1.BADGE_IDLE'),
          options: { variant: 'neutral', size: 'sm' },
        };
    }
  });

  /** Trailing badge of card 02 — the direction and period in force. */
  readonly calcBadge = computed((): { label: string; options: BadgeOptions } => ({
    label: this.t('PAYROLL.SIMULATOR.STEP2.BADGE', {
      mode:   this.modeLabel(),
      period: this.periodAdjective(),
    }),
    options: { variant: 'secondary', size: 'sm' },
  }));

  /** Trailing badge of card 03 — how many benefits are included. */
  readonly benefitsBadge = computed((): { label: string; options: BadgeOptions } => {
    const total = this.availableBenefits().length;
    if (!total) {
      return {
        label: this.t('PAYROLL.SIMULATOR.STEP3.BADGE_NONE'),
        options: { variant: 'neutral', size: 'sm' },
      };
    }
    return {
      label:   this.t('PAYROLL.SIMULATOR.STEP3.BADGE', {
                 selected: this.selectedCodes().size,
                 total,
               }),
      options: { variant: this.selectedCodes().size ? 'primary' : 'neutral', size: 'sm' },
    };
  });

  /** Net actually in hand — the engine stores it in `inputNet` whatever the direction. */
  readonly netMonthly = computed((): number | null => {
    const r = this.result();
    return r ? r.gross - r.employeeCharges - r.irppAmount : null;
  });

  /**
   * The loaded cost split into what it is made of. Identity the engine guarantees:
   * `loadedCost = net + chargesSalariales + IRPP + avantages exonérés + chargesPatronales`
   * (S5 = S4 + patronales, S4 = S3 + exonérés, S3 = net + salariales + IRPP), so the
   * segments always total 100 % and the bar needs no normalisation.
   */
  readonly breakdown = computed((): BreakdownSegment[] => {
    const r = this.result();
    if (!r || !r.loadedCost) return [];

    const net     = this.netMonthly() ?? 0;
    const exempt  = (r.grossWithBenefits ?? r.gross) - r.gross;
    const total   = r.loadedCost;
    const pct     = (v: number) => (total ? (v / total) * 100 : 0);

    // `key` reste stable d'une langue à l'autre : c'est lui qui sert de `track` au gabarit,
    // pas le libellé traduit, qui changerait et ferait re-rendre toute la liste.
    return [
      { key: 'NET',              label: this.t('PAYROLL.SIMULATOR.RESULT.SEG_NET'),               amount: net,               pct: pct(net),               bar: 'bg-primary',   dot: 'bg-primary' },
      { key: 'EMPLOYEE_CHARGES', label: this.t('PAYROLL.SIMULATOR.RESULT.SEG_EMPLOYEE_CHARGES'),  amount: r.employeeCharges, pct: pct(r.employeeCharges), bar: 'bg-secondary', dot: 'bg-secondary' },
      { key: 'IRPP',             label: this.t('PAYROLL.SIMULATOR.RESULT.SEG_IRPP'),              amount: r.irppAmount,      pct: pct(r.irppAmount),      bar: 'bg-warning',   dot: 'bg-warning' },
      { key: 'EXEMPT_BENEFITS',  label: this.t('PAYROLL.SIMULATOR.RESULT.SEG_EXEMPT_BENEFITS'),   amount: exempt,            pct: pct(exempt),            bar: 'bg-tertiary',  dot: 'bg-tertiary' },
      { key: 'EMPLOYER_CHARGES', label: this.t('PAYROLL.SIMULATOR.RESULT.SEG_EMPLOYER_CHARGES'),  amount: r.employerCharges, pct: pct(r.employerCharges), bar: 'bg-teal',      dot: 'bg-teal' },
    ].filter(s => s.amount > 0.005);
  });

  // ══ Fiche résultat — même mise en page que /finance/affaires/:id ═════════════
  // Colonne gauche : en-tête + carte Détails + carte Actions rapides. Colonne droite :
  // 4 KPI, onglets, contenu de l'onglet.

  /** Onglet choisi — `overview` à chaque ouverture d'une fiche (voir `onRouteChange`). */
  readonly activeTab = signal<string>('overview');

  /**
   * Seuls les onglets qui ont du contenu : Rubriques si la simulation en a, Charges et
   * Barème si le jeu UTILISÉ a pu être lu (droit + pays) et en contient pour ce calcul.
   */
  readonly resultTabs = computed((): TabItem[] => {
    const tabs: TabItem[] = [
      { id: 'overview', label: this.t('PAYROLL.SIMULATOR.DETAIL.TABS.OVERVIEW'), icon: 'dashboard' },
    ];
    if (this.parsedRubriques().length) {
      tabs.push({ id: 'rubriques', label: this.t('PAYROLL.SIMULATOR.DETAIL.TABS.RUBRIQUES'), icon: 'list_alt',
        count: this.parsedRubriques().length });
    }
    if (this.applicableCharges().length) {
      tabs.push({ id: 'charges', label: this.t('PAYROLL.SIMULATOR.DETAIL.TABS.CHARGES'), icon: 'account_balance',
        count: this.applicableCharges().length });
    }
    if (this.usedIrppBrackets().length) {
      tabs.push({ id: 'irpp', label: this.t('PAYROLL.SIMULATOR.DETAIL.TABS.IRPP'), icon: 'stacked_line_chart',
        count: this.usedIrppBrackets().length });
    }
    return tabs;
  });

  /** Une barre avec le seul onglet « Vue générale » ne sert à rien : elle est masquée. */
  readonly showResultTabs = computed(() => this.resultTabs().length > 1);

  /** Onglet effectivement affiché — retombe sur la vue générale si celui choisi a disparu
   *  (ex. barème illisible pour cet utilisateur). */
  readonly currentTab = computed(() =>
    this.resultTabs().some(t => t.id === this.activeTab()) ? this.activeTab() : 'overview');

  /** Les 4 indicateurs de la colonne droite — `daf-metric-card`, aide au survol (sans titre :
   *  il redirait celui de la tuile). Dans l'ordre du raisonnement d'un financier : ce que
   *  touche le salarié → son brut (et ce qui l'en sépare) → ce que paie l'entreprise → le
   *  rapport coût / net. L'annuel (× 12) seulement là où il sert : package net et budget. */
  readonly resultKpis = computed(() => {
    const r = this.result();
    if (!r) return [];
    const cur = this.currency();
    const perYear = (v: number | null | undefined): MetricDelta | null => v == null ? null : {
      value: this.t('PAYROLL.SIMULATOR.RESULT.PER_YEAR', { amount: this.money(v * 12, cur, 0) }),
      direction: 'neutral',
    };
    const net = this.netMonthly();
    const withheld = r.employeeCharges + r.irppAmount;
    return [
      {
        label: this.t('PAYROLL.SIMULATOR.RESULT.NET_MONTHLY'),
        value: net != null ? this.money(net, cur, 2) : '—', delta: perYear(net),
        options: { icon: 'savings', iconColor: 'text-tertiary', iconBg: 'bg-tertiary/10',
          help: this.t('PAYROLL.SIMULATOR.RESULT.NET_MONTHLY_HELP') } satisfies MetricCardOptions,
      },
      {
        label: this.t('PAYROLL.SIMULATOR.RESULT.GROSS_MONTHLY'),
        value: this.money(r.gross, cur, 2),
        delta: { value: this.t('PAYROLL.SIMULATOR.RESULT.GROSS_WITHHELD', { amount: this.money(withheld, cur, 0) }),
                 direction: 'neutral' } as MetricDelta,
        options: { icon: 'payments', iconColor: 'text-secondary', iconBg: 'bg-secondary/10',
          help: this.t('PAYROLL.SIMULATOR.RESULT.GROSS_MONTHLY_HELP') } satisfies MetricCardOptions,
      },
      {
        label: this.t('PAYROLL.SIMULATOR.RESULT.LOADED_COST'),
        value: this.money(r.loadedCost, cur, 2), delta: perYear(r.loadedCost),
        options: { icon: 'account_balance_wallet', iconColor: 'text-primary', iconBg: 'bg-primary/10',
          help: this.t('PAYROLL.SIMULATOR.RESULT.LOADED_COST_HELP') } satisfies MetricCardOptions,
      },
      {
        label: this.t('PAYROLL.SIMULATOR.DETAIL.KPI_RATIO'),
        value: r.costNetRatio != null ? `× ${this.money(r.costNetRatio, '', 2)}` : '—',
        delta: { value: this.t('PAYROLL.SIMULATOR.DETAIL.KPI_RATIO_DELTA'), direction: 'neutral' } as MetricDelta,
        options: { icon: 'balance', iconColor: 'text-teal', iconBg: 'bg-teal/10',
          help: this.t('PAYROLL.SIMULATOR.DETAIL.KPI_RATIO_HELP'),
          helpPlacement: 'top' } satisfies MetricCardOptions,
      },
    ];
  });

  /** Blocs clé / valeur du panneau Détails (colonne gauche). Une ligne sans valeur n'est
   *  pas affichée : un libellé suivi d'un tiret occupe la place d'une information. */
  readonly detailBlocks = computed((): { id: string; title: string; rows: { key: string; value: string; ok?: boolean }[] }[] => {
    const r = this.result();
    if (!r) return [];
    const cur = this.currency();
    const keep = (rows: { key: string; value: string | null | undefined; ok?: boolean }[]) =>
      rows.filter((x): x is { key: string; value: string; ok?: boolean } => !!x.value);
    const pays = this.paysList().find(p => p.id === r.paysId);
    const benefits = this.benefitCodesOf(r.benefitsApplied);
    const date = new Intl.DateTimeFormat(this.numberLocale(), { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(r.simulatedAt));
    const isNetToGross = r.mode !== 'BRUT_TO_NET';
    return [
      {
        id: 'subject', title: this.t('PAYROLL.SIMULATOR.DETAIL.BLOCK_SUBJECT'),
        rows: keep([
          { key: this.t('PAYROLL.SIMULATOR.LIST.FILTER.SUBJECT'),
            value: this.t(r.profileUserId != null ? 'PAYROLL.SIMULATOR.LIST.SUBJECT.EMPLOYEE' : 'PAYROLL.SIMULATOR.LIST.SUBJECT.CANDIDATE') },
          // Pas de ligne Poste : il est dans le titre de la page (« Nom · Poste »).
          { key: this.t('PAYROLL.SIMULATOR.STEP1.GRADE'), value: r.grade },
          { key: this.t('PAYROLL.SIMULATOR.STEP1.DISCIPLINE'), value: r.discipline },
        ]),
      },
      {
        id: 'context', title: this.t('PAYROLL.SIMULATOR.DETAIL.BLOCK_CONTEXT'),
        rows: keep([
          { key: this.t('PAYROLL.SIMULATOR.LIST.FILTER.PAYS'),
            value: pays ? `${pays.frenchLabel} (${pays.isoCode})` : null },
          { key: this.t('PAYROLL.SIMULATOR.LIST.FILTER.CONTRACT'), value: r.contractType },
          // L'année du jeu utilisé plutôt que son identifiant technique ; le numéro ne reste
          // qu'en repli, tant que ce jeu n'est pas chargé (ou illisible pour l'utilisateur).
          { key: this.t('PAYROLL.SIMULATOR.DETAIL.PARAMETER_SET'),
            value: this.usedPs()?.fiscalYear != null
              ? this.t('PAYROLL.SIMULATOR.DETAIL.PARAMETER_SET_YEAR', { year: this.usedPs()!.fiscalYear })
              : this.t('PAYROLL.SIMULATOR.DETAIL.PARAMETER_SET_FALLBACK', { id: r.parameterSetId }) },
          { key: this.t('PAYROLL.SIMULATOR.LIST.COL.DATE'), value: date },
        ]),
      },
      {
        id: 'inputs', title: this.t('PAYROLL.SIMULATOR.DETAIL.BLOCK_INPUTS'),
        rows: keep([
          { key: this.t('PAYROLL.SIMULATOR.LIST.FILTER.MODE'),
            value: this.t(`PAYROLL.SIMULATOR.MODE.${isNetToGross ? 'NET_TO_BRUT' : 'BRUT_TO_NET'}`) },
          // Le net visé seulement : il peut différer du net obtenu (résultat approximatif).
          // Le brut saisi, lui, est exactement la tuile « Brut mensuel » : pas répété.
          { key: this.t('PAYROLL.SIMULATOR.DETAIL.INPUT_NET'),
            value: isNetToGross ? this.money(r.inputNet, cur, 2) : null },
          // Base de l'IRPP (ancienne barre S2 de la cascade) — le seul montant du calcul
          // qui n'est ni dans les KPI ni dans « Qui reçoit quoi ? ».
          { key: this.t('PAYROLL.SIMULATOR.DETAIL.NET_TAXABLE'), value: this.money(r.netTaxable, cur, 2) },
          { key: this.t('PAYROLL.SIMULATOR.DETAIL.BENEFITS'),
            value: benefits == null ? null : String(benefits.length) },
          { key: this.t('PAYROLL.SIMULATOR.DETAIL.CONVERGENCE'),
            value: this.t(r.convergenceOk ? 'PAYROLL.SIMULATOR.DETAIL.CONVERGENCE_OK' : 'PAYROLL.SIMULATOR.DETAIL.CONVERGENCE_PARTIAL',
              { iterations: r.iterationsUsed }),
            ok: !!r.convergenceOk },
        ]),
      },
    ].filter(b => b.rows.length);
  });

  /**
   * Tableau « Qui reçoit quoi ? » — le coût chargé regroupé par DESTINATAIRE, une ligne
   * par poste, plus une ligne Total :
   *   le salarié reçoit        → net versé (+ avantages exonérés s'il y en a) ;
   *   prélevé sur le salaire   → IRPP, charges salariales ;
   *   payé en plus (employeur) → charges patronales.
   * Les postes totalisent le coût chargé (identité du moteur, voir `breakdown`). La part
   * est celle du coût chargé. Les charges patronales ne sont enregistrées qu'en total avec
   * la simulation : leur détail (CNSS, TFP…) n'est pas disponible ici.
   */
  /**
   * Même rendu que le tableau « Historique » de /finance/affaires/:id?tab=wip : toutes les
   * colonnes à gauche, titre à gauche et flèche de tri au bord droit de la case. Pour ça, les
   * montants sont des TEXTES déjà formatés (« 2 500,00 TND ») et non des colonnes numériques
   * — la lib centrerait une colonne `currency`/`percent`/`number`. Le tri reste sur la valeur
   * brute grâce au `sortAccessor` (champs `_monthly`, `_yearly`, `_share`), comme chez WIP.
   */
  readonly costTableColumns = computed((): TableColumn[] => [
    // Tri du destinataire sur son libellé (la cellule est une pastille).
    { key: 'recipient', label: this.t('PAYROLL.SIMULATOR.DETAIL.COL_RECIPIENT'), type: 'badge', sortable: true,
      sortAccessor: row => (row['recipient'] as BadgeCell).label },
    { key: 'item',    label: this.t('PAYROLL.SIMULATOR.DETAIL.COL_ITEM'), sortable: true },
    { key: 'monthly', label: this.t('PAYROLL.SIMULATOR.DETAIL.COL_MONTHLY'), sortable: true,
      sortAccessor: row => row['_monthly'] as number },
    { key: 'yearly',  label: this.t('PAYROLL.SIMULATOR.DETAIL.COL_YEARLY'),  sortable: true,
      sortAccessor: row => row['_yearly'] as number },
    { key: 'share',   label: this.t('PAYROLL.SIMULATOR.DETAIL.GROUP_SHARE'), sortable: true,
      sortAccessor: row => row['_share'] as number },
  ]);

  /**
   * Une ligne par poste. Le destinataire est écrit sur CHAQUE ligne (et non plus sur la
   * première de son groupe) : une fois le tableau trié ou filtré, chaque ligne doit dire
   * seule à qui elle appartient. Le total n'est pas une ligne — voir `costTotal`.
   */
  readonly costTableRows = computed((): TableRow[] => {
    const r = this.result();
    if (!r || !r.loadedCost) return [];
    const total = r.loadedCost;
    const net = this.netMonthly() ?? 0;
    const exempt = Math.max(0, (r.grossWithBenefits ?? r.gross) - r.gross);

    const badge = (key: string, variant: BadgeVariant): BadgeCell =>
      ({ label: this.t(`PAYROLL.SIMULATOR.DETAIL.${key}`), options: { variant, size: 'sm', dot: true } });
    const employee = badge('GROUP_EMPLOYEE', 'warning');
    const withheld = badge('GROUP_WITHHELD', 'danger');
    const employer = badge('GROUP_EMPLOYER', 'secondary');
    // Cellules affichées = textes formatés (« 2 500,00 TND », « 58,4 % ») ; valeurs brutes
    // en `_…` pour le tri (voir `costTableColumns`).
    const cur = this.currency();
    const row = (id: string, recipient: BadgeCell, itemKey: string, amount: number): TableRow => {
      const share = total ? (amount / total) * 100 : 0;
      return {
        id, recipient, item: this.t(itemKey),
        monthly: this.money(amount, cur, 2),
        yearly:  this.money(amount * 12, cur, 2),
        share:   `${this.money(share, '', 1)} %`,
        _monthly: amount, _yearly: amount * 12, _share: share,
      };
    };

    const rows: TableRow[] = [row('net', employee, 'PAYROLL.SIMULATOR.RESULT.SEG_NET', net)];
    if (exempt > 0.005) rows.push(row('exempt', employee, 'PAYROLL.SIMULATOR.RESULT.SEG_EXEMPT_BENEFITS', exempt));
    rows.push(
      row('irpp',     withheld, 'PAYROLL.SIMULATOR.RESULT.SEG_IRPP', r.irppAmount),
      row('employee', withheld, 'PAYROLL.SIMULATOR.RESULT.SEG_EMPLOYEE_CHARGES', r.employeeCharges),
      row('employer', employer, 'PAYROLL.SIMULATOR.RESULT.SEG_EMPLOYER_CHARGES', r.employerCharges),
    );
    return rows;
  });

  /** Ligne Total, affichée SOUS le tableau : dans le tableau, le tri la déplacerait. */
  readonly costTotal = computed(() => {
    const r = this.result();
    if (!r || !r.loadedCost) return null;
    const cur = this.currency();
    return { monthly: this.money(r.loadedCost, cur, 2), yearly: this.money(r.loadedCost * 12, cur, 2) };
  });

  // ── Cercle « Répartition du coût », sous le tableau ─────────────────────────
  // La lib n'a pas de graphique circulaire (seulement `daf-gauge`, une seule valeur) : anneau
  // en SVG, trois parts — les destinataires du tableau, dans les MÊMES couleurs que ses
  // pastilles. ⚠ Dans `daf-badge`, le nom de la variante n'est pas sa couleur : `warning`
  // est turquoise (point `bg-tertiary`), `danger` rouge (`bg-danger`), `secondary` indigo
  // (`bg-secondary`). L'anneau reprend donc ces jetons-là : tertiary / danger / secondary.

  /** Rayon et circonférence de l'anneau (viewBox 0 0 120 120). */
  readonly donutRadius = 46;
  private readonly donutCircumference = 2 * Math.PI * 46;

  readonly costDonut = computed(() => {
    const r = this.result();
    if (!r || !r.loadedCost) return [];
    const cur = this.currency();
    const total = r.loadedCost;
    const net = this.netMonthly() ?? 0;
    const exempt = Math.max(0, (r.grossWithBenefits ?? r.gross) - r.gross);
    const parts = [
      { key: 'EMPLOYEE', label: this.t('PAYROLL.SIMULATOR.DETAIL.GROUP_EMPLOYEE'), amount: net + exempt,
        color: 'var(--color-tertiary)' },
      { key: 'WITHHELD', label: this.t('PAYROLL.SIMULATOR.DETAIL.GROUP_WITHHELD'), amount: r.irppAmount + r.employeeCharges,
        color: 'var(--color-danger)' },
      { key: 'EMPLOYER', label: this.t('PAYROLL.SIMULATOR.DETAIL.GROUP_EMPLOYER'), amount: r.employerCharges,
        color: 'var(--color-secondary)' },
    ];
    // Chaque part est un cercle dont le trait ne couvre que sa fraction (`dasharray`),
    // décalé de la somme des parts précédentes (`dashoffset`).
    let start = 0;
    return parts.filter(p => p.amount > 0.005).map(p => {
      const share = p.amount / total;
      const length = share * this.donutCircumference;
      const seg = {
        ...p,
        pct: `${this.money(share * 100, '', 1)} %`,
        amountText: this.money(p.amount, cur, 2),
        dash: `${length} ${this.donutCircumference - length}`,
        offset: -start,
      };
      start += length;
      return seg;
    });
  });

  /** Texte du graphique pour les lecteurs d'écran : « Le salarié reçoit 58,4 %, … ». */
  readonly costDonutAria = computed(() =>
    this.costDonut().map(s => `${s.label} ${s.pct} (${s.amountText})`).join(', '));

  // ── Recherche du tableau « Qui reçoit quoi ? » — sur le texte AFFICHÉ ─────────
  readonly costSearch = signal('');

  private readonly costSearchColumns = computed((): TableColumn[] => [
    { key: 'recipient', label: 'recipient', sortAccessor: row => (row['recipient'] as BadgeCell).label },
    { key: 'item',      label: 'item' },
    { key: 'monthly',   label: 'monthly' },
    { key: 'yearly',    label: 'yearly' },
  ]);

  readonly filteredCostRows = computed(() =>
    searchTableRows(this.costTableRows(), this.costSearchColumns(), this.costSearch()),
  );

  /** Mêmes outils que les autres tableaux de la paie (`tableTools` : colonnes et lignes
   *  redimensionnables, choix des colonnes, réinitialiser) ; tri local sur chaque colonne. */
  readonly costTableConfig = computed((): TableConfig => ({
    // Même configuration que le tableau « Historique » de /finance/affaires/:id?tab=wip
    // (`tmHistoryConfig`) : pas d'en-tête de carte, pas de surbrillance au survol, un
    // message quand le filtre ne laisse rien, et les outils communs (`tableTools`).
    showHeader: false,
    hoverable: false,
    emptyMessage: this.t('PAYROLL.SIMULATOR.DETAIL.GROUPS_EMPTY'),
    ...tableTools(this.translate),
  }));

  constructor() {
    this.loadInitialReferences();

    this.form.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.formValue.set(this.form.getRawValue()));

    this.form.get('paysId')!.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(paysId => {
        this.activePs.set(null);
        this.selectedCodes.set(new Set());
        this.result.set(null);
        this.error.set(null);
        // Grade/discipline/contract belong to the previous country's referential, and a
        // collaborator picked under it is no longer in scope either.
        this.form.patchValue(
          { grade: '', discipline: '', contractType: '', profileUserId: null },
          { emitEvent: false },
        );
        this.formValue.set(this.form.getRawValue());

        // Les collaborateurs proposés sont ceux du pays choisi.
        this.loadEmployees(paysId ?? null);
        if (paysId) {
          this.loadCountryData(paysId);
        } else {
          this.psState.set('IDLE');
          this.loadGradesAndDisciplines();
        }
      });

    // `:id` vaut `new` (formulaire) ou un nombre (fiche) ; `?from=` = « Dupliquer ».
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([params, query]) => this.onRouteChange(params.get('id'), query.get('from')));
  }

  // ── Routage : formulaire / fiche ───────────────────────────────────────────

  private onRouteChange(rawId: string | null, rawFrom: string | null): void {
    this.loadError.set(null);
    const id = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;

    if (id == null) {
      // Formulaire. Revenir d'une fiche le retrouve tel quel ; un « Dupliquer » le remplit
      // une fois avec la simulation source.
      this.resultView.set(false);
      const from = rawFrom && /^\d+$/.test(rawFrom) ? Number(rawFrom) : null;
      if (from != null && from !== this.prefilledFrom) {
        this.fetchSimulation(from, r => {
          this.prefill(r);
          this.result.set(null);
        });
      }
      return;
    }

    // Fiche. Déjà en main juste après « Simuler » ; sinon (lien, F5, liste) on la lit.
    if (this.result()?.id === id) {
      this.resultView.set(true);
      return;
    }
    this.fetchSimulation(id, r => {
      // Le formulaire est pré-rempli derrière la fiche : « Modifier la simulation » repart
      // de ces valeurs.
      this.prefill(r);
      this.result.set(r);
      this.clearResultSearches();
      this.activeTab.set('overview');
      this.resultView.set(true);
    });
  }

  private fetchSimulation(id: number, apply: (r: SimulationResultDto) => void): void {
    this.resultLoading.set(true);
    this.api.getSimulation(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: r => {
          this.resultLoading.set(false);
          apply(r);
        },
        error: err => {
          this.resultLoading.set(false);
          this.resultView.set(false);
          this.loadError.set(err?.error?.detail ?? this.t('PAYROLL.SIMULATOR.LOAD_ERROR'));
        },
      });
  }

  /**
   * Remet dans le formulaire les entrées d'une simulation passée. Montants en mensuel
   * (c'est ce que le moteur a reçu). Le pays est posé EN PREMIER : son `valueChanges` vide
   * les champs qui dépendent du référentiel et recharge celui-ci ; contrat et avantages
   * sont reposés à son arrivée (`pendingPrefill`, voir `loadCountryData`).
   */
  private prefill(r: SimulationResultDto): void {
    this.prefilledFrom = r.id;
    const isEmployee = r.profileUserId != null;
    const mode: SimulationMode = r.mode === 'BRUT_TO_NET' ? 'BRUT_TO_NET' : 'NET_TO_BRUT';

    this.pendingPrefill = {
      // Collaborateur : contrat laissé vide, le backend reprend celui de sa fiche RH.
      contractType: isEmployee ? '' : (r.contractType ?? ''),
      benefitCodes: this.benefitCodesOf(r.benefitsApplied),
    };
    this.subject.set(isEmployee ? 'EMPLOYEE' : 'CANDIDATE');
    this.period.set('MONTHLY');
    this.currentStep.set(0);

    if (this.form.getRawValue().paysId === r.paysId && this.psState() === 'READY') {
      this.applyPendingPrefill();
    } else {
      this.form.get('paysId')!.setValue(r.paysId);
    }
    this.setMode(mode);
    this.form.patchValue({
      profileUserId:  isEmployee ? r.profileUserId : null,
      inputNet:       mode === 'NET_TO_BRUT' ? r.inputNet : null,
      inputGross:     mode === 'BRUT_TO_NET' ? r.gross : null,
      candidateLabel: r.candidateLabel ?? '',
      poste:          r.poste ?? '',
      grade:          r.grade ?? '',
      discipline:     r.discipline ?? '',
    });
    this.formValue.set(this.form.getRawValue());
  }

  private applyPendingPrefill(): void {
    const p = this.pendingPrefill;
    if (!p) return;
    this.pendingPrefill = null;
    this.form.patchValue({ contractType: p.contractType }, { emitEvent: false });
    if (p.benefitCodes) {
      const offered = new Set(this.availableBenefits().map(b => b.benefitCode));
      this.selectedCodes.set(new Set(p.benefitCodes.filter(c => offered.has(c))));
    }
    this.formValue.set(this.form.getRawValue());
  }

  /** Codes des avantages appliqués (`[{code, monthly, taxable}]`), null si illisible. */
  private benefitCodesOf(json: string | null | undefined): string[] | null {
    if (!json) return null;
    try {
      const parsed = JSON.parse(json) as Array<{ code?: string }>;
      return Array.isArray(parsed) ? parsed.map(b => b.code).filter((c): c is string => !!c) : null;
    } catch {
      return null;
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  /** Countries + the global grade/discipline lists, before any country is chosen. */
  private loadInitialReferences(): void {
    forkJoin({
      pays:        this.api.listPays().pipe(catchError(() => of([] as PaysDto[]))),
      grades:      this.hrRef.listGrades().pipe(catchError(() => of([] as ConfigurableListValueDto[]))),
      disciplines: this.hrRef.listDisciplines().pipe(catchError(() => of([] as ConfigurableListValueDto[]))),
    }).pipe(takeUntil(this.destroy$))
      .subscribe(({ pays, grades, disciplines }) => {
        this.paysList.set(pays);
        this.grades.set(grades);
        this.disciplines.set(disciplines);
        this.firstLoad.set(false);
      });
  }

  private loadGradesAndDisciplines(paysId?: number): void {
    forkJoin({
      grades:      this.hrRef.listGrades(paysId)
                       .pipe(catchError(() => of([] as ConfigurableListValueDto[]))),
      disciplines: this.hrRef.listDisciplines(paysId)
                       .pipe(catchError(() => of([] as ConfigurableListValueDto[]))),
    }).pipe(takeUntil(this.destroy$))
      .subscribe(({ grades, disciplines }) => {
        this.grades.set(grades);
        this.disciplines.set(disciplines);
      });
  }

  /**
   * Everything that depends on the country: the active parameter set (rates, benefits,
   * IRPP scale), the country-scoped RH lists, and the recent simulations.
   *
   * A missing parameter set is a *state*, not a swallowed error: `/parameter-sets/active`
   * 404s when a country has none, and the old page hid that, left the contract list on a
   * hardcoded fallback and let the user submit into a 500 from the engine.
   */
  private loadCountryData(paysId: number): void {
    this.psState.set('LOADING');

    forkJoin({
      ps: this.api.getActiveParameterSet(paysId).pipe(catchError(() => of(null))),
      grades: this.hrRef.listGrades(paysId)
                  .pipe(catchError(() => of([] as ConfigurableListValueDto[]))),
      disciplines: this.hrRef.listDisciplines(paysId)
                  .pipe(catchError(() => of([] as ConfigurableListValueDto[]))),
    }).pipe(takeUntil(this.destroy$))
      .subscribe(({ ps, grades, disciplines }) => {
        this.activePs.set(ps);
        this.psState.set(ps ? 'READY' : 'MISSING');
        this.grades.set(grades);
        this.disciplines.set(disciplines);

        if (ps) {
          // Benefits default to "all included", which is what the engine does when the
          // request carries no explicit list.
          this.selectedCodes.set(new Set(ps.benefits.map(b => b.benefitCode)));
          // Pre-select a contract the referential actually covers — but only for a
          // candidate: on a collaborator an empty contract is what lets the backend
          // hydrate it from the HR fiche.
          const preferred = this.subject() === 'CANDIDATE' ? this.defaultContractType() : '';
          this.form.patchValue({ contractType: preferred }, { emitEvent: false });
          this.formValue.set(this.form.getRawValue());
          // Pré-remplissage (fiche ou « Dupliquer ») : contrat et avantages de la source.
          this.applyPendingPrefill();
        }
      });
  }

  // ── User actions ───────────────────────────────────────────────────────────

  // The three setters below take a plain `string`: `daf-radio-group`'s `selected` is a
  // `model<string>`, so the narrowing happens here rather than with a cast in the template.

  setSubject(value: string): void {
    const s = value as SimulationSubject;
    if (this.subject() === s) return;
    this.subject.set(s);
    this.result.set(null);
    this.error.set(null);
    // The two identities are exclusive: a collaborator's contract/grade/discipline are
    // hydrated from RH by the backend, so leaving stale free-text behind would silently
    // override them (request values win over the profile).
    if (s === 'EMPLOYEE') {
      // Contract cleared too: sent empty, the backend takes the one on the HR fiche.
      // Leaving the preselected CDI in place would silently override it.
      this.form.patchValue({
        candidateLabel: '', poste: '', grade: '', discipline: '', contractType: '',
      });
    } else {
      this.form.patchValue({ profileUserId: null, contractType: this.defaultContractType() });
    }
  }

  /** The contract the active referential prices by default — CDI when it covers one. */
  private defaultContractType(): string {
    const types = this.availableContractTypes();
    return types.includes('CDI') ? 'CDI' : types[0] ?? '';
  }

  setPeriod(value: string): void {
    const p = value as 'MONTHLY' | 'YEARLY';
    if (this.period() === p) return;
    this.period.set(p);
    this.result.set(null);
    this.error.set(null);
  }

  setMode(value: string): void {
    const m = value as SimulationMode;
    if (this.mode() === m) return;
    this.mode.set(m);
    this.result.set(null);
    this.error.set(null);
    // Swap required validators based on direction
    const netCtrl   = this.form.get('inputNet')!;
    const grossCtrl = this.form.get('inputGross')!;
    if (m === 'BRUT_TO_NET') {
      netCtrl.clearValidators();
      netCtrl.setValue(null, { emitEvent: false });
      grossCtrl.setValidators([Validators.required, Validators.min(1)]);
    } else {
      grossCtrl.clearValidators();
      grossCtrl.setValue(null, { emitEvent: false });
      netCtrl.setValidators([Validators.required, Validators.min(1)]);
    }
    netCtrl.updateValueAndValidity();
    grossCtrl.updateValueAndValidity();
    this.formValue.set(this.form.getRawValue());
  }

  toggleBenefit(code: string): void {
    this.setBenefit(code, !this.isBenefitSelected(code));
  }

  /**
   * Explicit set rather than a toggle, because `daf-checkbox` emits the value it has
   * just moved to. The row around it toggles as well and stops propagation, so the two
   * paths can never fire for one click and cancel each other out.
   */
  setBenefit(code: string, checked: boolean): void {
    const current = new Set(this.selectedCodes());
    if (checked) {
      current.add(code);
    } else {
      current.delete(code);
    }
    this.selectedCodes.set(current);
  }

  isBenefitSelected(code: string): boolean {
    return this.selectedCodes().has(code);
  }

  allBenefitsSelected(): boolean {
    const all = this.availableBenefits();
    return all.length > 0 && all.every(b => this.isBenefitSelected(b.benefitCode));
  }

  toggleAllBenefits(): void {
    this.selectedCodes.set(
      this.allBenefitsSelected()
        ? new Set()
        : new Set(this.availableBenefits().map(b => b.benefitCode)),
    );
  }

  /** A new result (fresh run or history entry) starts with empty table searches — a term
   *  left over from the previous simulation would otherwise hide lines of the new payslip. */
  private clearResultSearches(): void {
    this.rubriquesSearch.set('');
    this.costSearch.set('');
    this.irppSearch.set('');
    this.chargesSearch.set('');
  }

  /** Formulaire, sur l'étape où on l'a laissé, valeurs intactes (même composant, voir les routes). */
  backToForm(): void {
    this.router.navigate(['..', 'new'], { relativeTo: this.route });
  }

  backToList(): void {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  /** Free navigation — `(stepClick)` fires for every step because none is disabled. */
  goToStep(index: number): void {
    this.currentStep.set(Math.max(0, Math.min(this.steps().length - 1, index)));
  }

  nextStep(): void { this.goToStep(this.currentStep() + 1); }
  prevStep(): void { this.goToStep(this.currentStep() - 1); }

  /** Browser print — no dedicated `@media print` stylesheet exists yet, so this prints
   *  whatever is currently visible (the result view, if shown). */
  print(): void {
    window.print();
  }

  // ── Form plumbing for the lib inputs ───────────────────────────────────────
  // `daf-form-field` and `daf-select` are `model()`-based, not ControlValueAccessors,
  // so they bind through value/valueChange rather than formControlName.

  /** Current value of a text/number control, for `daf-form-field [value]`. */
  fieldValue(name: string): string | number | null {
    return this.form.get(name)?.value ?? null;
  }

  setFieldValue(name: string, value: string | number | null): void {
    this.form.get(name)?.setValue(value === '' ? null : value);
  }

  /** Same for a text control that must stay a string (never null). */
  setTextValue(name: string, value: string | number | null): void {
    this.form.get(name)?.setValue(value == null ? '' : String(value));
  }

  private selectionOf(name: string): string[] {
    const v = this.form.get(name)?.value;
    return v === null || v === undefined || v === '' ? [] : [String(v)];
  }

  /** `daf-select` emits `string[]`; single-select, so take the first (or clear). */
  setSelection(name: string, selected: string[]): void {
    this.form.get(name)?.setValue(selected[0] ?? '');
  }

  /** Country select — the control holds a number, the select speaks strings. */
  setPaysSelection(selected: string[]): void {
    const raw = selected[0];
    this.form.get('paysId')!.setValue(raw ? Number(raw) : null);
  }

  // ── Formatting ─────────────────────────────────────────────────────────────

  /** Amount + currency, or an em dash when there is nothing to show yet. */
  money(value: number | null | undefined, currency = '', decimals = 0): string {
    if (value == null || Number.isNaN(value)) return '—';
    const formatted = new Intl.NumberFormat(this.numberLocale(), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
    return currency ? `${formatted} ${currency}` : formatted;
  }

  /** A rate stored as a decimal (0.0918) shown as a percentage (9,18 %). */
  percent(rate: number | null | undefined): string {
    if (rate == null) return '—';
    return `${new Intl.NumberFormat(this.numberLocale(), { maximumFractionDigits: 2 }).format(rate * 100)} %`;
  }

  /** Upper bound of an IRPP bracket; the last one is open-ended. */
  bracketUpper(row: IrppBracketRow): string {
    return row.upper == null ? '∞' : this.money(row.upper, '', 0);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  submit(): void {
    if (!this.canSimulate()) return;
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);

    const v            = this.form.getRawValue();
    const isEmployee   = this.subject() === 'EMPLOYEE';
    const currentMode  = this.mode();
    const divisor      = this.period() === 'YEARLY' ? 12 : 1;

    this.api.runIndividualSimulation({
      paysId:     v.paysId!,
      mode:       currentMode,
      inputNet:   currentMode === 'NET_TO_BRUT' ? Number(v.inputNet)   / divisor : undefined,
      inputGross: currentMode === 'BRUT_TO_NET' ? Number(v.inputGross) / divisor : undefined,
      // Collaborator run: the backend hydrates contractType/grade/discipline from the RH
      // profile, but only for fields the request leaves blank — so they are not sent.
      profileUserId:  isEmployee ? v.profileUserId : null,
      // `||`, not `??`: the control holds '' (not null) when nothing is picked.
      contractType:   v.contractType || undefined,
      joursTravailes: v.joursTravailes ?? 22,
      // The engine treats `null` as "all benefits"; an explicit list is always sent so
      // unticking every box means none rather than all.
      selectedBenefitCodes: Array.from(this.selectedCodes()),
      candidateLabel: isEmployee ? undefined : (v.candidateLabel || undefined),
      poste:          isEmployee ? undefined : (v.poste || undefined),
      grade:          isEmployee ? undefined : (v.grade || undefined),
      discipline:     isEmployee ? undefined : (v.discipline || undefined),
    }).subscribe({
      next: res => {
        this.result.set(res);
        this.prefilledFrom = res.id;
        this.clearResultSearches();
        this.activeTab.set('overview');
        this.loading.set(false);
        // Le résultat a sa propre URL ; `onRouteChange` le trouve déjà en main.
        this.router.navigate(['..', res.id], { relativeTo: this.route });
      },
      error: err => {
        this.error.set(
          err?.error?.message ??
          (err?.status === 403
            ? this.t('PAYROLL.SIMULATOR.ERROR.FORBIDDEN')
            : this.t('PAYROLL.SIMULATOR.ERROR.GENERIC')),
        );
        this.loading.set(false);
      },
    });
  }

  // ── Exports — même comportement que Finance (rapport P&L, `ExportService.download`) :
  // fichier généré par le backend et enregistré tel quel ; en cas d'échec, le `detail` du
  // ProblemDetail en toast. Plus de `window.print()` silencieux ni de faux `.pdf`.

  exportXlsx(): void {
    const r = this.result();
    if (!r || this.xlsxGenerating()) return;
    this.xlsxGenerating.set(true);
    this.api.downloadSimulationXlsx(r.id, this.translate.currentLang() || 'fr').subscribe({
      next: blob => {
        this.xlsxGenerating.set(false);
        saveBlob(blob, `simulation-${r.id}.xlsx`);
      },
      error: err => this.exportFailed(err, this.xlsxGenerating),
    });
  }

  exportPdf(): void {
    const r = this.result();
    if (!r || this.pdfGenerating()) return;
    this.pdfGenerating.set(true);
    this.api.downloadSimulationPdf(r.id).subscribe({
      next: blob => {
        this.pdfGenerating.set(false);
        saveBlob(blob, `simulation-${r.id}.pdf`);
      },
      error: err => this.exportFailed(err, this.pdfGenerating),
    });
  }

  private exportFailed(err: unknown, busy: { set(v: boolean): void }): void {
    busy.set(false);
    readBlobError(err, this.t('PAYROLL.SIMULATOR.RESULT.EXPORT_ERROR'))
      .then(msg => this.notify.error(msg));
  }

  reset(): void {
    this.form.reset({ contractType: '', joursTravailes: 22 });
    // Restore NET_TO_BRUT validators (default state after reset)
    this.form.get('inputNet')!.setValidators([Validators.required, Validators.min(1)]);
    this.form.get('inputGross')!.clearValidators();
    this.form.get('inputNet')!.updateValueAndValidity();
    this.form.get('inputGross')!.updateValueAndValidity();
    this.formValue.set(this.form.getRawValue());
    this.subject.set('CANDIDATE');
    this.mode.set('NET_TO_BRUT');
    this.period.set('MONTHLY');
    this.currentStep.set(0);
    this.resultView.set(false);
    this.result.set(null);
    this.error.set(null);
    this.activePs.set(null);
    this.psState.set('IDLE');
    this.selectedCodes.set(new Set());
    this.pendingPrefill = null;
    // Grade/discipline lists are NOT cleared: `form.reset()` above already pushed
    // `paysId: null` through valueChanges, which re-requests the global lists.
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
