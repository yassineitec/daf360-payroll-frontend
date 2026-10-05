import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  AccordionCardComponent,
  AmountFieldComponent,
  ButtonComponent,
  CardComponent,
  HelpPopoverComponent,
  CheckboxComponent,
  DataTableComponent,
  DafCellDirective,
  FormFieldComponent,
  PageComponent,
  PageHeaderComponent,
  RadioGroupComponent,
  SearchToolbarComponent,
  SectionTitleComponent,
  SelectComponent,
  StatusBadgeComponent,
  TabsComponent,
  ModalService,
  type BadgeCell,
  type BadgeVariant,
  type BreadcrumbItem,
  type FilterField,
  type FilterResult,
  type ModalRef,
  type RadioOption,
  type SearchToolbarFilterConfig,
  type SelectOption,
  type TableColumn,
  type TableConfig,
  type TableRow,
} from '@khalilrebhiitec/daf360';
import {
  PayrollApiService,
  ParameterSetDto,
  PaysDto,
  SocialChargeRateDto,
  SavePayrollRubriqueRequest,
  PayrollRubriqueDto,
} from '../../core/payroll-api.service';
import { HrProfileService, HrContractType } from '../../core/hr-profile.service';
import { NotificationService } from '../../core/notification.service';
import { UserStore } from '../../core/user.store';
import {
  PAYROLL_AUDIT_PERMISSIONS, PAYROLL_BENEFITS_PERMISSIONS, PAYROLL_COUNTRIES_PERMISSIONS,
  PAYROLL_CREATE_PARAMSET_PERMISSIONS, PAYROLL_EMPLOYEE_CONFIG_PERMISSIONS, PAYROLL_ENGINE_PARAMS_PERMISSIONS,
  PAYROLL_ENGINE_RUBRIQUES_PERMISSIONS,
  PAYROLL_SALARY_ADVANCES_PERMISSIONS,
} from '../../core/payroll-nav';
import { AdminSectionHeaderComponent } from './admin/admin-section-header.component';
import {
  AdminModalFooterComponent, AdminPager, AdminSpinnerComponent, AdminTableFooterComponent,
} from './admin/admin-section-kit';
import { delegatedSort, searchTableRows, tableTools } from '../../shared/table-tools';
import { AdvanceRulesAdminComponent } from './admin/advance-rules-admin.component';
import { BenefitsCatalogueAdminComponent } from './admin/benefits-catalogue-admin.component';
import { EngineParamsAdminComponent } from './admin/engine-params-admin.component';
import { EngineRubriquesAdminComponent } from './admin/engine-rubriques-admin.component';
import { PayrollAuditAdminComponent } from './admin/payroll-audit-admin.component';
import { PayrollCountriesAdminComponent } from './admin/payroll-countries-admin.component';
import { dayRange, distinctSorted, inDayRange, pickValue, rangeSeed } from '../../shared/filter-utils';
import { PaysNamesService } from '../../core/pays-names.service';

/** Pastille de statut d'un jeu dans le tableau. */
const SET_STATUS_VARIANT: Record<string, BadgeVariant> = {
  DRAFT: 'warning', PENDING_FINANCE: 'info', ACTIVE: 'success', ARCHIVED: 'neutral',
};

/** Étapes du circuit de validation : soumission, approbation Directeur Pays, approbation DAF. */
type WorkflowStep = 'submit' | 'hr' | 'finance';

type ParamSetsSection = 'create' | 'list' | 'countries' | 'engine-params' | 'rubriques' | 'benefits' | 'advance-rules' | 'audit';

/** Même langage ton → couleur d'icône que les cartes de /rh/admin. */
const TONE_ICON = {
  primary:   { iconColor: 'text-primary',   iconBg: 'bg-primary/10' },
  secondary: { iconColor: 'text-secondary', iconBg: 'bg-secondary/10' },
  teal:      { iconColor: 'text-teal',      iconBg: 'bg-teal/10' },
  warning:   { iconColor: 'text-warning',   iconBg: 'bg-warning/10' },
} as const;

interface AdminCard {
  key: ParamSetsSection | 'employee-config';
  labelKey: string;
  icon: string;
  tone: keyof typeof TONE_ICON;
  /** Une des permissions suffit ; vide = la permission de la route suffit. */
  permissions: readonly string[];
  /** Carte-lien : ouvre une autre page au lieu d'une section de celle-ci. */
  route?: string;
  /** Aide au survol : clé sous PAYROLL.ADMIN_HOME.HELP (description + exemple). */
  helpKey: string;
}

/**
 * Cartes de l'accueil. Masquées pour l'instant (lignes commentées, code conservé) : « Pays et
 * devises », « Taux et barèmes », « Éléments du bulletin », « Avantages en nature » et
 * « Historique et contrôle ». Leurs sections restent dans le code ; sans carte, un lien
 * `?tab=…` vers l'une d'elles ramène à l'accueil. Décommenter la ligne pour la réafficher.
 */
const CARDS: AdminCard[] = [
  { key: 'create',          labelKey: 'PAYROLL.ADMIN_HOME.CARDS.CREATE',           icon: 'add_circle',      tone: 'teal',      permissions: PAYROLL_CREATE_PARAMSET_PERMISSIONS, helpKey: 'CREATE' },
  { key: 'list',            labelKey: 'PAYROLL.ADMIN_HOME.CARDS.LIST',             icon: 'list_alt',        tone: 'secondary', permissions: [], helpKey: 'LIST' },
  // { key: 'countries',       labelKey: 'PAYROLL.ADMIN_HOME.CARDS.COUNTRIES',        icon: 'public',          tone: 'primary',   permissions: PAYROLL_COUNTRIES_PERMISSIONS, helpKey: 'COUNTRIES' },
  // { key: 'engine-params',   labelKey: 'PAYROLL.ADMIN_HOME.CARDS.ENGINE_PARAMS',    icon: 'tune',            tone: 'warning',   permissions: PAYROLL_ENGINE_PARAMS_PERMISSIONS, helpKey: 'ENGINE_PARAMS' },
  // { key: 'rubriques',       labelKey: 'PAYROLL.ADMIN_HOME.CARDS.RUBRIQUES',        icon: 'receipt_long',    tone: 'primary',   permissions: PAYROLL_ENGINE_RUBRIQUES_PERMISSIONS, helpKey: 'RUBRIQUES' },
  // { key: 'benefits',        labelKey: 'PAYROLL.ADMIN_HOME.CARDS.BENEFITS',         icon: 'redeem',          tone: 'teal',      permissions: PAYROLL_BENEFITS_PERMISSIONS, helpKey: 'BENEFITS' },
  { key: 'advance-rules',   labelKey: 'PAYROLL.ADMIN_HOME.CARDS.ADVANCE_RULES',    icon: 'request_quote',   tone: 'warning',   permissions: PAYROLL_SALARY_ADVANCES_PERMISSIONS, helpKey: 'ADVANCE_RULES' },
  { key: 'employee-config', labelKey: 'PAYROLL.ADMIN_HOME.CARDS.EMPLOYEE_CONFIG',  icon: 'manage_accounts', tone: 'teal',      permissions: PAYROLL_EMPLOYEE_CONFIG_PERMISSIONS, route: '/payroll/employee-config', helpKey: 'EMPLOYEE_CONFIG' },
  // { key: 'audit',           labelKey: 'PAYROLL.ADMIN_HOME.CARDS.AUDIT',            icon: 'history',         tone: 'secondary', permissions: PAYROLL_AUDIT_PERMISSIONS, helpKey: 'AUDIT' },
];

/**
 * `?tab=` ↔ signal, où « aucune section » est un état réel : l'accueil en cartes, comme
 * `adminTabParam` de /rh/admin. `tabParam` de la bibliothèque ne le permet pas — son
 * `fallback` n'est pas nullable, l'accueil y serait inatteignable. Suit `queryParamMap`
 * (précédent/suivant compris), réécrit l'URL en `replaceUrl`, et ramène à l'accueil une
 * section absente de `ids` (inconnue, ou non autorisée).
 */
function sectionParam(ids: () => readonly ParamSetsSection[]) {
  const route      = inject(ActivatedRoute);
  const router     = inject(Router);
  const destroyRef = inject(DestroyRef);
  const read = (value: string | null) => (value || null) as ParamSetsSection | null;

  const state = signal<ParamSetsSection | null>(read(route.snapshot.queryParamMap.get('tab')));

  route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe(map => {
    const fromUrl = read(map.get('tab'));
    if (fromUrl !== state()) state.set(fromUrl);
  });

  effect(() => {
    const current = state();
    if (current !== null && !ids().includes(current)) state.set(null);
  });

  effect(() => {
    const value = state();
    if (read(route.snapshot.queryParamMap.get('tab')) === value) return;
    // `null` RETIRE le paramètre : l'accueil est l'URL sans `?tab=`.
    router.navigate([], { relativeTo: route, queryParams: { tab: value }, queryParamsHandling: 'merge', replaceUrl: true });
  });

  return state;
}

@Component({
  selector: 'app-parameter-sets',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule, TranslatePipe,
    AccordionCardComponent, AmountFieldComponent, ButtonComponent, CardComponent, HelpPopoverComponent, CheckboxComponent, DataTableComponent, DafCellDirective,
    FormFieldComponent, PageComponent, PageHeaderComponent, RadioGroupComponent,
    SearchToolbarComponent, SectionTitleComponent, SelectComponent, StatusBadgeComponent, TabsComponent,
    AdminModalFooterComponent, AdminSectionHeaderComponent, AdminSpinnerComponent, AdminTableFooterComponent,
    AdvanceRulesAdminComponent, BenefitsCatalogueAdminComponent, EngineParamsAdminComponent, EngineRubriquesAdminComponent,
    PayrollAuditAdminComponent, PayrollCountriesAdminComponent,
  ],
  templateUrl: './parameter-sets.component.html',
  styleUrl: './parameter-sets.component.scss',
})
export class ParameterSetsComponent implements OnInit {
  /** Liste des jeux de paramètres — passée au `[table]` de sa barre : réinitialiser + choix des
   *  colonnes à droite de Filtres. Les tableaux du détail / de l'édition n'ont pas de barre. */
  readonly setTable = viewChild<DataTableComponent>('setTable');

  private readonly api          = inject(PayrollApiService);
  private readonly hr           = inject(HrProfileService);
  private readonly fb           = inject(FormBuilder);
  private readonly translate    = inject(TranslateService);
  private readonly paysNames = inject(PaysNamesService);
  private readonly userStore    = inject(UserStore);
  private readonly notification = inject(NotificationService);
  private readonly modalService = inject(ModalService);
  private readonly router       = inject(Router);
  private readonly route        = inject(ActivatedRoute);
  private readonly destroyRef   = inject(DestroyRef);

