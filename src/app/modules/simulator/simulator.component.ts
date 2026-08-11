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
  RubriqueAppliedItem,
  parseRubriquesApplied,
} from '../../core/payroll-api.service';
import { HrRefApiService, ConfigurableListValueDto } from '../../core/hr-ref-api.service';
import { UserStore } from '../../core/user.store';
import { PaysSelectComponent } from '../../shared/pays-select/pays-select.component';
import { Subject, takeUntil, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  ButtonComponent,
  CardComponent,
  PageComponent,
  PageHeaderComponent,
} from '@khalilrebhiitec/daf360';

@Component({
  selector: 'app-simulator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule, PaysSelectComponent,
    ButtonComponent, CardComponent, PageComponent, PageHeaderComponent,
  ],
  templateUrl: './simulator.component.html',
  styleUrl: './simulator.component.scss',
})
export class SimulatorComponent implements OnDestroy {
  private readonly api        = inject(PayrollApiService);
  private readonly hrRef      = inject(HrRefApiService);
  private readonly fb         = inject(FormBuilder);
  readonly userStore          = inject(UserStore);
  private readonly destroy$   = new Subject<void>();

  readonly loading        = signal(false);
  readonly loadingRefs    = signal(false);
  readonly error          = signal<string | null>(null);
  readonly result         = signal<SimulationResultDto | null>(null);
  readonly activePs       = signal<ParameterSetDto | null>(null);
  readonly selectedCodes  = signal<Set<string>>(new Set());
  readonly pdfGenerating  = signal(false);
  readonly grades         = signal<ConfigurableListValueDto[]>([]);
  readonly disciplines    = signal<ConfigurableListValueDto[]>([]);
  /** Current simulation direction — drives the segmented toggle and conditional input. */
  readonly mode           = signal<SimulationMode>('NET_TO_BRUT');
  /** Monthly or yearly input — the API always receives monthly figures; yearly values are divided by 12. */
  readonly period         = signal<'MONTHLY' | 'YEARLY'>('MONTHLY');

  readonly form = this.fb.group({
    paysId:         [null as number | null, [Validators.required]],
    inputNet:       [null as number | null, [Validators.required, Validators.min(1)]],
    inputGross:     [null as number | null],  // used when mode = BRUT_TO_NET
    contractType:   ['CDI'],
    joursTravailes: [22, [Validators.min(1), Validators.max(31)]],
    candidateLabel: [''],
    poste:          [''],
    grade:          [''],
    discipline:     [''],
  });

  readonly convergenceWarning = computed(() => {
    const r = this.result();
    return r && !r.convergenceOk;
  });

  /** Rubrique lines with their computed amounts, parsed from the JSON blob. */
  readonly parsedRubriques = computed((): RubriqueAppliedItem[] => {
    const r = this.result();
    return r ? parseRubriquesApplied(r.rubriquesApplied) : [];
  });

  readonly availableBenefits = computed(() => this.activePs()?.benefits ?? []);

  /** Distinct contract types from the active parameter set's social charge rates.
   *  Falls back to sensible defaults when no parameter set is loaded yet. */
  readonly availableContractTypes = computed((): string[] => {
    const ps = this.activePs();
    if (!ps?.socialChargeRates?.length) return ['CDI', 'CDD', 'STAGE', 'CIVP'];
    return [...new Set(ps.socialChargeRates.map(r => r.contractType))].sort();
  });

  constructor() {
    // Load grades & disciplines immediately so selects are usable before a country is chosen
    this.loadGradesAndDisciplines();

    this.form.get('paysId')!.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(paysId => {
        this.activePs.set(null);
        this.selectedCodes.set(new Set());
        this.result.set(null);
        this.form.patchValue({ grade: '', discipline: '', contractType: 'CDI' },
                              { emitEvent: false });
        if (paysId) {
          this.loadReferenceData(paysId);
        } else {
          // Country cleared — reload global (unpaysId'd) lists
          this.loadGradesAndDisciplines();
        }
      });
  }

  /** Loads grade + discipline lists; when paysId is provided, filters to country-specific values. */
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

  private loadReferenceData(paysId: number): void {
    this.loadingRefs.set(true);

    forkJoin({
      ps:          this.api.getActiveParameterSet(paysId)
                       .pipe(catchError(() => of(null))),
      grades:      this.hrRef.listGrades(paysId)
                       .pipe(catchError(() => of([] as ConfigurableListValueDto[]))),
      disciplines: this.hrRef.listDisciplines(paysId)
                       .pipe(catchError(() => of([] as ConfigurableListValueDto[]))),
    }).pipe(takeUntil(this.destroy$))
      .subscribe(({ ps, grades, disciplines }) => {
        this.activePs.set(ps);
        if (ps) {
          this.selectedCodes.set(new Set(ps.benefits.map(b => b.benefitCode)));
        }
        this.grades.set(grades);
        this.disciplines.set(disciplines);
        this.loadingRefs.set(false);
      });
  }

  setPeriod(p: 'MONTHLY' | 'YEARLY'): void {
    this.period.set(p);
    this.result.set(null);
    this.error.set(null);
  }

  setMode(m: SimulationMode): void {
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
  }

  toggleBenefit(code: string): void {
    const current = new Set(this.selectedCodes());
    if (current.has(code)) {
      current.delete(code);
    } else {
      current.add(code);
    }
    this.selectedCodes.set(current);
  }

  isBenefitSelected(code: string): boolean {
    return this.selectedCodes().has(code);
  }

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);

    const v = this.form.getRawValue();
    const ps = this.activePs();
    const selectedBenefitCodes = ps
      ? Array.from(this.selectedCodes())
      : undefined;

    const currentMode = this.mode();
    const divisor = this.period() === 'YEARLY' ? 12 : 1;
    this.api.runIndividualSimulation({
      paysId:              v.paysId!,
      mode:                currentMode,
      inputNet:            currentMode === 'NET_TO_BRUT' ? v.inputNet!   / divisor : undefined,
      inputGross:          currentMode === 'BRUT_TO_NET' ? v.inputGross! / divisor : undefined,
      contractType:        v.contractType ?? 'CDI',
      joursTravailes:      v.joursTravailes ?? 22,
      selectedBenefitCodes,
      candidateLabel:      v.candidateLabel || undefined,
      poste:               v.poste || undefined,
      grade:               v.grade || undefined,
      discipline:          v.discipline || undefined,
    }).subscribe({
      next: res => {
        this.result.set(res);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err?.error?.message ?? 'Erreur lors de la simulation');
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
    this.form.reset({ contractType: 'CDI', joursTravailes: 22 });
    // Restore NET_TO_BRUT validators (default state after reset)
    this.form.get('inputNet')!.setValidators([Validators.required, Validators.min(1)]);
    this.form.get('inputGross')!.clearValidators();
    this.form.get('inputNet')!.updateValueAndValidity();
    this.form.get('inputGross')!.updateValueAndValidity();
    this.mode.set('NET_TO_BRUT');
    this.period.set('MONTHLY');
    this.result.set(null);
    this.error.set(null);
    this.activePs.set(null);
    this.selectedCodes.set(new Set());
    this.grades.set([]);
    this.disciplines.set([]);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
