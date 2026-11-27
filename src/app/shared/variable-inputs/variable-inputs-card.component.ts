import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CardComponent } from '@khalilrebhiitec/daf360';
import { PayrollVariableInputs } from '../../core/payroll-engine.service';

/**
 * « Éléments variables du mois » — what the payroll run read besides the base salary, with
 * units the payslip table cannot show (hours, days, minutes): weekend overtime day by day
 * (approved timesheet hours, capped per day), unpaid absences, entry/exit days, autorisations
 * above the monthly quota, bonuses, advance instalments, the hourly/daily rates and every
 * warning (a source not read, a parameter not configured).
 *
 * Shared by the « Calculer la paie » pop-up (preview, `compact`) and the payslip of
 * `/payroll/engine-results/:employeeId`. Amounts are in the snapshot's own currency.
 */
@Component({
  selector: 'app-variable-inputs-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TranslatePipe, CardComponent],
  templateUrl: './variable-inputs-card.component.html',
  styleUrl: './variable-inputs-card.component.scss',
})
export class VariableInputsCardComponent {
  private readonly translate = inject(TranslateService);

  readonly inputs = input.required<PayrollVariableInputs>();
  /** Pop-up: no outer card, no per-day table header spacing. */
  readonly compact = input(false);

  private locale(): string {
    return this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
  }

  money(v: number | null | undefined): string {
    if (v == null) return '—';
    const currency = this.inputs().currency;
    return new Intl.NumberFormat(this.locale(), {
      ...(currency ? { style: 'currency', currency } : {}),
      minimumFractionDigits: 2, maximumFractionDigits: 3,
    }).format(v);
  }

  num(v: number | null | undefined, digits = 2): string {
    if (v == null) return '—';
    return new Intl.NumberFormat(this.locale(), { maximumFractionDigits: digits }).format(v);
  }

  date(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(this.locale(), { day: '2-digit', month: '2-digit' });
  }

  dayName(dow: string): string {
    const idx = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].indexOf(dow);
    if (idx < 0) return dow;
    // 2024-01-01 is a Monday.
    return new Date(2024, 0, 1 + idx).toLocaleDateString(this.locale(), { weekday: 'long' });
  }

  readonly overtimeDetail = computed(() => {
    const o = this.inputs().overtime;
    return this.translate.instant('PAYROLL.VARIABLE_INPUTS.OVERTIME_DETAIL', {
      hours: this.num(o.paidHours),
      pct: o.majorationPct == null
        ? this.translate.instant('PAYROLL.VARIABLE_INPUTS.OVERTIME_NO_PCT')
        : this.num(o.majorationPct) + ' %',
      cap: this.num(o.dailyCapHours),
    });
  });

  readonly unpaidAbsences = computed(() => this.inputs().absences.items.filter(a => a.deductsSalary));
  readonly paidAbsences   = computed(() => this.inputs().absences.items.filter(a => !a.deductsSalary));

  fullDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? iso
      : d.toLocaleDateString(this.locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /** « Période de paie : du 21/10/2026 au 20/11/2026 » — absent on snapshots saved before V42. */
  readonly periodLabel = computed(() => {
    const i = this.inputs();
    if (!i.periodFrom || !i.periodTo) return null;
    return this.translate.instant('PAYROLL.VARIABLE_INPUTS.PERIOD', {
      from: this.fullDate(i.periodFrom), to: this.fullDate(i.periodTo),
    });
  });

  /** One line per balance: « Congé : 15 j au début → 13 j à la fin (2 j pris dans la période) ». */
  readonly balanceLines = computed(() => (this.inputs().balances ?? []).map(b => {
    const key = `PAYROLL.VARIABLE_INPUTS.BALANCE_${b.field}`;
    const translated = this.translate.instant(key);
    const label = translated === key ? b.field : translated;
    const text = b.atPeriodStart == null || b.atPeriodEnd == null
      ? this.translate.instant('PAYROLL.VARIABLE_INPUTS.BALANCE_NONE', { label })
      : this.translate.instant('PAYROLL.VARIABLE_INPUTS.BALANCE_LINE', {
          label, start: this.num(b.atPeriodStart), end: this.num(b.atPeriodEnd), taken: this.num(b.takenInPeriod ?? 0),
        });
    return { field: b.field, text };
  }));

  readonly nonEmployedDetail = computed(() => {
    const i = this.inputs();
    const bits = [this.translate.instant('PAYROLL.VARIABLE_INPUTS.NON_EMPLOYED_DETAIL', { days: i.nonEmployedDays })];
    const monthStart = i.periodFrom ?? `${i.periodYear}-${String(i.periodMonth).padStart(2, '0')}-01`;
    if (i.hireDate && i.hireDate > monthStart) {
      bits.push(this.translate.instant('PAYROLL.VARIABLE_INPUTS.HIRED_ON', { date: this.date(i.hireDate) }));
    }
    if (i.exitDate) bits.push(this.translate.instant('PAYROLL.VARIABLE_INPUTS.EXIT_ON', { date: this.date(i.exitDate) }));
    return bits.join(' · ');
  });

  readonly autorisationDetail = computed(() => {
    const a = this.inputs().autorisations;
    return this.translate.instant('PAYROLL.VARIABLE_INPUTS.AUTORISATIONS_DETAIL', {
      approved: a.approvedMinutes,
      quota: a.monthlyQuotaMinutes == null
        ? this.translate.instant('PAYROLL.VARIABLE_INPUTS.AUTORISATIONS_NO_QUOTA')
        : a.monthlyQuotaMinutes + ' min',
      deducted: a.deductedMinutes,
    });
  });

  readonly rates = computed(() => {
    const i = this.inputs();
    return this.translate.instant('PAYROLL.VARIABLE_INPUTS.RATES', {
      hourly: this.money(i.hourlyRate),
      hours: this.num(i.hoursPerWeek),
      daily: this.money(i.dailyRate),
      days: i.workingDaysInMonth,
      weekend: i.weekendDays.map(d => this.dayName(d)).join(', '),
    });
  });

  /** Nothing variable at all this month (only the rates line and warnings to show). */
  readonly empty = computed(() => {
    const i = this.inputs();
    return !i.overtime.days.length && !i.bonuses.length && !i.absences.items.length
      && !i.nonEmployedDays && !i.autorisations.deductedMinutes && !i.advances.length;
  });
}