  // ── Éditeurs en pop-up (bibliothèque `ModalService` — pas de composant maison) :
  // les gabarits sont capturés une seule fois via `viewChild`, hors de la boucle
  // `@for` des jeux de paramètres, puisque `chargesForm`/`rubriquesForm` sont un état
  // partagé unique (celui du jeu en cours d'édition), pas un état par ligne.
  private readonly chargesEditorTpl   = viewChild<TemplateRef<unknown>>('chargesEditorTpl');
  private readonly rubriquesEditorTpl = viewChild<TemplateRef<unknown>>('rubriquesEditorTpl');
  private readonly workflowConfirmTpl = viewChild<TemplateRef<unknown>>('workflowConfirmTpl');
  private chargesModalRef:   ModalRef | null = null;
  private rubriquesModalRef: ModalRef | null = null;

  // ── Sections, sur le modèle de /rh/admin : sans `?tab=`, un accueil en cartes (une par
  //    section) ; une carte ouvre sa section — paramétrage, suivi des jeux, pays de paie,
  //    règles des avances, journal — avec un fil d'Ariane qui ramène à l'accueil. « Config.
  //    des collaborateurs » est une carte-lien vers sa propre page. Chaque carte n'apparaît
  //    qu'avec l'une de ses permissions, comme /rh/admin masque une section sans permission ;
  //    un `?tab=` vers une section non autorisée retombe sur l'accueil.
  readonly cards = computed(() =>
    CARDS.filter(c => !c.permissions.length || c.permissions.some(code => this.userStore.hasPermission(code))));

  readonly activeTab = sectionParam(() =>
    this.cards().filter(c => !c.route).map(c => c.key as ParamSetsSection));

  readonly toneIcon = (tone: keyof typeof TONE_ICON) => TONE_ICON[tone];

  /** Carte dont l'aide est ouverte (survol ou focus), une seule à la fois. */
  readonly helpOpen = signal<string | null>(null);

  /** Entité de l'utilisateur, sous le titre de l'accueil — même règle que /rh/admin : le
   *  libellé de son pays, sinon son code ISO. */
  readonly currentPays = computed(() => {
    const user = this.userStore.currentUser();
    const pays = this.paysList().find(p => p.id === user?.paysId);
    return pays ? this.paysNames.name(pays.id, pays.frenchLabel) : (user?.isoCode ?? '—');
  });

  readonly currentSectionLabelKey = computed(() =>
    CARDS.find(c => c.key === this.activeTab())?.labelKey ?? '');
  openCard(card: AdminCard): void {
    if (card.route) this.router.navigateByUrl(card.route);
    else this.activeTab.set(card.key as ParamSetsSection);
  }

  /** Retour à l'accueil en cartes (le pays choisi est gardé dans l'URL). */
  goHome(): void {
    this.router.navigate([], {
      relativeTo: this.route, queryParams: { tab: null, set: null }, queryParamsHandling: 'merge',
    });
  }

  // ── Pays : `daf-select`, même besoin déjà couvert par la bibliothèque dans
  //    engine-run/engine-results — liste chargée une fois.
  private readonly paysList = signal<PaysDto[]>([]);
  readonly paysOptions = computed<SelectOption[]>(() =>
    this.paysList().map(p => ({ value: String(p.id), label: `${this.paysNames.name(p.id, p.frenchLabel)} (${p.isoCode})` })),
  );

