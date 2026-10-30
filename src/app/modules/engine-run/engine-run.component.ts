import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { catchError, of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ButtonComponent,
  CardComponent,
  FormFieldComponent,
  ModalService,
  PageComponent,
  PageHeaderComponent,
  SectionCardComponent,
  SelectComponent,
  StatusBadgeComponent,
  deriveInitials,
  type BadgeVariant,
  type MetricDelta,
  type PageHeaderBadge,
  type SelectOption,
} from '@khalilrebhiitec/daf360';
import { PayrollApiService, PaysDto } from '../../core/payroll-api.service';
import { PayrollEngineService, RunPayrollResponse } from '../../core/payroll-engine.service';
import { readBlobError, saveBlob } from '../../shared/blob-download';
import { PayslipBulletinComponent, employerCostOf, type PayslipDeltas } from '../../shared/payslip-bulletin/payslip-bulletin.component';
import { EmployeeListItem, HrProfileService, contractTypeLabel } from '../../core/hr-profile.service';
import { NotificationService } from '../../core/notification.service';
import { PaysNamesService } from '../../core/pays-names.service';

/** One tile in the input sidebar's "recent presets" strip — saved to `localStorage`
 *  after each successful run, not backed by any API (no preset endpoint exists). */
interface EnginePreset {
  key: string;
  chipLabel: string;
  paysId: number;
  employeeId: number;
  employeeLabel: string;
  periodYear: number;
  periodMonth: number;
  contractTypeCode: string;
  joursOuvresMois: number;
}

/** Ce qui a servi au calcul affiché, figé au lancement (le formulaire peut changer ensuite). */
interface RunContext {
  employeeId: number;
  employeeName: string;
  paysId: number;
  periodYear: number;
  periodMonth: number;
  contractTypeCode: string;
  jours: number;
}

const PRESETS_STORAGE_KEY = 'payroll.engineRun.recentPresets';
const MAX_PRESETS = 5;

/**
 * `/payroll/engine-run` — same two-column layout as `/payroll/engine-results/:id`: page
 * title + sticky "Paramètres de calcul" card (left, 30 %) next to the results (right, 70 %:
 * KPIs, cost breakdown, strata summary, rubriques), so a payroll manager can
 * tweak one parameter and re-run without losing the result on screen.
 *
 * A few things the redesign brief asked for have no backing data anywhere in this app yet
 * (contractual hourly base, personalized PAS rate, Navigo/meal-voucher amounts, collective-
 * agreement/IDCC code, employee grade/échelon, a per-rubrique employer-charges split) —
 * `RunPayrollResponse`/`PaysDto`/`EmployeeListItem` carry none of it. Rather than hardcode
 * placeholder numbers that would look real, those pieces (the "Hypothèses de calcul" panel,
 * the convention-collective subtitle, the employer/employee 3-way column split) are left out
 * until the backend has the fields; everything else in the brief is built from real data.
 */
