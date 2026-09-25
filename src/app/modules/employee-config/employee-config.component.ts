import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { EmployeeSelectComponent } from '../../shared/employee-select/employee-select.component';
import { PayrollApiService, BenefitCatalogueDto, PaysDto } from '../../core/payroll-api.service';
import { HrProfileService, EmployeePage, HrContractType } from '../../core/hr-profile.service';
import {
  EmployeeConfigService, EmployeePayrollConfigDto, EmployeePayrollBonusDto,
} from './employee-config.service';

const BONUS_CURRENCIES = ['TND', 'EUR', 'USD', 'EGP', 'SAR', 'AED'];

/**
 * `/payroll/employee-config` — assign a payroll configuration (country, contract type,
 * benefits-in-kind, current net salary) to one specific employee. The payroll-side twin of
 * daf360-rh-frontend's Rémunération tab — both call the same
 * `GET/PUT /api/payroll/employee-configs/{id}`.
 */
@Component({
  selector: 'app-employee-config',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, EmployeeSelectComponent, TranslatePipe],
  templateUrl: './employee-config.component.html',
})
export class EmployeeConfigComponent implements OnInit {
  private svc = inject(EmployeeConfigService);
  private payrollApi = inject(PayrollApiService);
  private hrService = inject(HrProfileService);
  private translate = inject(TranslateService);

  readonly contractTypes = signal<HrContractType[]>([]);
  readonly bonusCurrencies = BONUS_CURRENCIES;

  readonly paysList = signal<PaysDto[]>([]);
  readonly benefits = signal<BenefitCatalogueDto[]>([]);

  readonly employeePage = signal<EmployeePage | null>(null);
  readonly employeeListLoading = signal(false);
  readonly employeeListError = signal<string | null>(null);

  readonly selectedUserId = signal<number | null>(null);
  readonly config = signal<EmployeePayrollConfigDto | null>(null);
  readonly reason = signal('');

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly calculatingNet = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  readonly bonuses = signal<EmployeePayrollBonusDto[]>([]);
  readonly newBonusAmount = signal<number | null>(null);
  readonly newBonusCurrency = signal('TND');
  readonly newBonusMonth = signal<number | null>(new Date().getMonth() + 1);
  readonly newBonusYear = signal<number | null>(new Date().getFullYear());
  readonly newBonusLabel = signal('');
  readonly newBonusComment = signal('');
  readonly bonusError = signal<string | null>(null);

  ngOnInit(): void {
    this.payrollApi.listPays().subscribe(pays => this.paysList.set(pays));
    this.loadEmployeeList();
  }

  loadEmployeeList(): void {
    this.employeeListLoading.set(true);
    this.employeeListError.set(null);
    this.hrService.searchEmployees('').subscribe({
      next: page => { this.employeePage.set(page); this.employeeListLoading.set(false); },
      error: () => {
        this.employeeListLoading.set(false);
        this.employeeListError.set(this.translate.instant('PAYROLL.EMPLOYEE_CONFIG.EMPLOYEE_LIST_ERROR'));
      },
    });
  }

  onEmployeeSelected(userId: number | null): void {
    this.selectedUserId.set(userId);
    this.config.set(null);
    this.benefits.set([]);
    this.contractTypes.set([]);
    this.bonuses.set([]);
    this.error.set(null);
    this.success.set(null);
    this.bonusError.set(null);
    this.newBonusAmount.set(null);
    this.newBonusCurrency.set('TND');
    this.newBonusMonth.set(new Date().getMonth() + 1);
    this.newBonusYear.set(new Date().getFullYear());
    this.newBonusLabel.set('');
    this.newBonusComment.set('');
    if (userId === null) return;
    this.loading.set(true);
    this.svc.get(userId).subscribe({
      next: cfg => {
        this.config.set(cfg);
        this.loading.set(false);
        // Null on a never-configured employee whose country couldn't be auto-resolved — no
        // benefits list to show until the admin picks one via the country select below.
        if (cfg.paysId != null) {
          this.loadBenefitsFor(cfg.paysId);
          this.loadContractTypesFor(cfg.paysId);
        }
      },
      error: () => {
        this.loading.set(false);
        this.error.set(this.translate.instant('PAYROLL.EMPLOYEE_CONFIG.LOAD_ERROR'));
      },
    });
    this.loadBonuses(userId);
  }

  loadBonuses(userId: number): void {
    this.svc.getBonuses(userId).subscribe({
      next: list => this.bonuses.set(list),
      error: () => this.bonusError.set(this.translate.instant('PAYROLL.EMPLOYEE_CONFIG.BONUS_LOAD_ERROR')),
    });
  }

  onPaysChange(paysId: number): void {
    const cfg = this.config();
    if (!cfg) return;
    this.config.set({ ...cfg, paysId, selectedBenefitCodes: [] });
    this.loadBenefitsFor(paysId);
    this.loadContractTypesFor(paysId);
  }