  ngOnInit(): void {
    this.api.listPays().subscribe(list => this.paysList.set(list));

    // Pays pré-sélectionné : celui de `?pays=` s'il y en a un (lien partagé, rafraîchissement
    // d'un jeu ouvert), sinon celui du profil de l'utilisateur connecté (comme sur
    // `/payroll/candidate-simulation`) ; il reste modifiable dans le bouton filtre, ce qui
    // relance `load()`. `firstLoad` s'éteint ici dans tous les cas : sans ceci la page
    // restait sur le squelette de `daf-page`.
    this.firstLoad.set(false);

    // Types de contrat du formulaire de création : chargés pour le pays choisi dans CE
    // formulaire, à chaque changement (auparavant seulement via « Valider les règles »).
    this.newSetForm.get('paysId')!.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(paysId => this.loadNewSetContractTypes(paysId ?? null));

    // `?set=` = jeu ouvert en détail. Suivi en continu, pour que le bouton Précédent du
    // navigateur ramène de la page détail à la grille de cartes.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const set = Number(params.get('set'));
      this.openSetId.set(set > 0 ? set : null);
    });
    const urlPays = Number(this.route.snapshot.queryParamMap.get('pays'));
    const initialPays = urlPays > 0 ? urlPays : this.userStore.currentUser()?.paysId;
    if (initialPays) {
      this.setListPays(initialPays);
      this.load();
    }
  }

  // ── Détail d'un jeu (page "Gérer") ──────────────────────────────────────────
  // Même principe que /rh/admin et /finance/admin : une grille de cartes pour choisir,
  // puis une page détail avec fil d'Ariane et onglets internes. Le jeu ouvert vit dans
  // `?set=` (avec `?pays=`, sans lequel la liste ne serait pas chargée au rafraîchissement).
  readonly openSetId = signal<number | null>(null);
  readonly detailTab = signal<string>('charges');

  readonly detailSet = computed(() => {
    const id = this.openSetId();
    return id ? this.paramSets().find(p => p.id === id) ?? null : null;
  });

  /** `selected` reste la référence des éditeurs en pop-up (variables de formule) : il suit
   *  le jeu ouvert. Un `?set=` inconnu une fois la liste chargée ramène à la grille. */
  private readonly syncSelected = effect(() => {
    const ps = this.detailSet();
    this.selected.set(ps);
    if (!ps) { this.closeChargesEditor(); this.closeRubriquesEditor(); }
    if (this.openSetId() && !ps && !this.loading()) this.closeSet();
  });

  readonly detailTabs = computed(() => {
    const ps = this.detailSet();
    if (!ps) return [];
    return [
      { id: 'charges',   label: this.t('PAYROLL.PARAMETER_SETS.TAB_CHARGES'),   icon: 'payments',     count: ps.socialChargeRates.length },
      { id: 'rubriques', label: this.t('PAYROLL.PARAMETER_SETS.TAB_RUBRIQUES'), icon: 'receipt_long', count: ps.rubriques.length },
      ...(ps.benefits.length
        ? [{ id: 'benefits', label: this.t('PAYROLL.PARAMETER_SETS.TAB_BENEFITS'), icon: 'redeem', count: ps.benefits.length }]
        : []),
    ];
  });

  openSet(ps: ParameterSetDto): void {
    this.detailTab.set('charges');
    this.router.navigate([], { relativeTo: this.route, queryParams: { set: ps.id }, queryParamsHandling: 'merge' });
  }

  closeSet(): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { set: null }, queryParamsHandling: 'merge' });
  }

  /** Sous-titre de la page détail : statut + tolérance / seuil (ancienne ligne maison). */
  detailSubtitle(ps: ParameterSetDto): string {
    return `${this.statusLabel(ps)} · ${this.t('PAYROLL.PARAMETER_SETS.PS_META', { tolerance: ps.convergenceTolerance, threshold: ps.calibrationThresholdPct })}`;
  }

  /** Icône de la carte d'un jeu, par statut. Pas de couleur par statut : la carte garde
   *  les couleurs par défaut de la bibliothèque, seule l'icône distingue les statuts. */
  cardIcon(ps: ParameterSetDto): string {
    switch (ps.status) {
      case 'ACTIVE':          return 'check_circle';
      case 'PENDING_FINANCE': return 'hourglass_top';
      case 'ARCHIVED':        return 'inventory_2';
      default:                return 'edit_note'; // DRAFT
    }
  }

  /** Description de la carte d'un jeu : statut, puis ce qu'il contient. */
  cardDescription(ps: ParameterSetDto): string {
    return this.t('PAYROLL.PARAMETER_SETS.CARD_DESC', {
      status: this.statusLabel(ps), charges: ps.socialChargeRates.length, rubriques: ps.rubriques.length,
    });
  }

  /** Pays de l'onglet "Jeux existants", choisi dans le bouton filtre (avec le statut),
   *  comme sur `/payroll/candidate-simulation`. Miroir signal de `filterForm.paysId`, pour
   *  que `filterConfig` / `emptyMessage` se recalculent quand il change. */
  readonly listPaysId = signal<number | null>(null);

  private setListPays(paysId: number | null): void {
    this.listPaysId.set(paysId);
    this.filterForm.get('paysId')!.setValue(paysId);
    // Pays reporté dans l'adresse (sans nouvelle entrée d'historique) pour qu'un `?set=`
    // partagé ou rafraîchi retrouve la liste à laquelle il appartient.
    this.router.navigate([], {
      relativeTo: this.route, queryParams: { pays: paysId }, queryParamsHandling: 'merge', replaceUrl: true,
    });
  }

  /** La création reste ouverte qu'aux rôles qui pouvaient déjà y accéder sur l'ancienne
   *  page `/payroll/admin` (le formulaire écrit, l'approbation reste un contrôle serveur
   *  séparé — voir `core/payroll-nav.ts` pour l'historique du code). */
  readonly canCreate = computed(() =>
    PAYROLL_CREATE_PARAMSET_PERMISSIONS.some(code => this.userStore.hasPermission(code)));

  /** Fil d'Ariane d'une section, comme /rh/admin : "Administration › <section>", puis
   *  "› v3 — 2026" sur la page détail d'un jeu. Pas de `link` : la navigation passe par
   *  `onBreadcrumb` (le dernier maillon, la page courante, n'est jamais cliquable). */
  readonly breadcrumbs = computed((): BreadcrumbItem[] => {
    const ps = this.detailSet();
    return [
      { label: this.t('PAYROLL.ADMIN_HOME.TITLE') },
      { label: this.t(this.currentSectionLabelKey()) },
      ...(this.activeTab() === 'list' && ps ? [{ label: this.itemTitle(ps) }] : []),
    ];
  });

  /** 1er maillon → accueil en cartes ; 2e (sur la page détail) → grille des jeux. */
  onBreadcrumb(crumb: BreadcrumbItem): void {
    const index = this.breadcrumbs().findIndex(c => c.label === crumb.label);
    if (index === 0) this.goHome();
    else if (index === 1) this.closeSet();
  }

  /** Même pattern que les autres pages payroll. */
  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly loading   = signal(false);
  /** `daf-page`'s own skeleton is for the FIRST load only — a country switch afterwards
   *  must leave the header/KPI bandeau on screen and let the list area show its own
   *  busy state via `loading()`, same convention as finance's `firstLoad()`/`loading()`
   *  split (e.g. `invoice-list.component.ts`). Flips to `false` once, after the first
   *  `load()` settles (success or error), and never again. */
  readonly firstLoad = signal(true);
  readonly paramSets = signal<ParameterSetDto[]>([]);
  readonly selected  = signal<ParameterSetDto | null>(null);

  // ── Barre de recherche / filtre, comme `daf-search-toolbar` sur /finance/affaires et
  // les autres pages payroll — un seul chargement par pays (`listParameterSets`), la
  // recherche et le filtre retravaillent `paramSets()` déjà en mémoire. Pas de bascule
  // carte/tableau ni de pagination ici : chaque jeu est déjà un `daf-accordion-card` qui
  // EST l'éditeur (taux, rubriques...), pas un résumé cliquable vers un autre écran — et
  // un pays n'a jamais qu'une poignée de jeux à la fois.
  readonly searchText = signal('');
  readonly statusFilter = signal('');
  readonly fiscalYearFilter = signal<number | null>(null);
  /** `HR` = approuvé Directeur Pays, `FINANCE` = approuvé DAF, `NONE` = aucune approbation. */
  readonly approvalFilter = signal<'' | 'HR' | 'FINANCE' | 'NONE'>('');
  /** Plage « Créé le » telle qu'émise par le panneau (`Date[]`). */
  readonly createdFilter = signal<Date[] | null>(null);

  onSearchTextChange(value: string): void {
    this.searchText.set(value);
  }

  readonly filteredParamSets = computed(() => {
    const query = this.searchText().trim().toLowerCase();
    const status = this.statusFilter();
    const fiscalYear = this.fiscalYearFilter();
    const approval = this.approvalFilter();
    const created = dayRange(this.createdFilter());
    return this.paramSets().filter(ps => {
      const matchesQuery = !query
        || String(ps.fiscalYear).includes(query)
        || String(ps.version).includes(query);
      const matchesStatus = !status || ps.status === status;
      const matchesApproval = !approval
        || (approval === 'HR' && ps.approvedByHr != null)
        || (approval === 'FINANCE' && ps.approvedByFinance != null)
        || (approval === 'NONE' && ps.approvedByHr == null && ps.approvedByFinance == null);
      return matchesQuery && matchesStatus && matchesApproval
        && (fiscalYear == null || ps.fiscalYear === fiscalYear)
        && inDayRange(ps.createdAt, created);
    });
  });

  /** Pays + statut + année/approbation/création dans le même bouton filtre. Le pays est
   *  chargé côté serveur (un changement relance `load()`), le reste filtre la liste déjà
   *  en mémoire. */
  readonly filterFields = computed<FilterField[]>(() => [{
    name: 'pays',
    label: this.t('PAYROLL.PARAMETER_SETS.PAYS'),
    type: 'select',
    searchable: true,
    placeholder: this.t('PAYROLL.SELECT.PAYS_PLACEHOLDER'),
    options: this.paysOptions(),
  }, {
    name: 'status',
    label: this.t('PAYROLL.PARAMETER_SETS.STATUS_FILTER_LABEL'),
    type: 'select',
    placeholder: this.t('PAYROLL.PARAMETER_SETS.FILTER_ALL'),
    options: (['DRAFT', 'PENDING_FINANCE', 'ACTIVE', 'ARCHIVED'] as const)
      .map(s => ({ value: s, label: this.t(`PAYROLL.PARAMETER_SETS.STATUS.${s}`) })),
  }, {
    name: 'fiscalYear',
    label: this.t('PAYROLL.PARAMETER_SETS.FILTER_FISCAL_YEAR'),
    type: 'select',
    placeholder: this.t('PAYROLL.PARAMETER_SETS.FILTER_ALL'),
    options: distinctSorted(this.paramSets().map(ps => ps.fiscalYear)).reverse()
      .map(y => ({ value: String(y), label: String(y) })),
  }, {
    name: 'approval',
    label: this.t('PAYROLL.PARAMETER_SETS.FILTER_APPROVAL'),
    type: 'select',
    placeholder: this.t('PAYROLL.PARAMETER_SETS.FILTER_ALL'),
    options: (['HR', 'FINANCE', 'NONE'] as const)
      .map(a => ({ value: a, label: this.t(`PAYROLL.PARAMETER_SETS.FILTER_APPROVAL_${a}`) })),
  }, {
    name: 'created',
    label: this.t('PAYROLL.PARAMETER_SETS.FILTER_CREATED'),
    type: 'daterange',
  }]);

  readonly filterConfig = computed<SearchToolbarFilterConfig>(() => ({
    title: this.t('PAYROLL.PARAMETER_SETS.FILTER_TITLE'),
    applyLabel: this.t('PAYROLL.PARAMETER_SETS.FILTER_APPLY'),
    cancelLabel: this.t('PAYROLL.PARAMETER_SETS.FILTER_CANCEL'),
    resetLabel: this.t('PAYROLL.PARAMETER_SETS.FILTER_RESET'),
    triggerLabel: this.t('PAYROLL.PARAMETER_SETS.FILTER_TRIGGER'),
    // `daf-filter` seeds `initialValues` once, in its own internal shape — a `select`
    // field is a `string[]` there (normalizes to a scalar only on `apply`).
    initialValues: {
      pays:   this.listPaysId() ? [String(this.listPaysId())] : [],
      status: this.statusFilter() ? [this.statusFilter()] : [],
      fiscalYear: this.fiscalYearFilter() != null ? [String(this.fiscalYearFilter())] : [],
      approval:   this.approvalFilter() ? [this.approvalFilter()] : [],
      created:    this.createdFilter(),
    },
  }));

  applyFilters(result: FilterResult): void {
    this.statusFilter.set((result['status'] as string | null) ?? '');
    const fiscalYear = pickValue(result, 'fiscalYear');
    this.fiscalYearFilter.set(fiscalYear ? Number(fiscalYear) : null);
    this.approvalFilter.set((pickValue(result, 'approval') ?? '') as '' | 'HR' | 'FINANCE' | 'NONE');
    this.createdFilter.set(rangeSeed(result['created']));
    const raw = result['pays'] as string | null;
    const paysId = raw ? Number(raw) : null;
    if (paysId !== this.listPaysId()) {
      this.setListPays(paysId);
      this.selected.set(null);
      this.load();
    }
  }

  /** Message de la liste vide : pas encore de pays, chargement, pays sans jeu, ou filtre. */
  readonly emptyMessage = computed(() => {
    if (!this.listPaysId())          return this.t('PAYROLL.PARAMETER_SETS.NO_PAYS_SELECTED');
    if (this.loading())              return this.t('PAYROLL.COMMON.LOADING');
    if (!this.paramSets().length)    return this.t('PAYROLL.PARAMETER_SETS.EMPTY_FOR_PAYS');
    return this.t('PAYROLL.PARAMETER_SETS.EMPTY_FILTERED');
  });

  // ── Liste des jeux : tableau paginé, comme les sections de /rh/admin ─────────
  readonly setColumns = computed<TableColumn[]>(() => [
    { key: 'version',   label: this.t('PAYROLL.ADMIN_HOME.LIST.COL_VERSION'), sortable: true },
    { key: 'status',    label: this.t('PAYROLL.ADMIN_HOME.LIST.COL_STATUS'), type: 'badge', sortable: true },
    { key: 'charges',   label: this.t('PAYROLL.ADMIN_HOME.LIST.COL_CHARGES'), type: 'number', sortable: true },
    { key: 'rubriques', label: this.t('PAYROLL.ADMIN_HOME.LIST.COL_RUBRIQUES'), type: 'number', sortable: true },
    { key: 'benefits',  label: this.t('PAYROLL.ADMIN_HOME.LIST.COL_BENEFITS'), type: 'number', sortable: true },
    { key: 'approval',  label: this.t('PAYROLL.ADMIN_HOME.LIST.COL_APPROVAL'), sortable: true },
    { key: 'created',   label: this.t('PAYROLL.ADMIN_HOME.LIST.COL_CREATED'), type: 'date', format: { dateStyle: 'short' }, sortable: true },
  ]);

  /** Approbations obtenues : Directeur Pays, DAF, les deux, ou aucune. */
  private approvalLabel(ps: ParameterSetDto): string {
    const hr = ps.approvedByHr != null;
    const fin = ps.approvedByFinance != null;
    const which = hr && fin ? 'BOTH' : hr ? 'HR' : fin ? 'FINANCE' : 'NONE';
    return this.t('PAYROLL.ADMIN_HOME.LIST.APPROVAL_' + which);
  }

  readonly setRows = computed<TableRow[]>(() =>
    this.filteredParamSets().map(ps => ({
      id: ps.id,
      version: this.itemTitle(ps),
      status: {
        label: this.statusLabel(ps),
        options: { variant: SET_STATUS_VARIANT[ps.status] ?? 'neutral', size: 'sm', dot: true },
      } satisfies BadgeCell,
      charges: ps.socialChargeRates.length,
      rubriques: ps.rubriques.length,
      benefits: ps.benefits.length,
      approval: this.approvalLabel(ps),
      created: ps.createdAt,
      _source: ps,
    })));

  /** Pages de 5 lignes, comme les sections de /rh/admin. */
  readonly setPager = new AdminPager(() => this.setRows(), () => this.setColumns());

  readonly setTableConfig = computed<TableConfig>(() => ({
    showHeader: false, hoverable: true,
    ...tableTools(this.translate),
    ...delegatedSort(untracked(this.setPager.sort)),
    rowId: row => row['id'],
    actions: [{
      id: 'manage', icon: 'settings', tooltip: this.t('PAYROLL.PARAMETER_SETS.MANAGE'),
      onClick: row => this.openSet(row['_source'] as ParameterSetDto),
    }],
  }));

  // ── Charges sociales editor ───────────────────────────────────────────────
  readonly editingChargesId = signal<number | null>(null);
  readonly savingCharges    = signal(false);
  /** Erreur d'enregistrement des charges, en bandeau dans la pop-up (comme RH). */
  readonly chargesError     = signal<string | null>(null);

  readonly contractTypes   = signal<HrContractType[]>([]);
  readonly baseCalcOptions = computed(() => [
    { value: 'GROSS',        label: this.t('PAYROLL.PARAMETER_SETS.BASE_GROSS') },
    { value: 'CAPPED_GROSS', label: this.t('PAYROLL.PARAMETER_SETS.BASE_CAPPED_GROSS') },
    { value: 'FIXED',        label: this.t('PAYROLL.PARAMETER_SETS.BASE_FIXED') },
    { value: 'FORMULE',      label: this.t('PAYROLL.PARAMETER_SETS.BASE_FORMULA') },
  ]);

  readonly chargesForm = this.fb.group({ rates: this.fb.array([]) });
  get editRates(): FormArray { return this.chargesForm.get('rates') as FormArray; }
  editRateGroup(i: number): FormGroup { return this.editRates.at(i) as FormGroup; }

  // ── Rubriques de paie editor ──────────────────────────────────────────────
  readonly editingRubriquesId = signal<number | null>(null);
  readonly savingRubriques    = signal(false);
  /** Erreur d'enregistrement des rubriques, en bandeau dans la pop-up (comme RH). */
  readonly rubriquesError     = signal<string | null>(null);
  readonly expandedRubriques  = signal<Set<number>>(new Set());
  readonly testGross          = signal<number>(3000);

  readonly natureOptions = computed(() => [
    { value: 'AVANTAGE',  label: this.t('PAYROLL.PARAMETER_SETS.NATURE.AVANTAGE.LABEL'),  description: this.t('PAYROLL.PARAMETER_SETS.NATURE.AVANTAGE.DESC') },
    { value: 'INDEMNITE', label: this.t('PAYROLL.PARAMETER_SETS.NATURE.INDEMNITE.LABEL'), description: this.t('PAYROLL.PARAMETER_SETS.NATURE.INDEMNITE.DESC') },
    { value: 'PRIME',     label: this.t('PAYROLL.PARAMETER_SETS.NATURE.PRIME.LABEL'),     description: this.t('PAYROLL.PARAMETER_SETS.NATURE.PRIME.DESC') },
    { value: 'RETENUE',   label: this.t('PAYROLL.PARAMETER_SETS.NATURE.RETENUE.LABEL'),   description: this.t('PAYROLL.PARAMETER_SETS.NATURE.RETENUE.DESC') },
  ]);

  readonly calcModeOptions = computed(() => [
    { value: 'FIXE_MENSUEL',         label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FIXE_MENSUEL.LABEL'),         description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FIXE_MENSUEL.DESC') },
    { value: 'FIXE_JOURNALIER',      label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FIXE_JOURNALIER.LABEL'),      description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FIXE_JOURNALIER.DESC') },
    { value: 'POURCENTAGE_BRUT',     label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_BRUT.LABEL'),     description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_BRUT.DESC') },
    { value: 'POURCENTAGE_CHARGES',  label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_CHARGES.LABEL'),  description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_CHARGES.DESC') },
    { value: 'POURCENTAGE_PLAFONNE', label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_PLAFONNE.LABEL'), description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.POURCENTAGE_PLAFONNE.DESC') },
    { value: 'FORMULE',              label: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FORMULE.LABEL'),              description: this.t('PAYROLL.PARAMETER_SETS.CALC_MODE.FORMULE.DESC') },
  ]);

  readonly rubriquesForm = this.fb.group({ items: this.fb.array([]) });
  get editRubriques(): FormArray { return this.rubriquesForm.get('items') as FormArray; }
  editRubriqueGroup(i: number): FormGroup { return this.editRubriques.at(i) as FormGroup; }

  // ── Filter ────────────────────────────────────────────────────────────────
  readonly filterForm = this.fb.group({ paysId: [null as number | null, Validators.required] });

  // ── Création d'un nouveau jeu (section « Créer les règles de paie ») ─────────
  readonly savingNewSet = signal(false);
  /** Création tentée : les erreurs s'affichent alors sous tous les champs fautifs. */
  readonly newSetSubmitted = signal(false);
  /** Erreur de la création (formulaire incomplet ou refus du serveur), en bandeau. */
  readonly newSetError = signal<string | null>(null);

  /** Exemple de barème IRPP — JSON valide, au format lu par le moteur. */
  readonly irppPlaceholder =
    '[{"lower": 0, "upper": 5000, "rate": 0}, {"lower": 5000, "upper": 20000, "rate": 0.26}, {"lower": 20000, "upper": null, "rate": 0.32}]';

  readonly newSetForm = this.fb.group({
    paysId:                   [null as number | null, Validators.required],
    fiscalYear:               [new Date().getFullYear() as number | null, [Validators.required, Validators.min(2000), Validators.max(2100), integer]],
    irppBrackets:             ['', [Validators.required, irppBracketsValidator]],
    convergenceTolerance:     [0.01 as number | null, [Validators.required, positive]],
    maxConvergenceIterations: [50 as number | null, [Validators.required, Validators.min(1), integer]],
    calibrationThresholdPct:  [1.00 as number | null, [Validators.required, Validators.min(0)]],
    changeRationale:          [''],
    socialChargeRates:        this.fb.array([]),
  });

  get newSetRates(): FormArray { return this.newSetForm.get('socialChargeRates') as FormArray; }
  newSetRateGroup(i: number): FormGroup { return this.newSetRates.at(i) as FormGroup; }

  /** Types de contrat du pays choisi DANS CE FORMULAIRE (et non celui de « Valider les
   *  règles de paie ») — rechargés à chaque changement de pays. */
  readonly newSetContractTypes = signal<HrContractType[]>([]);
  readonly newSetContractTypeOptions = computed<SelectOption[]>(() =>
    this.newSetContractTypes().map(ct => ({ value: ct.code, label: ct.code })));

  private loadNewSetContractTypes(paysId: number | null): void {
    this.newSetContractTypes.set([]);
    if (!paysId) return;
    this.hr.getContractTypes(paysId).subscribe(types => {
      if (this.newSetForm.get('paysId')?.value !== paysId) return;   // réponse dépassée
      this.newSetContractTypes.set(types);
      // Une ligne dont le type n'existe pas dans ce pays prend le premier type proposé.
      const codes = types.map(t => t.code);
      for (const group of this.newSetRates.controls) {
        const ctrl = group.get('contractType')!;
        if (codes.length && !codes.includes(ctrl.value)) ctrl.setValue(codes[0]);
      }
    });
  }

  addNewSetRate(): void {
    this.newSetRates.push(this.fb.group({
      contractType:    [this.newSetContractTypes()[0]?.code ?? 'CDI', Validators.required],
      chargeCode:      ['', Validators.required],
      chargeLabel:     ['', Validators.required],
      employeeRate:    [0 as number | null, [Validators.required, Validators.min(0), Validators.max(1)]],
      employerRate:    [0 as number | null, [Validators.required, Validators.min(0), Validators.max(1)]],
      baseCalculation: ['GROSS'],
      capAmount:       [null as number | null, Validators.min(0)],
    }));
  }

  removeNewSetRate(i: number): void { this.newSetRates.removeAt(i); }

  /** Saisie d'un champ : valeur + « modifié », pour afficher son erreur dès la frappe. */
  setNewSetValue(name: string, value: unknown): void {
    const ctrl = this.newSetForm.get(name)!;
    ctrl.setValue(value);
    ctrl.markAsDirty();
  }

  setNewSetRateValue(i: number, name: string, value: unknown): void {
    const ctrl = this.newSetRateGroup(i).get(name)!;
    ctrl.setValue(value);
    ctrl.markAsDirty();
  }

  /** Champ numérique : vide → null (reste bloquant), jamais 0 par défaut. */
  num(value: unknown): number | null {
    if (value === '' || value == null) return null;
    const n = Number(value);
    return isNaN(n) ? null : n;
  }

  /** Message sous un champ du formulaire — une fois modifié, ou après une tentative. */
  newSetFieldError(name: string): string | undefined {
    return this.controlError(this.newSetForm.get(name));
  }

  newSetRateError(i: number, name: string): string | undefined {
    // Taux saisis en % : bornes du message en % aussi (max 1 → 100).
    const scale = name === 'employeeRate' || name === 'employerRate' ? 100 : 1;
    return this.controlError(this.newSetRateGroup(i).get(name), scale);
  }

  private controlError(ctrl: AbstractControl | null, scale = 1): string | undefined {
    if (!ctrl || ctrl.valid || !(ctrl.dirty || this.newSetSubmitted())) return undefined;
    const e = ctrl.errors ?? {};
    if (e['required'])  return this.t('PAYROLL.ADMIN.ERR.REQUIRED');
    if (e['integer'])   return this.t('PAYROLL.ADMIN.ERR.INTEGER');
    if (e['positive'])  return this.t('PAYROLL.ADMIN.ERR.POSITIVE');
    if (e['min'])       return this.t('PAYROLL.ADMIN.ERR.MIN', { min: e['min'].min * scale });
    if (e['max'])       return this.t('PAYROLL.ADMIN.ERR.MAX', { max: e['max'].max * scale });
    if (e['irpp'])      return this.t(`PAYROLL.ADMIN.ERR.IRPP.${e['irpp']}`);
    return this.t('PAYROLL.ADMIN.ERR.INVALID');
  }

  submitNewSet(): void {
    if (this.savingNewSet()) return;
    this.newSetError.set(null);
    if (this.newSetForm.invalid) {
      this.newSetSubmitted.set(true);
      this.newSetError.set(this.t('PAYROLL.ADMIN.ERR.FORM_INVALID'));
      return;
    }
    this.savingNewSet.set(true);

    const raw = this.newSetForm.getRawValue();

    this.api.createParameterSet({
      paysId:                   raw.paysId!,
      fiscalYear:               raw.fiscalYear!,
      irppBrackets:             raw.irppBrackets!,
      convergenceTolerance:     raw.convergenceTolerance!,
      maxConvergenceIterations: raw.maxConvergenceIterations!,
      calibrationThresholdPct:  raw.calibrationThresholdPct!,
      changeRationale:          raw.changeRationale!,
      socialChargeRates:        raw.socialChargeRates as any,
      benefits:                 [],
    } as Partial<ParameterSetDto>).subscribe({
      next: ps => {
        const n = ps.socialChargeRates?.length ?? 0;
        this.notification.success(
          n
            ? this.t('PAYROLL.ADMIN.CREATED_WITH_CHARGES', { version: ps.version, count: n })
            : this.t('PAYROLL.ADMIN.CREATED', { version: ps.version }),
        );
        this.savingNewSet.set(false);
        this.newSetSubmitted.set(false);
        this.newSetForm.reset({
          paysId: null, fiscalYear: new Date().getFullYear(), irppBrackets: '',
          convergenceTolerance: 0.01, maxConvergenceIterations: 50, calibrationThresholdPct: 1.00,
        });
        while (this.newSetRates.length) this.newSetRates.removeAt(0);

        // Bascule vers l'onglet liste, filtrée sur le pays du jeu qu'on vient de créer —
        // même confort que l'ancien panneau, qui l'ajoutait directement à la liste affichée.
        this.setListPays(ps.paysId);
        this.activeTab.set('list');
        this.load();
      },
      error: err => {
        // Le serveur renvoie un ProblemDetail : la cause lisible est dans `detail`.
        this.newSetError.set(err?.error?.detail ?? err?.error?.message ?? this.t('PAYROLL.ADMIN.ERROR'));
        this.savingNewSet.set(false);
      },
    });
  }

  // ── Data loading ──────────────────────────────────────────────────────────
  load(): void {
    const paysId = this.filterForm.get('paysId')?.value;
    if (!paysId) {
      // Pays retiré du filtre : l'onglet revient à son état vide (KPI à 0, liste vide).
      this.paramSets.set([]);
      return;
    }
    this.loading.set(true);
    this.hr.getContractTypes(paysId).subscribe(types => {
      this.contractTypes.set(types);
    });
    this.api.listParameterSets(paysId).subscribe({
      next: ps => {
        this.paramSets.set(ps);
        this.loading.set(false);
        this.firstLoad.set(false);
      },
      error: err => {
        this.notification.error(err?.error?.message ?? this.t('PAYROLL.PARAMETER_SETS.ERROR_GENERIC'));
        this.loading.set(false);
        this.firstLoad.set(false);
      },
    });
  }

  itemTitle(ps: ParameterSetDto): string {
    return `v${ps.version} — ${ps.fiscalYear}`;
  }

  // ── Charges sociales ──────────────────────────────────────────────────────
  openChargesEditor(ps: ParameterSetDto): void {
    this.closeRubriquesEditor();
    while (this.editRates.length) this.editRates.removeAt(0);
    ps.socialChargeRates.forEach(r => this.editRates.push(this.fb.group({
      contractType:    [r.contractType],
      chargeCode:      [r.chargeCode,    Validators.required],
      chargeLabel:     [r.chargeLabel,   Validators.required],
      employeeRate:    [r.employeeRate],
      employerRate:    [r.employerRate],
      baseCalculation: [r.baseCalculation ?? 'GROSS'],
      capAmount:       [r.capAmount],
      formulaEe:       [r.formulaEe ?? ''],
      formulaEr:       [r.formulaEr ?? ''],
      evalOrder:       [r.evalOrder ?? 0],
    })));
    this.editingChargesId.set(ps.id);
    this.chargesError.set(null);
    this.onEditRateSearch('');
    const tpl = this.chargesEditorTpl();
    if (!tpl) return;
    this.chargesModalRef = this.modalService.open({
      title: this.t('PAYROLL.PARAMETER_SETS.CHARGES_EDITOR_MODAL_TITLE'),
      subtitle: this.itemTitle(ps),
      icon: 'payments',
      size: 'xl',
      body: tpl,
    });
  }

  closeChargesEditor(): void {
    this.editingChargesId.set(null);
    while (this.editRates.length) this.editRates.removeAt(0);
    this.chargesModalRef?.close();
    this.chargesModalRef = null;
  }

  addEditRate(): void {
    this.editRates.push(this.fb.group({
      contractType:    ['CDI'],
      chargeCode:      ['', Validators.required],
      chargeLabel:     ['', Validators.required],
      employeeRate:    [0],
      employerRate:    [0],
      baseCalculation: ['GROSS'],
      capAmount:       [null],
      formulaEe:       [''],
      formulaEr:       [''],
      evalOrder:       [0],
    }));
  }

  removeEditRate(i: number): void { this.editRates.removeAt(i); }

  saveCharges(psId: number): void {
    if (this.savingCharges()) return;
    this.chargesError.set(null);
    this.savingCharges.set(true);
    const rates = this.chargesForm.getRawValue().rates as SocialChargeRateDto[];
    this.api.updateSocialChargeRates(psId, rates).subscribe({
      next: updated => {
        this.paramSets.update(ps => ps.map(p => p.id === updated.id ? updated : p));
        this.selected.update(s => s?.id === updated.id ? updated : s);
        this.closeChargesEditor();
        this.savingCharges.set(false);
      },
      error: err => {
        this.chargesError.set(err?.error?.detail ?? err?.error?.message ?? this.t('PAYROLL.PARAMETER_SETS.ERROR_SAVE_CHARGES'));
        this.savingCharges.set(false);
      },
    });
  }

  // ── Rubriques de paie ──────────────────────────────────────────────────────
  openRubriquesEditor(ps: ParameterSetDto): void {
    this.closeChargesEditor();
    while (this.editRubriques.length) this.editRubriques.removeAt(0);
    (ps.rubriques ?? []).forEach(r => this.editRubriques.push(this.makeRubriqueGroup(r)));
    // Auto-expand the first card so the form is immediately visible.
    this.expandedRubriques.set(new Set([0]));
    this.editingRubriquesId.set(ps.id);
    this.rubriquesError.set(null);
    const tpl = this.rubriquesEditorTpl();
    if (!tpl) return;
    this.rubriquesModalRef = this.modalService.open({
      title: this.t('PAYROLL.PARAMETER_SETS.RUBRIQUES_EDITOR_MODAL_TITLE'),
      subtitle: this.itemTitle(ps),
      icon: 'receipt_long',
      size: 'xl',
      body: tpl,
    });
  }

  private makeRubriqueGroup(r: Partial<PayrollRubriqueDto>): FormGroup {
    const selectedCodes = new Set(
      (r.contractTypes ?? '').split(',').map(s => s.trim()).filter(Boolean)
    );
    const ctByCodeControls: Record<string, [boolean]> = {};
    this.contractTypes().forEach(ct => { ctByCodeControls[ct.code] = [selectedCodes.has(ct.code)]; });
    return this.fb.group({
      code:                     [r.code     ?? '',           Validators.required],
      labelFr:                  [r.labelFr  ?? '',           Validators.required],
      labelEn:                  [r.labelEn  ?? ''],
      nature:                   [r.nature   ?? 'AVANTAGE'],
      calcMode:                 [r.calcMode ?? 'FIXE_MENSUEL'],
      amount:                   [r.amount   ?? null],
      ratePercent:              [r.rate != null ? +(r.rate * 100).toFixed(4) : null],
      capAmount:                [r.capAmount ?? null],
      formulaExpression:        [r.formulaExpression ?? ''],
      employerSharePct:         [r.employerSharePct  ?? 0],
      employeeSharePct:         [r.employeeSharePct  ?? 0],
      isSubjectToSocialCharges: [r.isSubjectToSocialCharges ?? false],
      isSubjectToIrpp:          [r.isSubjectToIrpp   ?? true],
      ctAll:                    [!r.contractTypes],
      ctByCode:                 this.fb.group(ctByCodeControls),
      isActive:                 [r.isActive  ?? true],
    });
  }

  closeRubriquesEditor(): void {
    this.editingRubriquesId.set(null);
    this.expandedRubriques.set(new Set());
    while (this.editRubriques.length) this.editRubriques.removeAt(0);
    this.rubriquesModalRef?.close();
    this.rubriquesModalRef = null;
  }

  addEditRubrique(): void {
    this.editRubriques.push(this.makeRubriqueGroup({}));
    const newIndex = this.editRubriques.length - 1;
    const s = new Set(this.expandedRubriques());
    s.add(newIndex);
    this.expandedRubriques.set(s);
  }

  removeEditRubrique(i: number): void {
    this.editRubriques.removeAt(i);
    const updated = new Set<number>();
    this.expandedRubriques().forEach(idx => {
      if (idx < i) updated.add(idx);
      else if (idx > i) updated.add(idx - 1);
    });
    this.expandedRubriques.set(updated);
  }

  saveRubriques(psId: number): void {
    if (this.savingRubriques()) return;
    this.rubriquesError.set(null);
    this.savingRubriques.set(true);
    const raw = this.rubriquesForm.getRawValue().items as any[];
    const payload: SavePayrollRubriqueRequest[] = raw.map((r, idx) => ({
      code:                     r.code,
      labelFr:                  r.labelFr,
      labelEn:                  r.labelEn?.trim() || null,
      nature:                   r.nature,
      calcMode:                 r.calcMode,
      amount:                   r.amount,
      rate:                     r.ratePercent != null ? r.ratePercent / 100 : null,
      capAmount:                r.capAmount,
      formulaExpression:        r.calcMode === 'FORMULE' ? (r.formulaExpression?.trim() || null) : null,
      displayOrder:             idx,
      employerSharePct:         r.employerSharePct ?? 0,
      employeeSharePct:         r.employeeSharePct ?? 0,
      isSubjectToSocialCharges: r.isSubjectToSocialCharges,
      isSubjectToIrpp:          r.isSubjectToIrpp,
      direction:                r.nature === 'RETENUE' ? 'DEBIT' : 'CREDIT',
      contractTypes:            r.ctAll ? null :
        Object.entries(r.ctByCode ?? {})
          .filter(([, checked]) => checked === true)
          .map(([code]) => code)
          .join(',') || null,
      isActive:                 r.isActive,
    }));
    this.api.updateRubriques(psId, payload).subscribe({
      next: updated => {
        this.paramSets.update(ps => ps.map(p => p.id === updated.id ? updated : p));
        this.selected.update(s => s?.id === updated.id ? updated : s);
        this.closeRubriquesEditor();
        this.savingRubriques.set(false);
      },
      error: err => {
        this.rubriquesError.set(err?.error?.detail ?? err?.error?.message ?? this.t('PAYROLL.PARAMETER_SETS.ERROR_SAVE_RUBRIQUES'));
        this.savingRubriques.set(false);
      },
    });
  }

  // ── Workflow ───────────────────────────────────────────────────────────────
  // Soumettre / approuver passe par une pop-up de confirmation (pied RH, bandeau d'erreur) :
  // ces étapes sont irréversibles et la seconde approbation active le jeu pour la paie.
  readonly pendingWorkflow = signal<{ step: WorkflowStep; ps: ParameterSetDto } | null>(null);
  readonly workflowSaving  = signal(false);
  readonly workflowError   = signal<string | null>(null);
  private workflowModalRef: ModalRef | null = null;

  /** Étapes encore possibles sur ce jeu, dans l'ordre du circuit. */
  workflowSteps(ps: ParameterSetDto): WorkflowStep[] {
    if (ps.status === 'DRAFT') return ['submit'];
    if (ps.status !== 'PENDING_FINANCE') return [];
    return [
      ...(ps.approvedByHr == null ? ['hr' as const] : []),
      ...(ps.approvedByFinance == null ? ['finance' as const] : []),
    ];
  }

  workflowLabel(step: WorkflowStep): string {
    return step === 'submit' ? 'PAYROLL.PARAMETER_SETS.SUBMIT_BUTTON'
      : step === 'hr' ? 'PAYROLL.PARAMETER_SETS.APPROVE_HR_BUTTON'
      : 'PAYROLL.PARAMETER_SETS.APPROVE_FINANCE_BUTTON';
  }

  workflowMessage(step: WorkflowStep): string {
    return step === 'submit' ? 'PAYROLL.PARAMETER_SETS.CONFIRM_SUBMIT'
      : step === 'hr' ? 'PAYROLL.PARAMETER_SETS.CONFIRM_HR'
      : 'PAYROLL.PARAMETER_SETS.CONFIRM_FINANCE';
  }

  askWorkflow(step: WorkflowStep, ps: ParameterSetDto): void {
    const tpl = this.workflowConfirmTpl();
    if (!tpl) return;
    this.pendingWorkflow.set({ step, ps });
    this.workflowError.set(null);
    this.workflowModalRef = this.modalService.open({
      title: this.t(this.workflowLabel(step)),
      icon: step === 'submit' ? 'send' : 'verified',
      body: tpl,
      size: 'sm',
      closeOnBackdrop: false,
    });
  }

  closeWorkflow(): void {
    this.workflowModalRef?.close();
    this.workflowModalRef = null;
    this.pendingWorkflow.set(null);
  }

  confirmWorkflow(): void {
    const w = this.pendingWorkflow();
    if (!w || this.workflowSaving()) return;
    const call = w.step === 'submit' ? this.api.submitParameterSet(w.ps.id)
      : w.step === 'hr' ? this.api.approveHr(w.ps.id)
      : this.api.approveFinance(w.ps.id);
    this.workflowSaving.set(true);
    this.workflowError.set(null);
    call.subscribe({
      next: updated => {
        this.workflowSaving.set(false);
        // La seconde approbation archive l'ancien jeu actif : on recharge toute la liste.
        if (updated.status === 'ACTIVE') this.load();
        else this.paramSets.update(ps => ps.map(p => p.id === updated.id ? updated : p));
        this.closeWorkflow();
      },
      error: err => {
        this.workflowSaving.set(false);
        this.workflowError.set(err?.error?.detail ?? err?.error?.message ?? this.t('PAYROLL.ADMIN_HOME.SAVE_ERROR'));
      },
    });
  }

  setStatusVariant(ps: ParameterSetDto): BadgeVariant {
    return SET_STATUS_VARIANT[ps.status] ?? 'neutral';
  }

  /** Sous-titre de la page détail : où en sont les approbations, puis les réglages du calcul. */
  approvalLine(ps: ParameterSetDto): string {
    const state = (done: boolean) => this.t(done ? 'PAYROLL.PARAMETER_SETS.APPROVAL_DONE' : 'PAYROLL.PARAMETER_SETS.APPROVAL_WAITING');
    let approvals: string;
    if (ps.status === 'DRAFT') approvals = this.t('PAYROLL.PARAMETER_SETS.APPROVAL_NOT_SUBMITTED');
    else if (ps.status === 'PENDING_FINANCE') approvals = this.t('PAYROLL.PARAMETER_SETS.APPROVAL_LINE', {
      hr: state(ps.approvedByHr != null), finance: state(ps.approvedByFinance != null),
    });
    else if (ps.activatedAt) approvals = this.t('PAYROLL.PARAMETER_SETS.APPROVAL_ACTIVATED', { date: this.shortDate(ps.activatedAt) });
    else approvals = this.statusLabel(ps);
    return `${approvals} · ${this.t('PAYROLL.PARAMETER_SETS.PS_META', { tolerance: ps.convergenceTolerance, threshold: ps.calibrationThresholdPct })}`;
  }

  private shortDate(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString(this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  statusLabel(ps: ParameterSetDto): string {
    switch (ps.status) {
      case 'DRAFT':    return this.t('PAYROLL.PARAMETER_SETS.STATUS.DRAFT');
      case 'ACTIVE':   return this.t('PAYROLL.PARAMETER_SETS.STATUS.ACTIVE');
      case 'ARCHIVED': return this.t('PAYROLL.PARAMETER_SETS.STATUS.ARCHIVED');
      case 'PENDING_FINANCE': {
        const dirOk  = ps.approvedByHr      != null;
        const dafOk  = ps.approvedByFinance != null;
        if (dirOk && !dafOk)  return this.t('PAYROLL.PARAMETER_SETS.STATUS_HR_OK_WAITING_DAF');
        if (!dirOk && dafOk)  return this.t('PAYROLL.PARAMETER_SETS.STATUS_DAF_OK_WAITING_HR');
        return this.t('PAYROLL.PARAMETER_SETS.STATUS_SUBMITTED_WAITING');
      }
      default: return ps.status;
    }
  }

  statusClass(ps: ParameterSetDto): string {
    switch (ps.status) {
      case 'DRAFT':           return 'badge badge--draft';
      case 'PENDING_FINANCE': return 'badge badge--pending';
      case 'ACTIVE':          return 'badge badge--active';
      case 'ARCHIVED':        return 'badge badge--archived';
      default:                return 'badge';
    }
  }

  natureClass(nature: string): string {
    switch (nature) {
      case 'AVANTAGE':  return 'badge badge--avantage';
      case 'INDEMNITE': return 'badge badge--indemnite';
      case 'PRIME':     return 'badge badge--prime';
      case 'RETENUE':   return 'badge badge--retenue';
      default:          return 'badge';
    }
  }

  directionClass(direction: string): string {
    return direction === 'CREDIT' ? 'badge badge--credit' : 'badge badge--debit';
  }

  formatCalcMode(calcMode: string): string {
    const key = `PAYROLL.PARAMETER_SETS.CALC_MODE_SHORT.${calcMode}`;
    const label = this.t(key);
    return label === key ? calcMode : label;
  }

  // ── daf-badge / daf-select / daf-radio-group option mappers ────────────────
  statusVariant(ps: ParameterSetDto): BadgeVariant {
    switch (ps.status) {
      case 'ACTIVE':          return 'success';
      case 'ARCHIVED':        return 'neutral';
      case 'PENDING_FINANCE': return 'warning';
      default:                return 'neutral'; // DRAFT
    }
  }

  natureVariant(nature: string): BadgeVariant {
    switch (nature) {
      case 'PRIME':     return 'success';
      case 'AVANTAGE':  return 'info';
      case 'INDEMNITE': return 'warning';
      case 'RETENUE':   return 'danger';
      default:          return 'neutral';
    }
  }

  directionVariant(direction: string): BadgeVariant {
    return direction === 'CREDIT' ? 'success' : 'danger';
  }

  readonly contractTypeOptions = computed<SelectOption[]>(() =>
    this.contractTypes().map(ct => ({ value: ct.code, label: ct.code })));

  readonly natureRadioOptions = computed<RadioOption[]>(() =>
    this.natureOptions().map(o => ({ value: o.value, label: o.label, hint: o.description })));

  readonly calcModeRadioOptions = computed<RadioOption[]>(() =>
    this.calcModeOptions().map(o => ({ value: o.value, label: o.label, hint: o.description })));

  // ── daf-data-table columns/rows — charges (read-only) ───────────────────────
  readonly chargesColumns = computed<TableColumn[]>(() => [
    { key: 'contractType', label: this.t('PAYROLL.PARAMETER_SETS.COL_TYPE'), type: 'badge', sortable: true },
    { key: 'chargeCode',   label: this.t('PAYROLL.PARAMETER_SETS.COL_CODE'), sortable: true },
    { key: 'chargeLabel',  label: this.t('PAYROLL.PARAMETER_SETS.COL_LABEL'), sortable: true },
    { key: 'employeeShare', label: this.t('PAYROLL.PARAMETER_SETS.COL_EMPLOYEE_SHARE'), type: 'percent', format: { maximumFractionDigits: 2 }, sortable: true },
    { key: 'employerShare', label: this.t('PAYROLL.PARAMETER_SETS.COL_EMPLOYER_SHARE'), type: 'percent', format: { maximumFractionDigits: 2 }, sortable: true },
    { key: 'baseCalculation', label: this.t('PAYROLL.PARAMETER_SETS.COL_BASE'), sortable: true },
  ]);

  chargesRows(ps: ParameterSetDto): TableRow[] {
    return (ps.socialChargeRates ?? []).map(r => ({
      id:              r.chargeCode,
      contractType:    { label: r.contractType, options: { variant: 'neutral' as BadgeVariant, size: 'sm' as const } },
      chargeCode:      r.chargeCode,
      chargeLabel:     r.chargeLabel,
      // Valeur brute (la colonne `percent` formate) ; une formule n'est pas un nombre et
      // s'affiche telle quelle.
      employeeShare:   r.baseCalculation === 'FORMULE' ? (r.formulaEe || '—') : round2(r.employeeRate * 100),
      employerShare:   r.baseCalculation === 'FORMULE' ? (r.formulaEr || '—') : round2(r.employerRate * 100),
      baseCalculation: r.baseCalculation,
    }));
  }

  // ── Éditeur JSON du barème IRPP (onglet "Nouveau jeu") ──────────────────────
  isJsonValid(raw: string | null | undefined): boolean {
    if (!raw) return false;
    try { JSON.parse(raw); return true; } catch { return false; }
  }

  /** Reformate le JSON du barème IRPP avec une indentation de 2 espaces. Ne fait rien
   *  si le JSON est invalide — le badge de validation le signale déjà. */
  formatIrppJson(): void {
    const ctrl = this.newSetForm.get('irppBrackets')!;
    try {
      const parsed = JSON.parse(ctrl.value ?? '[]');
      ctrl.setValue(JSON.stringify(parsed, null, 2));
    } catch {
      // JSON invalide : rien à reformater, le badge "Invalide" reste affiché.
    }
  }

  // ── daf-data-table columns/rows — benefits (read-only, legacy) ──────────────
  readonly benefitsColumns = computed<TableColumn[]>(() => [
    { key: 'benefitCode',   label: this.t('PAYROLL.PARAMETER_SETS.COL_CODE'), sortable: true },
    { key: 'benefitLabelFr', label: this.t('PAYROLL.PARAMETER_SETS.COL_LABEL'), sortable: true },
    { key: 'monthlyValue',  label: this.t('PAYROLL.PARAMETER_SETS.COL_MONTHLY_VALUE'), type: 'number', format: { minimumFractionDigits: 0, maximumFractionDigits: 0 }, sortable: true },
    { key: 'taxable',       label: this.t('PAYROLL.PARAMETER_SETS.COL_TAXABLE'), type: 'badge', sortable: true },
  ]);

  benefitsRows(ps: ParameterSetDto): TableRow[] {
    return (ps.benefits ?? []).map(b => ({
      id:             b.benefitCode,
      benefitCode:    b.benefitCode,
      benefitLabelFr: b.benefitLabelFr,
      monthlyValue:   b.monthlyValue,
      taxable:        this.yesNo(b.isTaxable),
    }));
  }

  // ── daf-data-table columns/rows — rubriques (read-only) ─────────────────────
  readonly rubriquesColumns = computed<TableColumn[]>(() => [
    { key: 'code',          label: this.t('PAYROLL.PARAMETER_SETS.COL_CODE'), sortable: true },
    { key: 'labelFr',       label: this.t('PAYROLL.PARAMETER_SETS.COL_LABEL'), sortable: true },
    { key: 'nature',        label: this.t('PAYROLL.PARAMETER_SETS.COL_NATURE'), type: 'badge', sortable: true },
    { key: 'calcMode',      label: this.t('PAYROLL.PARAMETER_SETS.COL_CALC_MODE'), sortable: true },
    { key: 'valueRate',     label: this.t('PAYROLL.PARAMETER_SETS.COL_VALUE_RATE'), sortable: true },
    { key: 'direction',     label: this.t('PAYROLL.PARAMETER_SETS.COL_DIRECTION'), type: 'badge', sortable: true },
    { key: 'irpp',          label: this.t('PAYROLL.PARAMETER_SETS.COL_IRPP'), type: 'badge', sortable: true },
    { key: 'charges',       label: this.t('PAYROLL.PARAMETER_SETS.COL_CHARGES'), type: 'badge', sortable: true },
    { key: 'contractTypes', label: this.t('PAYROLL.PARAMETER_SETS.COL_CONTRACTS'), sortable: true },
    { key: 'active',        label: this.t('PAYROLL.PARAMETER_SETS.COL_ACTIVE'), type: 'badge', sortable: true },
  ]);

  rubriquesRows(ps: ParameterSetDto): TableRow[] {
    return (ps.rubriques ?? []).map(r => ({
      id:            r.code,
      code:          r.code,
      labelFr:       r.labelFr,
      nature:        { label: this.natureLabel(r.nature), options: { variant: this.natureVariant(r.nature), size: 'sm' as const } },
      calcMode:      this.formatCalcMode(r.calcMode),
      valueRate:     this.rubriqueValue(r),
      direction:     { label: r.direction, options: { variant: this.directionVariant(r.direction), size: 'sm' as const } },
      irpp:          this.yesNo(r.isSubjectToIrpp),
      charges:       this.yesNo(r.isSubjectToSocialCharges),
      contractTypes: r.contractTypes || this.t('PAYROLL.PARAMETER_SETS.CONTRACTS_ALL'),
      active:        this.yesNo(r.isActive),
    }));
  }

  // ── Recherche des tableaux du détail (une barre par onglet, un seul visible) ─
  // Remises à zéro à chaque changement de jeu ou d'onglet. Pas de pagination ici : le
  // détail d'un jeu arrive entier et s'affiche d'un bloc.
  readonly rubriquesSearch = signal('');
  readonly benefitsSearch  = signal('');
  readonly chargesSearch   = signal('');

  private readonly resetDetailSearch = effect(() => {
    this.openSetId();
    this.detailTab();
    untracked(() => {
      this.rubriquesSearch.set('');
      this.benefitsSearch.set('');
      this.chargesSearch.set('');
    });
  });

  /** Nombre tel qu'affiché par la colonne (séparateurs de la langue), pour la recherche. */
  private searchNumber(v: unknown, maximumFractionDigits: number): unknown {
    return typeof v === 'number' ? v.toLocaleString(this.numberLocale, { maximumFractionDigits }) : v;
  }

  readonly rubriquesView = computed<TableRow[]>(() => {
    const ps = this.detailSet();
    return ps ? searchTableRows(this.rubriquesRows(ps), this.rubriquesColumns(), this.rubriquesSearch()) : [];
  });

  readonly benefitsView = computed<TableRow[]>(() => {
    const ps = this.detailSet();
    if (!ps) return [];
    const columns = this.benefitsColumns().map(c => c.key === 'monthlyValue'
      ? { ...c, sortAccessor: (row: TableRow) => this.searchNumber(row[c.key], 0) as string }
      : c);
    return searchTableRows(this.benefitsRows(ps), columns, this.benefitsSearch());
  });

  readonly chargesView = computed<TableRow[]>(() => {
    const ps = this.detailSet();
    if (!ps) return [];
    // Parts salarié / patronale : brutes (la colonne `percent` formate) → texte affiché.
    const columns = this.chargesColumns().map(c => c.type === 'percent'
      ? { ...c, sortAccessor: (row: TableRow) => this.searchNumber(row[c.key], 2) as string }
      : c);
    return searchTableRows(this.chargesRows(ps), columns, this.chargesSearch());
  });

  private get numberLocale(): string {
    return this.translate.currentLang() === 'en' ? 'en-US' : 'fr-FR';
  }

  rubriqueValue(r: { calcMode: string; amount: number | null; rate: number | null; capAmount?: number | null; formulaExpression?: string | null }, devise: string = ''): string {
    if (r.calcMode === 'FORMULE') {
      return r.formulaExpression ? `= ${r.formulaExpression}` : this.t('PAYROLL.PARAMETER_SETS.FORMULA_EMPTY');
    }
    if (r.calcMode === 'FIXE_MENSUEL' || r.calcMode === 'FIXE_JOURNALIER') {
      return r.amount != null
        ? `${r.amount.toLocaleString(this.numberLocale)}${r.calcMode === 'FIXE_JOURNALIER' ? this.t('PAYROLL.PARAMETER_SETS.PER_DAY_SUFFIX') : ''}`
        : '—';
    }
    if (r.rate != null) {
      const pct = `${(r.rate * 100).toFixed(2)} %`;
      return (r.calcMode === 'POURCENTAGE_PLAFONNE' && r.capAmount != null)
        ? `${pct} ${this.t('PAYROLL.PARAMETER_SETS.CAP_SUFFIX', { cap: r.capAmount.toLocaleString(this.numberLocale) })}`
        : pct;
    }
    return '—';
  }

  // ── Formula mode helpers ───────────────────────────────────────────────────

  /**
   * Returns the set of formula variable chips for the selected parameter set:
   * BRUT, CHARGES_EE/ER, and one _EE/_ER pair per distinct charge code.
   */
  formulaVariableHints(): { name: string; desc: string }[] {
    const ps = this.selected();
    const hints: { name: string; desc: string }[] = [
      { name: 'BRUT',       desc: this.t('PAYROLL.PARAMETER_SETS.VAR_GROSS_DESC') },
      { name: 'CHARGES_EE', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_CHARGES_EE_DESC') },
      { name: 'CHARGES_ER', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_CHARGES_ER_DESC') },
    ];
    const seen = new Set<string>();
    (ps?.socialChargeRates ?? []).forEach(r => {
      const key = r.chargeCode.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({ name: key + '_EE', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_EE_DESC', { label: r.chargeLabel }) });
        hints.push({ name: key + '_ER', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_ER_DESC', { label: r.chargeLabel }) });
      }
    });
    return hints;
  }

  /**
   * Returns variable chips for rubriques that appear before position `currentIndex`
   * in the list (lower display_order → referenceable by later FORMULE rubriques).
   */
  priorRubriqueVars(currentIndex: number): { name: string; desc: string }[] {
    return this.editRubriques.controls
      .slice(0, currentIndex)
      .map((ctrl, i) => {
        const g = ctrl as FormGroup;
        const code  = (g.get('code')!.value as string  || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
        const label =  g.get('labelFr')!.value as string || this.t('PAYROLL.PARAMETER_SETS.RUBRIQUE_FALLBACK_LABEL', { n: i + 1 });
        return code ? { name: code, desc: label } : null;
      })
      .filter((v): v is { name: string; desc: string } => v !== null);
  }

  /** Appends a variable name into the formulaExpression field of card i. */
  insertFormulaVar(i: number, varName: string): void {
    const ctrl = this.editRubriqueGroup(i).get('formulaExpression')!;
    const current: string = ctrl.value ?? '';
    ctrl.setValue(current ? `${current} + ${varName}` : varName);
    ctrl.markAsDirty();
  }

  // ── Charge formula helpers ─────────────────────────────────────────────────

  /**
   * Returns variable chips available to the formula of charge at position `i`.
   * A charge can reference BRUT and the results of charges that appear BEFORE it
   * in the list (i.e. have a lower eval_order / earlier position).
   */
  chargeVariableHints(currentIndex: number): { name: string; desc: string }[] {
    const hints: { name: string; desc: string }[] = [
      { name: 'BRUT', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_GROSS_DESC') },
    ];
    this.editRates.controls.slice(0, currentIndex).forEach(ctrl => {
      const g = ctrl as FormGroup;
      const code  = ((g.get('chargeCode')!.value as string) || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const label =   g.get('chargeLabel')!.value as string || '';
      if (code) {
        hints.push({ name: code + '_EE', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_EE_DESC', { label }) });
        hints.push({ name: code + '_ER', desc: this.t('PAYROLL.PARAMETER_SETS.VAR_ER_DESC', { label }) });
      }
    });
    return hints;
  }

  /** Appends a variable name into the formulaEe or formulaEr field of charge row i. */
  insertChargeFormulaVar(i: number, side: 'formulaEe' | 'formulaEr', varName: string): void {
    const ctrl = this.editRateGroup(i).get(side)!;
    const current: string = ctrl.value ?? '';
    ctrl.setValue(current ? `${current} + ${varName}` : varName);
    ctrl.markAsDirty();
  }

  toggleRubriqueCard(i: number): void {
    const s = new Set(this.expandedRubriques());
    if (s.has(i)) { s.delete(i); } else { s.add(i); }
    this.expandedRubriques.set(s);
  }

  isRubriqueExpanded(i: number): boolean {
    return this.expandedRubriques().has(i);
  }

  natureLabel(value: string): string {
    return this.natureOptions().find(o => o.value === value)?.label ?? value;
  }

  /** `daf-accordion-card` `icon` for a rubrique card, by nature. */
  rubriqueIcon(nature: string): string {
    switch (nature) {
      case 'PRIME':     return 'star';
      case 'INDEMNITE': return 'payments';
      case 'RETENUE':   return 'remove_circle';
      default:          return 'redeem'; // AVANTAGE
    }
  }

  calcModeLabel(value: string): string {
    return this.calcModeOptions().find(o => o.value === value)?.label ?? value;
  }

  /** Montant d'aperçu d'une rubrique en cours d'édition, `null` en mode FORMULE (non
   *  évaluable sans le contexte des charges — la simulation donne la vraie valeur). */
  previewValue(i: number): number | null {
    const g = this.editRubriqueGroup(i).getRawValue();
    const gross = this.testGross();
    switch (g['calcMode']) {
      case 'FIXE_MENSUEL':
      case 'FIXE_JOURNALIER':
        return g['amount'] ?? 0;
      case 'POURCENTAGE_BRUT':
      case 'POURCENTAGE_CHARGES':
        return gross * (g['ratePercent'] ?? 0) / 100;
      case 'POURCENTAGE_PLAFONNE': {
        const cap: number = g['capAmount'] ?? gross;
        return Math.min(gross, cap) * (g['ratePercent'] ?? 0) / 100;
      }
      default:
        return null;
    }
  }

  /** Même montant, formaté avec la devise du jeu édité — pour le sous-titre de la carte. */
  previewAmount(i: number): string {
    const v = this.previewValue(i);
    if (v == null) return '—';
    const amount = v.toLocaleString(this.numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${amount} ${this.editorDevise()}`.trim();
  }

  // ── Devise ────────────────────────────────────────────────────────────────
  // Plus de "TND" écrit en dur : la devise vient du pays (référentiel `listPays`), celui
  // du formulaire de création ou celui du jeu ouvert dans une pop-up.
  private deviseOf(paysId: number | null | undefined): string {
    return this.paysList().find(p => p.id === paysId)?.devise ?? '';
  }

  /** Devise du pays choisi dans le formulaire "Nouveau jeu". */
  newSetDevise(): string {
    return this.deviseOf(this.newSetForm.get('paysId')?.value);
  }

  /** Devise du jeu en cours d'édition (pop-up charges ou rubriques). */
  editorDevise(): string {
    const id = this.editingRubriquesId() ?? this.editingChargesId();
    return this.deviseOf(this.paramSets().find(p => p.id === id)?.paysId);
  }

  /** Locale des montants (`daf-amount-field`), la même que partout ailleurs sur la page. */
  numberLocaleCode(): string { return this.numberLocale; }

  /** Au moins une ligne en mode FORMULE : on affiche alors l'aide sur l'ordre d'évaluation. */
  hasFormulaRate(): boolean {
    return this.editRates.controls.some(c => c.get('baseCalculation')?.value === 'FORMULE');
  }

  formatGross(): string {
    return this.testGross().toLocaleString(this.numberLocale);
  }

  // ── Tableaux de saisie des charges (daf-data-table + cellules `dafCell`) ─────
  // Remplacent l'ancienne grille maison `.rates-head`/`.rates-row`. Une ligne du tableau =
  // un FormGroup, retrouvé par l'index porté dans son `id` (`rowIndex(row)`, pas la position
  // d'affichage : la recherche masque des lignes) ; `id` stable par position dans le
  // formulaire pour que le tableau garde les champs (et le focus) d'une frappe à l'autre.
  readonly editRateColumns = computed<TableColumn[]>(() => [
    { key: 'contractType',    label: this.t('PAYROLL.PARAMETER_SETS.COL_TYPE'),           width: '130px' },
    { key: 'chargeCode',      label: this.t('PAYROLL.PARAMETER_SETS.COL_CODE'),           width: '120px' },
    { key: 'chargeLabel',     label: this.t('PAYROLL.PARAMETER_SETS.COL_LABEL') },
    { key: 'employeeRate',    label: this.t('PAYROLL.PARAMETER_SETS.COL_EMPLOYEE_SHARE'), width: '180px' },
    { key: 'employerRate',    label: this.t('PAYROLL.PARAMETER_SETS.COL_EMPLOYER_SHARE'), width: '180px' },
    { key: 'baseCalculation', label: this.t('PAYROLL.PARAMETER_SETS.COL_BASE'),           width: '160px' },
    { key: 'capAmount',       label: this.t('PAYROLL.PARAMETER_SETS.COL_CAP_OR_ORDER'),   width: '130px' },
  ]);

  // Recherche du tableau de saisie. Une ligne garde l'index de SON FormGroup dans `id`
  // (`line-<index du formulaire>`), et les cellules le relisent par `rowIndex(row)` — jamais
  // par la position d'affichage, qui change dès que la recherche masque des lignes.
  // Le résultat est figé à la frappe (contrôles retenus, par identité) : modifier un champ
  // ne fait pas disparaître sa ligne en cours de saisie, une ligne ajoutée ensuite reste
  // visible, et une suppression (qui décale les index) ne mélange pas les lignes.
  readonly editRateSearch = signal('');
  private editRateMatches: { all: Set<AbstractControl>; matched: Set<AbstractControl> } | null = null;

  /** Colonnes de recherche : le texte affiché dans les champs (formule en mode FORMULE,
   *  libellé de la base de calcul, ordre d'évaluation à la place du plafond). */
  private editRateSearchRow(ctrl: AbstractControl, i: number): TableRow {
    const v = (ctrl as FormGroup).getRawValue();
    const formula = v['baseCalculation'] === 'FORMULE';
    return {
      id:              `line-${i}`,
      contractType:    v['contractType'] ?? '',
      chargeCode:      v['chargeCode'] ?? '',
      chargeLabel:     v['chargeLabel'] ?? '',
      employeeRate:    formula ? (v['formulaEe'] ?? '') : (v['employeeRate'] ?? ''),
      employerRate:    formula ? (v['formulaEr'] ?? '') : (v['employerRate'] ?? ''),
      baseCalculation: this.baseCalcOptions().find(o => o.value === v['baseCalculation'])?.label ?? v['baseCalculation'] ?? '',
      capAmount:       formula ? (v['evalOrder'] ?? '') : (v['capAmount'] ?? ''),
    };
  }

  onEditRateSearch(value: string | null | undefined): void {
    const query = value ?? '';
    this.editRateSearch.set(query);
    if (!query.trim()) { this.editRateMatches = null; return; }
    const controls = this.editRates.controls;
    const found = searchTableRows(controls.map((c, i) => this.editRateSearchRow(c, i)), this.editRateColumns(), query);
    this.editRateMatches = { all: new Set(controls), matched: new Set(found.map(r => controls[this.rowIndex(r)])) };
  }

  editRateRows(): TableRow[] {
    const m = this.editRateMatches;
    return this.editRates.controls
      .map((ctrl, i) => ({ ctrl, i }))
      .filter(({ ctrl }) => !m || m.matched.has(ctrl) || !m.all.has(ctrl))
      .map(({ i }) => ({ id: `line-${i}` }));
  }

  /** Index du FormGroup d'une ligne du tableau de saisie (pas sa position d'affichage). */
  rowIndex(row: TableRow): number { return Number(String(row['id']).slice('line-'.length)); }

  // ── Charges de « Nouveau jeu » : une carte par charge (plus de tableau de champs) ──
  // Le tableau de 7 colonnes de champs débordait de la carte et n'avait pas d'en-têtes ;
  // chaque charge est maintenant une carte à libellés, en 2 lignes de grille. Les taux se
  // saisissent en % (9,18) et restent stockés en décimal (0.0918) dans le formulaire, donc
  // envoyés au serveur tels qu'avant.

  /** Taux d'une charge en %, pour l'affichage (0.0918 → 9.18), arrondi pour masquer le bruit flottant. */
  newSetRatePct(i: number, name: 'employeeRate' | 'employerRate'): number | null {
    const v = this.newSetRateGroup(i).get(name)!.value as number | null;
    return v == null ? null : Number((v * 100).toFixed(4));
  }

  /** Saisie en % → décimal dans le formulaire (9.18 → 0.0918). */
  setNewSetRatePct(i: number, name: 'employeeRate' | 'employerRate', value: unknown): void {
    const n = this.num(value);
    this.setNewSetRateValue(i, name, n == null ? null : Number((n / 100).toFixed(6)));
  }

  /** Base de calcul : le plafond n'a de sens qu'en `CAPPED_GROSS` — vidé en repassant à `GROSS`
   *  pour ne pas envoyer un plafond invisible. */
  setNewSetRateBase(i: number, value: string): void {
    this.setNewSetRateValue(i, 'baseCalculation', value);
    if (value !== 'CAPPED_GROSS') this.newSetRateGroup(i).get('capAmount')!.setValue(null);
  }

  isNewSetRateCapped(i: number): boolean {
    return this.newSetRateGroup(i).get('baseCalculation')!.value === 'CAPPED_GROSS';
  }

  /** Aperçu d'une charge pour le brut d'exemple (`testGross`, le même que les pop-ups) :
   *  base = brut, ou min(brut, plafond) en `CAPPED_GROSS` — même règle que le moteur. */
  newSetRatePreview(i: number): string {
    const g = this.newSetRateGroup(i).getRawValue();
    const gross = this.testGross();
    const base = g['baseCalculation'] === 'CAPPED_GROSS' ? Math.min(gross, g['capAmount'] ?? gross) : gross;
    return this.t('PAYROLL.ADMIN.CHARGE_PREVIEW', {
      gross: this.money(gross),
      ee: this.money(base * (g['employeeRate'] ?? 0)),
      er: this.money(base * (g['employerRate'] ?? 0)),
    });
  }

  /** Somme des taux saisis, en %, sous la liste des charges. */
  newSetRatesTotal(): string {
    const sum = (name: string) => this.newSetRates.controls
      .reduce((s, c) => s + (Number(c.get(name)!.value) || 0), 0) * 100;
    const pct = (v: number) => v.toLocaleString(this.numberLocale, { maximumFractionDigits: 4 });
    return this.t('PAYROLL.ADMIN.CHARGES_TOTAL', { ee: pct(sum('employeeRate')), er: pct(sum('employerRate')) });
  }

  private money(v: number): string {
    const amount = v.toLocaleString(this.numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${amount} ${this.newSetDevise()}`.trim();
  }

  readonly editRateTableConfig = computed<TableConfig>(() => ({
    showHeader: false,
    emptyMessage: this.t(this.editRateSearch().trim()
      ? 'PAYROLL.ADMIN_HOME.NO_RESULT' : 'PAYROLL.PARAMETER_SETS.CHARGES_EMPTY_EDITOR'),
    // Outils de mise en page seulement, PAS de tri : l'ordre des lignes est l'ordre
    // d'évaluation des charges (variables de formule des lignes précédentes). Chaque
    // cellule retrouve son FormGroup par `rowIndex(row)`.
    ...tableTools(this.translate),
    actions: [{ id: 'remove', icon: 'close', tooltip: this.t('PAYROLL.PARAMETER_SETS.REMOVE'), variant: 'danger',
                onClick: row => this.removeEditRate(this.rowIndex(row)) }],
  }));

  /** Tableaux en lecture seule de la page détail : en-têtes et message vide de la bibliothèque. */
  readTableConfig(emptyKey: string): TableConfig {
    // Tri local : le détail d'un jeu (rubriques, avantages, charges) arrive entier.
    return { showHeader: false, emptyMessage: this.t(emptyKey), ...tableTools(this.translate) };
  }

  /** Oui / Non en pastille de la bibliothèque (au lieu de « ✓ / — »). */
  private yesNo(value: boolean | null | undefined): BadgeCell {
    return {
      label: this.t(value ? 'PAYROLL.PARAMETER_SETS.YES' : 'PAYROLL.PARAMETER_SETS.NO'),
      options: { variant: value ? 'success' : 'neutral', size: 'sm' },
    };
  }
}

/** Arrondi à 2 décimales d'un taux en pourcentage (0.0918 × 100 = 9.180000000000001). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Validateurs du formulaire de création ──────────────────────────────────────
/** Nombre entier (année, itérations). Vide : laissé à `required`. */
function integer(ctrl: AbstractControl): ValidationErrors | null {
  const v = ctrl.value;
  return v == null || v === '' || Number.isInteger(Number(v)) ? null : { integer: true };
}

/** Strictement positif (tolérance de convergence). */
function positive(ctrl: AbstractControl): ValidationErrors | null {
  const v = ctrl.value;
  return v == null || v === '' || Number(v) > 0 ? null : { positive: true };
}

/**
 * Barème IRPP — mêmes règles que le serveur (`ParameterSetService.validateIrppBrackets`) :
 * tableau non vide de tranches {lower, upper, rate} (min/max acceptés), upper null pour la
 * seule dernière tranche, taux ≥ 0, tranches croissantes sans chevauchement. L'erreur porte
 * un code, traduit sous PAYROLL.ADMIN.ERR.IRPP.*.
 */
function irppBracketsValidator(ctrl: AbstractControl): ValidationErrors | null {
  const raw = (ctrl.value ?? '').toString().trim();
  if (!raw) return null;                       // vide : laissé à `required`
  let brackets: unknown;
  try { brackets = JSON.parse(raw); } catch { return { irpp: 'JSON' }; }
  if (!Array.isArray(brackets) || !brackets.length) return { irpp: 'EMPTY' };
  let previousUpper: number | null = null;
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i] as Record<string, unknown> | null;
    const lower = b?.['lower'] ?? b?.['min'];
    const upper = b && 'upper' in b ? b['upper'] : b?.['max'];
    const rate = b?.['rate'];
    if (!b || typeof b !== 'object' || typeof lower !== 'number' || typeof rate !== 'number') return { irpp: 'BRACKET' };
    if (rate < 0) return { irpp: 'NEGATIVE' };
    if (upper != null) {
      if (typeof upper !== 'number' || upper <= lower) return { irpp: 'UPPER' };
    } else if (i < brackets.length - 1) {
      return { irpp: 'OPEN' };
    }
    if (previousUpper != null && lower < previousUpper) return { irpp: 'OVERLAP' };
    previousUpper = upper == null ? null : (upper as number);
  }
  return null;
}