@Component({
  selector: 'app-engine-run',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, TranslatePipe,
    ButtonComponent, CardComponent, FormFieldComponent, PageComponent, PageHeaderComponent,
    SectionCardComponent, SelectComponent, StatusBadgeComponent, PayslipBulletinComponent,
  ],
  templateUrl: './engine-run.component.html',
  styleUrl: './engine-run.component.scss',
})
export class EngineRunComponent implements OnInit {
  private readonly api          = inject(PayrollEngineService);
  private readonly payrollApi   = inject(PayrollApiService);
  private readonly translate    = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);
  private readonly notification = inject(NotificationService);
  private readonly hrProfiles   = inject(HrProfileService);
  private readonly modalService = inject(ModalService);
  private readonly router       = inject(Router);
  private readonly route        = inject(ActivatedRoute);
  private readonly destroyRef   = inject(DestroyRef);

  /** Même pattern que les autres pages : traduction synchrone pour ce qui ne passe pas
   *  par le pipe `| translate` du template. */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly running = signal(false);
  readonly error   = signal<string | null>(null);
  readonly result  = signal<RunPayrollResponse | null>(null);
  /** « Coût pour l'entreprise » du bulletin (cotisations patronales, coût employeur). */
  readonly employerCost = computed(() => employerCostOf(this.result()));

  /** Pastille du titre de page : le calcul affiché est ENREGISTRÉ (chaque lancement insère un
   *  résultat de paie côté serveur), avec son numéro pour le retrouver dans « Résultats de
   *  paie ». Remplace l'ancienne pastille de convergence : le moteur ne la passe jamais à
   *  l'échec, elle affichait toujours « Algorithme convergé ». */
  readonly headerBadges = computed((): PageHeaderBadge[] => {
    const r = this.result();
    if (!r) return [];
    return [{
      label: this.t('PAYROLL.ENGINE_RUN.SAVED_BADGE', { id: r.resultId }),
      variant: 'success',
      dot: true,
    }];
  });

  // ── Pays ──────────────────────────────────────────────────────────────
  // `daf-page`'s `[loading]` skeleton, like every other payroll/finance page, guards
  // the ONE blocking initial fetch (the pays list) — not `running()`, which must leave
  // the sidebar on screen (see the cockpit's whole point: adjust a parameter without
  // losing the result).
  readonly pageLoading = signal(true);
  private readonly paysList = signal<PaysDto[]>([]);
  readonly paysId = signal<number | null>(null);
  /** Pays du dernier calcul lancé — fixe la devise du résultat affiché. */
  private readonly runPaysId = signal<number | null>(null);
  /** Même libellé que les autres pages (« Tunisie (TN) ») — plus de drapeau emoji, rendu
   *  en lettres « TN » sous Windows ; la lib n'accepte un drapeau qu'en `imageUrl`. */
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({
      value: String(p.id),
      label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})`,
    })),
  );

  ngOnInit(): void {
    this.payrollApi.listPays().subscribe({
      next: list => { this.paysList.set(list); this.pageLoading.set(false); },
      error: () => this.pageLoading.set(false),
    });
    this.recentPresets.set(this.loadPresetsFromStorage());

    // Arrivée depuis la fiche « Salaires des collaborateurs » (« Calculer sa paie ») :
    // `?pays=` et `?employee=` pré-sélectionnent le pays puis le collaborateur, une fois la
    // liste de ses collègues chargée (voir `loadEmployees`).
    const params = this.route.snapshot.queryParamMap;
    const pays = Number(params.get('pays'));
    const employee = Number(params.get('employee'));
    if (pays > 0) {
      if (employee > 0) this.pendingEmployeeId = employee;
      this.onPaysChange([String(pays)]);
    }
  }

  /** Collaborateur à sélectionner dès que la liste du pays arrive (`?employee=`). */
  private pendingEmployeeId: number | null = null;

  /** Changement de pays depuis le select : la liste des salariés suit, le salarié choisi
   *  (d'un autre pays) est retiré. */
  onPaysChange(selected: string[]): void {
    const id = selected[0] ? +selected[0] : null;
    if (id === this.paysId()) return;
    this.paysId.set(id);
    this.employeeId.set(null);
    this.loadCountry(id);
  }

  /** Tout ce qui dépend du pays : ses salariés et les contrats de son jeu de paramètres. */
  private loadCountry(paysId: number | null): void {
    this.loadEmployees(paysId);
    this.loadContractTypes(paysId);
  }

  // ── Salarié — `daf-select` recherchable de la lib, comme /payroll/simulator : les
  //    salariés du pays sont chargés en une fois (`loadEmployees`), la lib filtre ensuite
  //    en local. Libellé : « Nom · matricule · contrat ».
  readonly employeeId       = signal<number | null>(null);
  readonly employeesOfPays  = signal<EmployeeListItem[]>([]);
  readonly employeesLoading = signal(false);

  readonly employeeOptions = computed<SelectOption[]>(() =>
    this.employeesOfPays().map(e => ({
      value: String(e.userId),
      label: [e.fullName, e.employeeId, e.contractType ? contractTypeLabel(e.contractType, this.translate) : null]
        .filter(Boolean).join(' · '),
    })),
  );

  readonly employeeSelection = computed(() => {
    const id = this.employeeId();
    return id == null ? [] : [String(id)];
  });

  readonly selectedEmployee = computed(() =>
    this.employeesOfPays().find(e => e.userId === this.employeeId()) ?? null);

  /** Choix d'un collaborateur : son contrat de la fiche RH est repris d'office quand le jeu
   *  du pays le tarifie (avant : CDI pour tout le monde). Un préréglage passe par
   *  `loadPreset`, qui garde le contrat qu'il avait mémorisé. */
  setEmployeeSelection(selected: string[]): void {
    this.employeeId.set(selected[0] ? +selected[0] : null);
    const hr = this.employeeHrContract();
    if (hr && this.contractTypes().includes(hr)) this.contractTypeCode.set(hr);
  }

  /** Anciens codes RH (assistant d'intégration d'avant migration) → codes de la paie. */
  private static readonly LEGACY_CONTRACT: Record<string, string> = {
    PERMANENT: 'CDI', FIXED_TERM: 'CDD', INTERN: 'STAGE',
  };

  /** Contrat de la fiche RH du collaborateur choisi, en code de la paie (« CDI », « CIVP »…). */
  private readonly employeeHrContract = computed(() => {
    const code = this.selectedEmployee()?.contractType?.trim().toUpperCase();
    return code ? (EngineRunComponent.LEGACY_CONTRACT[code] ?? code) : null;
  });

  /** Aide sous le select du contrat : d'où vient la valeur, ou pourquoi elle diffère de la
   *  fiche RH. Vide tant qu'aucun collaborateur n'est choisi. */
  readonly contractHint = computed(() => {
    const hr = this.employeeHrContract();
    if (!hr || !this.contractTypes().length) return '';
    const contract = contractTypeLabel(hr, this.translate);
    if (!this.contractTypes().includes(hr)) return this.t('PAYROLL.ENGINE_RUN.CONTRACT_HR_NOT_PRICED', { contract });
    return this.contractTypeCode() === hr
      ? this.t('PAYROLL.ENGINE_RUN.CONTRACT_FROM_HR')
      : this.t('PAYROLL.ENGINE_RUN.CONTRACT_HR_DIFFERS', { contract });
  });

  /** Collaborateur sorti ou archivé : le calcul reste possible, mais signalé. */
  readonly employeeExitWarning = computed(() => {
    const status = this.selectedEmployee()?.lifecycleStatus;
    if (status !== 'TERMINATED' && status !== 'ARCHIVED') return null;
    return this.t('PAYROLL.ENGINE_RUN.EXIT_WARNING', {
      status: this.t(`PAYROLL.ENGINE_RUN.LIFECYCLE.${status}`).toLowerCase(),
    });
  });

  // ── Calculs déjà enregistrés du collaborateur choisi — pour prévenir qu'un nouveau
  //    lancement sur le même mois AJOUTE un résultat (le serveur ne remplace jamais). ──
  private readonly employeeResults = signal<RunPayrollResponse[]>([]);
  private resultsSeq = 0;

  private readonly loadEmployeeResults = effect(() => {
    const id = this.employeeId();
    const seq = ++this.resultsSeq;
    untracked(() => {
      this.employeeResults.set([]);
      if (id == null) return;
      this.api.getResults(id)
        .pipe(catchError(() => of([] as RunPayrollResponse[])), takeUntilDestroyed(this.destroyRef))
        .subscribe(list => { if (seq === this.resultsSeq) this.employeeResults.set(list); });
    });
  });

  /** Dernier résultat déjà enregistré pour ce collaborateur et ce mois, s'il y en a un. */
  readonly existingResult = computed(() => {
    const y = this.periodYear(), m = this.periodMonth();
    return this.employeeResults()
      .filter(r => r.periodYear === y && r.periodMonth === m)
      .sort((a, b) => (b.resultId ?? 0) - (a.resultId ?? 0))[0] ?? null;
  });

  /** « octobre 2026 » — la période en toutes lettres, pour les messages. */
  private periodText(year: number, month: number): string {
    const locale = this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
    return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }

  /** Bandeau « un calcul existe déjà » — pas pour le calcul qu'on vient de lancer et qui est
   *  affiché (la pastille « Enregistré · Résultat n° » le dit déjà). La confirmation au clic
   *  sur « Lancer », elle, reste (voir `run()`). */
  readonly existingWarning = computed(() => {
    const r = this.existingResult();
    if (r && r.resultId === this.result()?.resultId) return null;
    return r ? this.t('PAYROLL.ENGINE_RUN.EXISTING_WARNING', {
      period: this.periodText(r.periodYear, r.periodMonth), id: r.resultId,
    }) : null;
  });

  private employeesSeq = 0;
  private loadEmployees(paysId: number | null): void {
    const seq = ++this.employeesSeq;
    this.employeesOfPays.set([]);
    if (paysId == null) { this.employeesLoading.set(false); return; }
    this.employeesLoading.set(true);
    this.hrProfiles.listEmployees({ paysId, page: 0, size: 1000, sort: 'fullName,asc' })
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe(page => {
        if (seq !== this.employeesSeq) return;   // réponse dépassée (pays changé entre-temps)
        const list = page?.content ?? [];
        this.employeesOfPays.set(list);
        this.employeesLoading.set(false);
        // Collaborateur demandé par l'adresse : sélection comme un choix dans la liste (son
        // contrat de la fiche RH est alors repris).
        const pending = this.pendingEmployeeId;
        this.pendingEmployeeId = null;
        if (pending != null && list.some(e => e.userId === pending)) {
          this.setEmployeeSelection([String(pending)]);
          return;
        }
        // Salarié d'un préréglage qui n'est plus dans la liste du pays : on le retire
        // plutôt que de garder un id que le select n'affiche pas.
        const id = this.employeeId();
        if (id != null && !list.some(e => e.userId === id)) this.employeeId.set(null);
      });
  }

  private static readonly LIFECYCLE_VARIANT: Record<string, BadgeVariant> = {
    ACTIVE: 'success', ON_MISSION: 'success', ON_LEAVE: 'warning',
    PRE_ONBOARDING: 'info', OFFBOARDING: 'warning', TERMINATED: 'danger', ARCHIVED: 'neutral',
  };

  readonly employeeStatusBadge = computed(() => {
    const status = this.selectedEmployee()?.lifecycleStatus;
    if (!status) return null;
    return {
      label: this.t(`PAYROLL.ENGINE_RUN.LIFECYCLE.${status}`),
      variant: EngineRunComponent.LIFECYCLE_VARIANT[status] ?? 'neutral',
    };
  });

  // ── Période : deux listes, Mois et Année — le moteur de paie n'a pas de notion de jour,
  //    et la lib n'a pas de sélecteur de mois (l'ancien calendrier faisait choisir un jour
  //    sans effet). `periodDate` reste la source, au 1er du mois.
  readonly periodDate = signal<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly periodYear  = computed(() => this.periodDate().getFullYear());
  readonly periodMonth = computed(() => this.periodDate().getMonth() + 1);

  /** Janvier … Décembre, dans la langue courante. */
  readonly monthOptions = computed<SelectOption[]>(() => {
    const locale = this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
    return Array.from({ length: 12 }, (_, i) => {
      const name = new Date(2000, i, 1).toLocaleDateString(locale, { month: 'long' });
      return { value: String(i + 1), label: name.charAt(0).toUpperCase() + name.slice(1) };
    });
  });

  /** Trois ans en arrière jusqu'à l'an prochain — plus l'année affichée si elle sort de
   *  cette plage (préréglage ancien). */
  readonly yearOptions = computed<SelectOption[]>(() => {
    const now = new Date().getFullYear();
    const years = new Set<number>([now - 3, now - 2, now - 1, now, now + 1, this.periodYear()]);
    return [...years].sort((a, b) => b - a).map(y => ({ value: String(y), label: String(y) }));
  });

  setPeriodMonth(selected: string[]): void {
    if (selected[0]) this.periodDate.set(new Date(this.periodYear(), +selected[0] - 1, 1));
  }

  setPeriodYear(selected: string[]): void {
    if (selected[0]) this.periodDate.set(new Date(+selected[0], this.periodMonth() - 1, 1));
  }

  readonly joursOuvresMois = signal(22);
  readonly contractTypeCode = signal('');

  // ── Type de contrat — comme /payroll/simulator : les contrats que le jeu de paramètres
  //    actif du pays tarifie (`socialChargeRates`), plus de liste « CDI, CDD, STAGE, CIVP »
  //    en dur, qui envoyait le moteur en 500 sur un contrat non tarifé. Pas de jeu actif
  //    (404) = aucun contrat proposé, et le calcul ne peut pas partir.
  readonly contractTypes        = signal<string[]>([]);
  readonly contractTypesLoading = signal(false);
  /** `true` quand le pays est choisi mais n'a aucun jeu de paramètres actif. */
  readonly parameterSetMissing  = signal(false);

  /** Contrats en clair (« Contrat à durée indéterminée »…) ; le code reste la valeur envoyée. */
  readonly contractTypeOptions = computed<SelectOption[]>(() =>
    this.contractTypes().map(ct => ({ value: ct, label: contractTypeLabel(ct, this.translate) })));

  readonly contractPlaceholder = computed(() =>
    !this.paysId()                ? this.t('PAYROLL.ENGINE_RUN.CONTRACT_NO_PAYS')
    : this.contractTypesLoading() ? this.t('PAYROLL.COMMON.LOADING')
    : this.parameterSetMissing()  ? this.t('PAYROLL.ENGINE_RUN.CONTRACT_NO_PS')
    :                               this.t('PAYROLL.ENGINE_RUN.CONTRACT_PLACEHOLDER'));

  private contractSeq = 0;
  private loadContractTypes(paysId: number | null): void {
    const seq = ++this.contractSeq;
    this.contractTypes.set([]);
    this.parameterSetMissing.set(false);
    if (paysId == null) { this.contractTypesLoading.set(false); this.contractTypeCode.set(''); return; }
    this.contractTypesLoading.set(true);
    this.payrollApi.getActiveParameterSet(paysId)
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe(ps => {
        if (seq !== this.contractSeq) return;   // réponse dépassée (pays changé entre-temps)
        const types = [...new Set((ps?.socialChargeRates ?? []).map(r => r.contractType))].sort();
        this.contractTypes.set(types);
        this.parameterSetMissing.set(!ps);
        this.contractTypesLoading.set(false);
        // Garde le contrat déjà choisi (préréglage) s'il est tarifé, sinon celui de la fiche RH
        // du collaborateur, sinon CDI, sinon le premier.
        const current = this.contractTypeCode();
        const hr = this.employeeHrContract();
        if (!types.includes(current)) {
          this.contractTypeCode.set(
            hr && types.includes(hr) ? hr : types.includes('CDI') ? 'CDI' : types[0] ?? '');
        }
      });
  }

  canRun(): boolean {
    const jours = this.joursOuvresMois();
    return !!this.paysId() && !!this.employeeId() && !!this.contractTypeCode() && jours >= 1;
  }

  reset(): void {
    this.employeeId.set(null);
    this.paysId.set(null);
    this.loadCountry(null);
    this.periodDate.set(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    this.joursOuvresMois.set(22);
    this.result.set(null);
    this.runContext.set(null);
    this.compareResult.set(null);
    this.error.set(null);
  }

  /** Bouton « Lancer le calcul » : si ce collaborateur a déjà un résultat pour ce mois,
   *  confirmation d'abord — un nouveau lancement AJOUTE un résultat, il ne remplace pas
   *  l'existant (comportement du serveur). */
  run(): void {
    if (!this.canRun()) return;
    const existing = this.existingResult();
    if (!existing) { this.doRun(); return; }
    this.modalService.open({
      title: this.t('PAYROLL.ENGINE_RUN.EXISTING_CONFIRM_TITLE'),
      icon: 'warning',
      size: 'sm',
      body: this.t('PAYROLL.ENGINE_RUN.EXISTING_CONFIRM_BODY', {
        name: this.selectedEmployee()?.fullName ?? '',
        period: this.periodText(existing.periodYear, existing.periodMonth),
        id: existing.resultId,
      }),
      buttons: [
        { label: this.t('PAYROLL.ENGINE_RUN.EXISTING_CONFIRM_CANCEL'), variant: 'secondary', action: ref => ref.close() },
        { label: this.t('PAYROLL.ENGINE_RUN.EXISTING_CONFIRM_OK'), variant: 'primary', icon: 'calculate',
          action: ref => { ref.close(); this.doRun(); } },
      ],
    });
  }

  private doRun(): void {
    if (!this.canRun()) return;
    this.running.set(true);
    this.error.set(null);
    this.result.set(null);
    this.runContext.set(null);
    this.compareResult.set(null);
    this.runPaysId.set(this.paysId());
    const ctx: RunContext = {
      employeeId:       this.employeeId()!,
      employeeName:     this.selectedEmployee()?.fullName ?? '',
      paysId:           this.paysId()!,
      periodYear:       this.periodYear(),
      periodMonth:      this.periodMonth(),
      contractTypeCode: this.contractTypeCode(),
      jours:            this.joursOuvresMois(),
    };
    this.api.runPayroll({
      employeeId:       ctx.employeeId,
      paysId:           ctx.paysId,
      periodYear:       ctx.periodYear,
      periodMonth:      ctx.periodMonth,
      contractTypeCode: ctx.contractTypeCode,
      joursOuvresMois:  ctx.jours,
    }).subscribe({
      next: r  => {
        this.runContext.set(ctx);
        this.result.set(r);
        this.running.set(false);
        this.savePreset();
        // Le résultat qui vient d'être enregistré compte pour l'avertissement « déjà calculé ».
        if (r.employeeId === this.employeeId()) this.employeeResults.update(list => [...list, r]);
      },
      error: e => { this.error.set(e?.error?.message ?? this.t('PAYROLL.ENGINE_RUN.ERROR')); this.running.set(false); },
    });
  }

  // ── Préréglages récents — localStorage uniquement, aucun endpoint de préréglages
  //    n'existe côté backend. Alimenté par les calculs réellement lancés.
  readonly recentPresets = signal<EnginePreset[]>([]);

  private loadPresetsFromStorage(): EnginePreset[] {
    try {
      const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private savePreset(): void {
    const employee = this.selectedEmployee();
    const paysId = this.paysId();
    if (!employee || paysId == null) return;
    const locale = this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
    const monthShort = this.periodDate().toLocaleDateString(locale, { month: 'short' });
    const preset: EnginePreset = {
      key:              `${employee.userId}-${this.periodYear()}-${this.periodMonth()}`,
      chipLabel:        `${deriveInitials(employee.fullName)} • ${monthShort} ${this.periodYear()}`,
      paysId,
      employeeId:       employee.userId,
      employeeLabel:    employee.fullName,
      periodYear:       this.periodYear(),
      periodMonth:      this.periodMonth(),
      contractTypeCode: this.contractTypeCode(),
      joursOuvresMois:  this.joursOuvresMois(),
    };
    const next = [preset, ...this.recentPresets().filter(p => p.key !== preset.key)].slice(0, MAX_PRESETS);
    this.recentPresets.set(next);
    try { localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(next)); } catch { /* private browsing — non-blocking */ }
  }

  /** Libellé d'une pastille « Calculs récents » : « A. Ben Ali · oct. 2026 » — le nom plutôt
   *  que les initiales. Calculé à l'affichage, donc valable aussi pour les préréglages déjà
   *  enregistrés (dont `chipLabel` garde l'ancien format). */
  presetLabel(p: EnginePreset): string {
    const parts = (p.employeeLabel ?? '').trim().split(/\s+/).filter(Boolean);
    const name = parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : (parts[0] ?? '');
    const locale = this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
    const month = new Date(p.periodYear, p.periodMonth - 1, 1).toLocaleDateString(locale, { month: 'short' });
    return name ? `${name} · ${month} ${p.periodYear}` : p.chipLabel;
  }

  loadPreset(p: EnginePreset): void {
    this.employeeId.set(p.employeeId);
    // Avant `loadCountry` : le chargement des contrats garde ce choix s'il est tarifé.
    this.contractTypeCode.set(p.contractTypeCode);
    if (p.paysId !== this.paysId()) {
      this.paysId.set(p.paysId);
      this.loadCountry(p.paysId);
    } else if (!this.contractTypes().includes(p.contractTypeCode)) {
      this.contractTypeCode.set(this.contractTypes().includes('CDI') ? 'CDI' : this.contractTypes()[0] ?? '');
    }
    this.periodDate.set(new Date(p.periodYear, p.periodMonth - 1, 1));
    this.joursOuvresMois.set(p.joursOuvresMois);
  }

  // ── Comparaison N-1 — réutilise `getResults()` (historique déjà exposé par l'API),
  //    pas de nouvel endpoint : on cherche simplement le même mois l'année précédente.
  readonly compareResult = signal<RunPayrollResponse | null>(null);
  readonly comparing     = signal(false);

  compareWithPreviousYear(): void {
    const r = this.result();
    if (!r) return;
    this.comparing.set(true);
    this.api.getResults(r.employeeId).subscribe({
      next: list => {
        this.comparing.set(false);
        const prior = list.find(x => x.periodYear === r.periodYear - 1 && x.periodMonth === r.periodMonth);
        if (!prior) {
          this.notification.info(this.t('PAYROLL.ENGINE_RUN.COMPARE_NONE'));
          return;
        }
        this.compareResult.set(prior);
      },
      error: () => {
        this.comparing.set(false);
        this.notification.error(this.t('PAYROLL.ENGINE_RUN.COMPARE_ERROR'));
      },
    });
  }

  private delta(current: number | null, previous: number | null): MetricDelta | null {
    if (current == null || previous == null || previous === 0) return null;
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    return {
      value: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
      direction: pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'neutral',
    };
  }

  // ── KPI : Brut → Prélèvements → Net, lus sur les strates RÉELLES du moteur. Vérifié sur
  //    `payroll_rubriques` / `payroll_results` (2026-10-20) :
  //      S1 SALAIRE_BASE · S2 PRIME_TRANSPORT · S3 CNSS_EE (part SALARIALE) · S4 IRPP · S5 NET_A_PAYER
  //    S3 n'est donc pas des charges patronales, S4 n'est pas le net imposable, et
  //    `loadedCost` (= S1+S2+S3) n'est pas un coût employeur : les charges patronales
  //    (CHARGES_ER) ne sont pas renvoyées par le backend — pas de tuile « coût » tant
  //    qu'elles ne le sont pas.
  private static gross(r: RunPayrollResponse): number {
    return r.aggregateGross ?? (r.strate1 ?? 0) + (r.strate2 ?? 0);
  }

  readonly kpis = computed(() => {
    const r = this.result();
    if (!r) return null;
    const gross = EngineRunComponent.gross(r);
    const net   = r.strate5 ?? 0;
    return {
      gross,
      employeeCharges: r.strate3 ?? 0,
      irpp:            r.aggregateIrpp ?? r.strate4 ?? 0,
      net,
      netPct:          gross ? (net / gross) * 100 : null,
    };
  });


  readonly grossDelta  = computed(() => {
    const r = this.result(), c = this.compareResult();
    return this.delta(r ? EngineRunComponent.gross(r) : null, c ? EngineRunComponent.gross(c) : null);
  });
  readonly netPayDelta = computed(() => this.delta(this.result()?.strate5 ?? null, this.compareResult()?.strate5 ?? null));
  /** Écarts N-1 des deux retenues — mêmes strates que `kpis` (S3 CNSS salariale, S4 IRPP). */
  readonly employeeChargesDelta = computed(() =>
    this.delta(this.result()?.strate3 ?? null, this.compareResult()?.strate3 ?? null));
  readonly irppDelta = computed(() => {
    const irpp = (r: RunPayrollResponse | null) => r ? (r.aggregateIrpp ?? r.strate4 ?? null) : null;
    return this.delta(irpp(this.result()), irpp(this.compareResult()));
  });

  // ── Contexte du calcul affiché ───────────────────────────────────────────────
  // Figé au lancement : le formulaire de gauche peut changer ensuite, le résultat de droite
  // doit continuer à dire de QUI, de QUAND et avec QUEL contrat il est.

  readonly runContext = signal<RunContext | null>(null);

  /** « Bulletin de Ahmed Ben Ali · octobre 2026 · CDI · 22 j ». */
  readonly resultTitle = computed(() => {
    const c = this.runContext();
    if (!c) return null;
    return this.t('PAYROLL.ENGINE_RUN.RESULT_HEADING', {
      name:     c.employeeName,
      period:   this.periodText(c.periodYear, c.periodMonth),
      contract: contractTypeLabel(c.contractTypeCode, this.translate),
      days:     c.jours,
    });
  });

  /** Le formulaire ne correspond plus au résultat affiché : bandeau « relancez ». */
  readonly paramsChanged = computed(() => {
    const c = this.runContext();
    if (!c || !this.result()) return false;
    return c.paysId !== this.paysId() || c.employeeId !== this.employeeId()
      || c.periodYear !== this.periodYear() || c.periodMonth !== this.periodMonth()
      || c.contractTypeCode !== this.contractTypeCode() || c.jours !== this.joursOuvresMois();
  });

  // ── Bulletin : composant partagé `app-payslip-bulletin` ─────────────────────────
  // Même affichage que /payroll/engine-results/:id?result= : 4 indicateurs, Gains,
  // Retenues, Net à payer, « Où va le brut ? ». La page ne garde que ce qui lui est propre
  // (contexte du calcul, écarts N-1, exports, devise du lancement).

  readonly rubriqueSearch = signal('');
  private readonly bulletin = viewChild(PayslipBulletinComponent);

  /** Écarts N-1 des quatre tuiles, après « Comparer avec le même mois l'an dernier ». */
  readonly kpiDeltas = computed<PayslipDeltas>(() => ({
    gross:           this.grossDelta(),
    employeeCharges: this.employeeChargesDelta(),
    irpp:            this.irppDelta(),
    net:             this.netPayDelta(),
  }));

  /**
   * Devise du pays du calcul affiché (`PaysDto.devise`, comme /payroll/employee-config).
   * `RunPayrollResponse` ne porte pas le pays : on garde celui du lancement (`runPaysId`),
   * pas la sélection courante du formulaire. Seul un code ISO 4217 passe — `Intl` lève une
   * RangeError sur une devise invalide.
   */
  readonly resultCurrency = computed<string | null>(() => {
    const id = this.runPaysId();
    const devise = this.paysList().find(p => p.id === id)?.devise?.trim().toUpperCase();
    return devise && /^[A-Z]{3}$/.test(devise) ? devise : null;
  });

  // ── Actions du résultat : Excel, PDF, Imprimer, Voir dans Résultats de paie ─────────
  // Mêmes exports serveur que la fiche /payroll/engine-results (le résultat est enregistré,
  // on a son numéro) — remplacent l'ancien CSV construit dans le navigateur.

  readonly exportingXlsx = signal(false);
  readonly exportingPdf  = signal(false);

  /** Lignes exportées : celles de la recherche en cours du bulletin, comme la fiche résultat. */
  private exportCodes(): string[] {
    return this.bulletin()?.searchedCodes()
      ?? (this.result()?.rubriqueDetails ?? []).map(r => r.rubriqueCode);
  }

  private exportName(ext: string): string {
    const r = this.result()!;
    return `Bulletin_${r.employeeId}_${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}.${ext}`;
  }

  exportXlsx(): void {
    const r = this.result();
    if (!r || this.exportingXlsx()) return;
    this.exportingXlsx.set(true);
    this.api.exportResultRubriquesXlsx(r.resultId, this.exportCodes(), this.translate.currentLang() || 'fr')
      .subscribe({
        next: blob => { this.exportingXlsx.set(false); saveBlob(blob, this.exportName('xlsx')); },
        error: err => this.exportFailed(err, this.exportingXlsx),
      });
  }

  exportPdf(): void {
    const r = this.result();
    if (!r || this.exportingPdf()) return;
    this.exportingPdf.set(true);
    this.api.exportResultRubriquesPdf(r.resultId, this.exportCodes(), this.translate.currentLang() || 'fr',
      this.runContext()?.employeeName ?? '')
      .subscribe({
        next: blob => { this.exportingPdf.set(false); saveBlob(blob, this.exportName('pdf')); },
        error: err => this.exportFailed(err, this.exportingPdf),
      });
  }

  private exportFailed(err: unknown, busy: { set(v: boolean): void }): void {
    busy.set(false);
    readBlobError(err, this.t('PAYROLL.ENGINE_RUN.EXPORT_ERROR')).then(msg => this.notification.error(msg));
  }

  print(): void {
    window.print();
  }

  /** Historique de paie du collaborateur, le résultat qui vient d'être calculé ouvert. */
  openInResults(): void {
    const r = this.result();
    if (!r) return;
    this.router.navigate(['/payroll/engine-results', r.employeeId], { queryParams: { result: r.resultId } });
  }
}
