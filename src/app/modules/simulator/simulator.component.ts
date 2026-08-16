import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
  OnDestroy,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  PayrollApiService,
  SimulationResultDto,
  SimulationMode,
  ParameterSetDto,
  PaysDto,
  RubriqueAppliedItem,
  SocialChargeRateDto,
  parseRubriquesApplied,
} from '../../core/payroll-api.service';
import { HrRefApiService, ConfigurableListValueDto } from '../../core/hr-ref-api.service';
import { UserStore } from '../../core/user.store';
import { EmployeeSelectComponent } from '../../shared/employee-select/employee-select.component';
import { Subject, takeUntil, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  AccordionCardComponent,
  ButtonComponent,
  CardComponent,
  CheckboxComponent,
  DrawerComponent,
  FormFieldComponent,
  PageHeaderComponent,
  RadioGroupComponent,
  SectionTitleComponent,
  SelectComponent,
  SkeletonComponent,
  StatusBadgeComponent,
  StepperComponent,
} from '@khalilrebhiitec/daf360';
import type {
  BadgeOptions,
  BreadcrumbItem,
  PageHeaderBadge,
  RadioOption,
  SelectOption,
  StepperStep,
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
    CommonModule, ReactiveFormsModule, TranslatePipe, EmployeeSelectComponent,
    AccordionCardComponent, ButtonComponent, CardComponent, CheckboxComponent,
    DrawerComponent, FormFieldComponent, PageHeaderComponent, RadioGroupComponent,
    SectionTitleComponent, SelectComponent, SkeletonComponent, StatusBadgeComponent,
    StepperComponent,
  ],
  // Pas de `styleUrl` : Tailwind + composants de la lib uniquement, comme les autres
  // modules. La feuille de composant qui portait la mise en page a été supprimée.
  templateUrl: './simulator.component.html',
})
export class SimulatorComponent implements OnDestroy {
  private readonly api      = inject(PayrollApiService);
  private readonly hrRef    = inject(HrRefApiService);
  private readonly fb       = inject(FormBuilder);
  private readonly translate = inject(TranslateService);
  readonly userStore        = inject(UserStore);
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
   * First reference load only — it swaps the work zone for `daf-skeleton` blocks. Kept
   * strictly separate from `loading`, which every "Simuler" click flips: wiring the
   * skeleton to that one would blank the form the user had just filled in
   * (UI-PLAYBOOK §5). The page header stays mounted throughout.
   */
  readonly firstLoad     = signal(true);
  readonly loading       = signal(false);
  readonly error         = signal<string | null>(null);
  readonly result        = signal<SimulationResultDto | null>(null);
  readonly pdfGenerating = signal(false);

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
  /** `GET /api/payroll/simulations/individual/history` — permission-gated (see below). */
  readonly history     = signal<SimulationResultDto[]>([]);

  /** `daf-drawer` open state for the recent runs — driven from the page-header action
   *  (the drawer runs with `showToggle: false`, so this is its only way in). */
  readonly historyOpen = signal(false);

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

  /** The charge lines that will actually be applied — active set ∩ chosen contract. */
  readonly applicableCharges = computed((): SocialChargeRateDto[] => {
    const contract = this.formValue().contractType;
    return (this.activePs()?.socialChargeRates ?? [])
      .filter(r => r.contractType === contract)
      .sort((a, b) => (a.evalOrder ?? 0) - (b.evalOrder ?? 0));
  });

  /** The IRPP scale of the active set. Stored as JSON, `{lower,upper,rate}` with
   *  `{min,max}` accepted as aliases (the engine reads both). */
  readonly irppBrackets = computed((): IrppBracketRow[] => {
    const raw = this.activePs()?.irppBrackets;
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
  });

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

