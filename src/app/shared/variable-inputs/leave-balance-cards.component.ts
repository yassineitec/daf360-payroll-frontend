import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { SectionCardComponent, SplitValueCardComponent, type SplitValueCardItem } from '@khalilrebhiitec/daf360';
import { PayrollVariableInputs } from '../../core/payroll-engine.service';

/** Tone of each balance tile: congé in the primary colour, maladie in teal. */
const TONES: Record<string, { icon: string; iconColor: string; iconBg: string; value: string }> = {
  CONGE:   { icon: 'beach_access', iconColor: 'text-primary', iconBg: 'bg-primary/10', value: 'text-primary' },
  MALADIE: { icon: 'medical_services', iconColor: 'text-teal', iconBg: 'bg-teal/10', value: 'text-teal' },
};

/**
 * « Soldes de congés » of a payslip — congé and maladie balances at the START and at the END of
 * the pay period, as KPI tiles (`daf-split-value-card`): the end balance is the headline, the
 * start balance and the days taken in the period stand beside it.
 *
 * Shown at the top of the payslip (/payroll/engine-results/:id?result=) and of the « Calculer
 * la paie » preview, rather than at the bottom of the « Éléments variables » card where it was
 * easy to miss. The figures come from the run's snapshot (`variableInputs.balances`, V42):
 * RH keeps only the current balance, so they are rebuilt from the approved leaves — the help
 * text says so. Absent on results calculated before V42 (nothing rendered).
 */
@Component({
  selector: 'app-leave-balance-cards',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, SectionCardComponent, SplitValueCardComponent],
  template: `
    @if (tiles().length && small()) {
      <!-- Colonne de gauche du bulletin : petite carte, une ligne par solde. -->
      <daf-section-card
        [title]="'PAYROLL.VARIABLE_INPUTS.BALANCES' | translate"
        [help]="'PAYROLL.VARIABLE_INPUTS.BALANCES_HINT' | translate">
        <div class="lb-small">
          @if (periodHint()) {
            <p class="lb-small__period">{{ periodHint() }}</p>
          }
          @for (t of tiles(); track t.field) {
            <div class="lb-small__row">
              <span class="lb-small__icon" [class]="t.options.iconBg">
                <span class="material-symbols-outlined" [class]="t.options.iconColor">{{ t.options.icon }}</span>
              </span>
              <span class="lb-small__text">
                <span class="lb-small__label">{{ t.label }}</span>
                <span class="lb-small__sub">{{ t.secondary[0].label }} {{ t.secondary[0].value }} · {{ 'PAYROLL.VARIABLE_INPUTS.BALANCE_TAKEN_SHORT' | translate: { days: t.secondary[1].value } }}</span>
              </span>
              <span class="lb-small__value" [class]="t.options.primaryValueColor">{{ t.primaryValue }}</span>
            </div>
          }
        </div>
      </daf-section-card>
    } @else if (tiles().length && compact()) {
      <!-- Pop-up « Calculer la paie » : une ligne fine par solde, pas de tuiles. -->
      <div class="lb-compact" [title]="'PAYROLL.VARIABLE_INPUTS.BALANCES_HINT' | translate">
        <span class="lb-compact__title">
          <span class="material-symbols-outlined lb-compact__icon">event_available</span>
          {{ 'PAYROLL.VARIABLE_INPUTS.BALANCES' | translate }}
        </span>
        @for (t of tiles(); track t.field) {
          <span class="lb-pill">
            <span class="material-symbols-outlined lb-pill__icon" [class]="t.options.iconColor">{{ t.options.icon }}</span>
            <span class="lb-pill__label">{{ t.label }}</span>
            <span class="lb-pill__flow">{{ t.secondary[0].value }} → <strong>{{ t.primaryValue }}</strong></span>
            <span class="lb-pill__taken">({{ 'PAYROLL.VARIABLE_INPUTS.BALANCE_TAKEN_SHORT' | translate: { days: t.secondary[1].value } }})</span>
          </span>
        }
      </div>
    } @else if (tiles().length) {
      <daf-section-card
        [title]="'PAYROLL.VARIABLE_INPUTS.BALANCES' | translate"
        [hint]="periodHint()"
        [help]="'PAYROLL.VARIABLE_INPUTS.BALANCES_HINT' | translate"
        [options]="{ padding: 'md' }">
        <div class="lb-grid">
          @for (t of tiles(); track t.field) {
            <daf-split-value-card
              [primaryLabel]="t.primaryLabel"
              [primaryValue]="t.primaryValue"
              [secondaryValues]="t.secondary"
              [options]="t.options" />
          }
        </div>
      </daf-section-card>
    }
  `,
  styles: [`
    :host { display: block; }
    .lb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .lb-small { display: flex; flex-direction: column; gap: 10px; padding: 12px 20px 16px; }
    .lb-small__period { margin: 0; font-size: 0.75rem; color: var(--color-on-surface-variant); }
    .lb-small__row { display: flex; align-items: center; gap: 10px; }
    .lb-small__icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
                      border-radius: 8px; flex-shrink: 0; }
    .lb-small__icon .material-symbols-outlined { font-size: 16px; }
    .lb-small__text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .lb-small__label { font-size: 0.8125rem; font-weight: 600; color: var(--color-on-surface); }
    .lb-small__sub { font-size: 0.75rem; color: var(--color-on-surface-variant); }
    .lb-small__value { font-size: 1rem; font-weight: 800; white-space: nowrap; }
    .lb-compact { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 0.8125rem; }
    .lb-compact__title { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--color-on-surface); }
    .lb-compact__icon { font-size: 16px; color: var(--color-primary); }
    .lb-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px;
               background: var(--color-surface-container-low); border: 1px solid var(--color-outline-variant);
               color: var(--color-on-surface-variant); white-space: nowrap; }
    .lb-pill__icon { font-size: 15px; }
    .lb-pill__label { font-weight: 600; color: var(--color-on-surface); }
    .lb-pill__flow strong { color: var(--color-on-surface); }
    .lb-pill__taken { font-size: 0.75rem; }
  `],
})
export class LeaveBalanceCardsComponent {
  private readonly translate = inject(TranslateService);