  onContractTypeChange(contractType: string): void {
    const cfg = this.config();
    if (cfg) this.config.set({ ...cfg, contractType });
  }

  onGrossSalaryChange(currentGrossSalary: number | null): void {
    const cfg = this.config();
    if (cfg) this.config.set({ ...cfg, currentGrossSalary });
  }

  onSalaryChange(currentNetSalary: number | null): void {
    const cfg = this.config();
    if (cfg) this.config.set({ ...cfg, currentNetSalary });
  }

  calculateNet(): void {
    const userId = this.selectedUserId();
    const cfg = this.config();
    if (userId === null || cfg === null || cfg.currentGrossSalary == null) return;
    this.calculatingNet.set(true);
    this.error.set(null);
    this.svc.calculateNet(userId, cfg.currentGrossSalary).subscribe({
      next: res => {
        this.calculatingNet.set(false);
        this.config.set({ ...cfg, currentNetSalary: res.netInHand });
      },
      error: () => {
        this.calculatingNet.set(false);
        this.error.set(this.translate.instant('PAYROLL.EMPLOYEE_CONFIG.CALCULATE_ERROR'));
      },
    });
  }

  addBonus(): void {
    const userId = this.selectedUserId();
    const amount = this.newBonusAmount();
    const label = this.newBonusLabel().trim();
    const month = this.newBonusMonth();
    const year = this.newBonusYear();
    this.bonusError.set(null);
    if (userId === null || amount == null || amount <= 0 || label === '' || month == null || year == null) {
      this.bonusError.set(this.translate.instant('PAYROLL.EMPLOYEE_CONFIG.BONUS_VALIDATION_ERROR'));
      return;
    }
    this.svc.createBonus(userId, {
      amount,
      currency: this.newBonusCurrency(),
      periodMonth: month,
      periodYear: year,
      label,
      comment: this.newBonusComment().trim() || null,
    }).subscribe({
      next: created => {
        this.bonuses.set([created, ...this.bonuses()]);
        this.newBonusAmount.set(null);
        this.newBonusLabel.set('');
        this.newBonusComment.set('');
      },
      error: () => this.bonusError.set(this.translate.instant('PAYROLL.EMPLOYEE_CONFIG.BONUS_SAVE_ERROR')),
    });
  }

  deleteBonus(bonusId: number): void {
    const userId = this.selectedUserId();
    if (userId === null) return;
    this.svc.deleteBonus(userId, bonusId).subscribe({
      next: () => this.bonuses.set(this.bonuses().filter(b => b.id !== bonusId)),
      error: () => this.bonusError.set(this.translate.instant('PAYROLL.EMPLOYEE_CONFIG.BONUS_DELETE_ERROR')),
    });
  }

  isBenefitSelected(code: string): boolean {
    return this.config()?.selectedBenefitCodes.includes(code) ?? false;
  }

  toggleBenefit(code: string): void {
    const cfg = this.config();
    if (!cfg) return;
    const selected = cfg.selectedBenefitCodes.includes(code)
      ? cfg.selectedBenefitCodes.filter(c => c !== code)
      : [...cfg.selectedBenefitCodes, code];
    this.config.set({ ...cfg, selectedBenefitCodes: selected });
  }

  save(): void {
    const userId = this.selectedUserId();
    const cfg = this.config();
    // cfg.paysId == null is also checked here, not just on the save button's [disabled]
    // binding: this narrows it to `number` for the request below, and a template attribute
    // guarding a click handler is not something the type checker can see.
    if (userId === null || cfg === null || cfg.paysId == null || this.reason().trim() === '') return;
    this.saving.set(true);
    this.error.set(null);
    this.success.set(null);
    this.svc.upsert(userId, {
      paysId: cfg.paysId,
      contractType: cfg.contractType,
      selectedBenefitCodes: cfg.selectedBenefitCodes,
      currentGrossSalary: cfg.currentGrossSalary,
      currentNetSalary: cfg.currentNetSalary,
      reason: this.reason(),
    }).subscribe({
      next: updated => {
        this.saving.set(false);
        this.config.set(updated);
        this.reason.set('');
        this.success.set(this.translate.instant('PAYROLL.EMPLOYEE_CONFIG.SAVE_SUCCESS'));
      },
      error: () => {
        this.saving.set(false);
        this.error.set(this.translate.instant('PAYROLL.EMPLOYEE_CONFIG.SAVE_ERROR'));
      },
    });
  }

  private loadBenefitsFor(paysId: number): void {
    this.payrollApi.getActiveParameterSet(paysId).subscribe({
      next: ps => this.benefits.set(ps.benefits ?? []),
      error: () => this.benefits.set([]),
    });
  }

  private loadContractTypesFor(paysId: number): void {
    this.hrService.getContractTypes(paysId).subscribe({
      next: types => this.contractTypes.set(types),
      error: () => this.contractTypes.set([]),
    });
  }
}