  /** History is behind its own codes — RUN_SIMULATION alone gets a 403 there, so the
   *  panel is only requested and only rendered when the user may read it. */
  readonly canViewHistory = computed(() =>
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
  readonly paysSelection       = computed(() => this.selectionOf('paysId'));
  readonly gradeSelection      = computed(() => this.selectionOf('grade'));
  readonly disciplineSelection = computed(() => this.selectionOf('discipline'));
  readonly contractSelection   = computed(() => this.selectionOf('contractType'));

  /** Status chips on the title line: currency, direction, convergence. */
  readonly headerBadges = computed((): PageHeaderBadge[] => {
    const r = this.result();
    if (!r) return [];
    const badges: PageHeaderBadge[] = [];
    if (r.localCurrency) {
      badges.push({ label: r.localCurrency, variant: 'primary', size: 'sm' });
    }
    badges.push({
      label:   this.t(`PAYROLL.SIMULATOR.MODE.${r.mode === 'BRUT_TO_NET' ? 'BRUT_TO_NET' : 'NET_TO_BRUT'}`),
      variant: 'secondary',
      size:    'sm',
    });
    if (!r.convergenceOk) {
      badges.push({
        label: this.t('PAYROLL.SIMULATOR.BADGE.PARTIAL_CONVERGENCE'),
        variant: 'warning', size: 'sm', dot: true,
      });
    }
    return badges;
  });

  readonly breadcrumbs = computed((): BreadcrumbItem[] => [
    { label: this.t('PAYROLL.COMMON.BREADCRUMB_ROOT'), link: '/payroll' },
    { label: this.t('PAYROLL.SIMULATOR.BREADCRUMB') },
  ]);

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
  readonly steps = computed((): StepperStep[] => [
    {
      title:     this.t('PAYROLL.SIMULATOR.STEPPER.S1_TITLE'),
      subtitle:  this.selectedPays()?.frenchLabel
                   ?? this.t('PAYROLL.SIMULATOR.STEPPER.S1_SUBTITLE_EMPTY'),
      icon:      'public',
      completed: this.step1Done(),
    },
    {
      title:     this.t('PAYROLL.SIMULATOR.STEPPER.S2_TITLE'),
      subtitle:  this.modeLabel(),
      icon:      'payments',
      completed: this.step2Done(),
    },
    {
      title:     this.t('PAYROLL.SIMULATOR.STEPPER.S3_TITLE'),
      subtitle:  this.availableBenefits().length
                   ? this.t('PAYROLL.SIMULATOR.STEPPER.S3_SUBTITLE', {
                       selected: this.selectedCodes().size,
                       total:    this.availableBenefits().length,
                     })
                   : this.t('PAYROLL.SIMULATOR.STEPPER.S3_SUBTITLE_EMPTY'),
      icon:      'redeem',
      completed: this.step3Done(),
    },
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
        this.history.set([]);
        // Grade/discipline/contract belong to the previous country's referential, and a
        // collaborator picked under it is no longer in scope either.
        this.form.patchValue(
          { grade: '', discipline: '', contractType: '', profileUserId: null },
          { emitEvent: false },
        );
        this.formValue.set(this.form.getRawValue());

        if (paysId) {
          this.loadCountryData(paysId);
        } else {
          this.psState.set('IDLE');
          this.loadGradesAndDisciplines();
        }
      });
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
        }
      });

    this.loadHistory(paysId);
  }

  private loadHistory(paysId: number): void {
    if (!this.canViewHistory()) return;
    this.api.getSimulationHistory(paysId)
      .pipe(catchError(() => of([] as SimulationResultDto[])), takeUntil(this.destroy$))
      .subscribe(list => this.history.set(
        [...list].sort((a, b) => b.simulatedAt.localeCompare(a.simulatedAt)).slice(0, 8),
      ));
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

  /** Re-open a past run in the result panel. The DTO is complete, so nothing is refetched. */
  openHistoryEntry(entry: SimulationResultDto): void {
    this.result.set(entry);
    this.error.set(null);
  }

  toggleHistory(): void {
    this.historyOpen.update(v => !v);
  }

  /** Free navigation — `(stepClick)` fires for every step because none is disabled. */
  goToStep(index: number): void {
    this.currentStep.set(Math.max(0, Math.min(this.steps().length - 1, index)));
  }

  nextStep(): void { this.goToStep(this.currentStep() + 1); }
  prevStep(): void { this.goToStep(this.currentStep() - 1); }

  /** Browser print — the stylesheet keeps only the result column (see the `@media print`
   *  block), so this prints the simulation and not the form. */
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
        this.loading.set(false);
        const paysId = this.form.getRawValue().paysId;
        if (paysId) this.loadHistory(paysId);
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

  exportPdf(): void {
    const r = this.result();
    if (!r) return;
    this.pdfGenerating.set(true);
    this.api.downloadSimulationPdf(r.id).subscribe({
      next: blob => {
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href     = url;
        link.download = `simulation-${r.id}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
        this.pdfGenerating.set(false);
      },
      error: () => {
        window.print();
        this.pdfGenerating.set(false);
      },
    });
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
    this.result.set(null);
    this.error.set(null);
    this.activePs.set(null);
    this.psState.set('IDLE');
    this.selectedCodes.set(new Set());
    this.history.set([]);
    // Grade/discipline lists are NOT cleared: `form.reset()` above already pushed
    // `paysId: null` through valueChanges, which re-requests the global lists.
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