  readonly inputs = input.required<PayrollVariableInputs>();
  /** Pop-up « Calculer la paie »: one slim line of pills instead of the KPI tiles. */
  readonly compact = input(false);
  /** Payslip page, left column: a small card, one line per balance (end of period in bold). */
  readonly small = input(false);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  private locale(): string {
    return this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR';
  }

  private days(v: number | null | undefined): string {
    if (v == null) return '—';
    return new Intl.NumberFormat(this.locale(), { maximumFractionDigits: 2 }).format(v) + ' ' + this.t('PAYROLL.VARIABLE_INPUTS.DAYS_UNIT');
  }

  private date(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? iso
      : d.toLocaleDateString(this.locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /** « Période de paie : du 01/11/2026 au 30/11/2026 » under the title. */
  readonly periodHint = computed(() => {
    const i = this.inputs();
    return i.periodFrom && i.periodTo
      ? this.t('PAYROLL.VARIABLE_INPUTS.PERIOD', { from: this.date(i.periodFrom), to: this.date(i.periodTo) })
      : '';
  });

  readonly tiles = computed(() => (this.inputs().balances ?? []).map(b => {
    const key = 'PAYROLL.VARIABLE_INPUTS.BALANCE_' + b.field;
    const translated = this.t(key);
    const label = translated === key ? b.field : translated;
    const tone = TONES[b.field] ?? TONES['CONGE'];
    const known = b.atPeriodStart != null && b.atPeriodEnd != null;
    const secondary: [SplitValueCardItem, SplitValueCardItem] = [
      { label: this.t('PAYROLL.VARIABLE_INPUTS.BALANCE_START'), value: known ? this.days(b.atPeriodStart) : '—' },
      { label: this.t('PAYROLL.VARIABLE_INPUTS.BALANCE_TAKEN'), value: this.days(b.takenInPeriod ?? 0) },
    ];
    return {
      field: b.field,
      label,
      primaryLabel: this.t('PAYROLL.VARIABLE_INPUTS.BALANCE_END', { label }),
      primaryValue: known ? this.days(b.atPeriodEnd) : this.t('PAYROLL.VARIABLE_INPUTS.BALANCE_NOT_SET'),
      secondary,
      options: {
        icon: tone.icon, iconColor: tone.iconColor, iconBg: tone.iconBg,
        primaryValueColor: known ? tone.value : 'text-on-surface-variant',
        card: { variant: 'outlined' as const },
      },
    };
  }));
}
