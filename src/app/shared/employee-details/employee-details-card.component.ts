import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  AvatarComponent, SectionCardComponent, StatusBadgeComponent, type BadgeVariant,
} from '@khalilrebhiitec/daf360';
import {
  HrProfileService, contractTypeLabel, type EmployeeListItem, type EmployeeProfileDetail,
} from '../../core/hr-profile.service';

interface DetailRow { label: string; value: string; }
interface DetailSection { id: string; title: string; rows: DetailRow[]; }

/** Codes de situation familiale de la fiche RH → clé de libellé. */
export const MARITAL_KEYS: Record<string, string> = {
  SINGLE: 'SINGLE', CELIBATAIRE: 'SINGLE',
  MARRIED: 'MARRIED', MARIE: 'MARRIED',
  DIVORCED: 'DIVORCED', DIVORCE: 'DIVORCED',
  WIDOWED: 'WIDOWED', VEUF: 'WIDOWED',
};

/**
 * Carte « Détails » d'un collaborateur — colonne gauche de `/payroll/engine-results/:id` et
 * de `/payroll/employee-config/:id` (même recette que le panneau `.dp-*` de
 * /finance/affaires/:id) : photo, matricule, statut, puis Contrat / Poste / Paie lus dans la
 * fiche RH. Une ligne sans valeur n'est pas affichée ; une section vide non plus.
 *
 * La page charge elle-même la fiche (`profile`) : elle s'en sert aussi ailleurs. Sans fiche
 * (page ouverte par lien, service RH en échec), la carte se limite aux données de la liste.
 */
@Component({
  selector: 'app-employee-details-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, AvatarComponent, SectionCardComponent, StatusBadgeComponent],
  template: `
    <daf-section-card>
      <aside class="dp-card" [attr.aria-label]="'PAYROLL.ENGINE_RESULTS.DETAILS.PANEL_ARIA' | translate">

        <!-- 1. Identité — photo, matricule, statut ; le nom est le titre de la page. -->
        <section class="dp-block dp-identity">
          <daf-avatar [data]="{ name: name(), avatarUrl: photoSrc() }" size="lg" />
          <div class="dp-identity__body">
            <div class="dp-identity__meta">
              @if (matricule(); as m) {
                <span class="dp-chip">{{ 'PAYROLL.ENGINE_RESULTS.COL_MATRICULE' | translate }} {{ m }}</span>
              }
              @if (lifecycle(); as l) {
                <daf-badge [label]="l.label" [options]="{ variant: l.variant, size: 'sm' }" />
              }
            </div>
          </div>
        </section>

        <!-- 2..4. Contrat / Poste / Paie — filet uniquement ENTRE sections. -->
        @for (s of sections(); track s.id) {
          @if (!$first) {
            <div class="dp-rule dp-rule--major"></div>
          }
          <section class="dp-block" [attr.aria-labelledby]="'dp-h-' + s.id">
            <h3 class="dp-label" [id]="'dp-h-' + s.id">{{ s.title }}</h3>
            <dl class="dp-rows">
              @for (r of s.rows; track r.label; let last = $last) {
                <div class="dp-row" [class.dp-row--last]="last">
                  <dt class="dp-row__key">{{ r.label }}</dt>
                  <dd class="dp-row__val">{{ r.value }}</dd>
                </div>
              }
            </dl>
          </section>
        }

        @if (loading()) {
          <p class="dp-hint">{{ 'PAYROLL.COMMON.LOADING' | translate }}</p>
        } @else if (!profile()) {
          <p class="dp-hint">{{ 'PAYROLL.ENGINE_RESULTS.DETAILS.PARTIAL' | translate }}</p>
        }
      </aside>
    </daf-section-card>
  `,
  styles: [`
    :host { display: block; }
    /* La surface (fond, bordure, rayon, survol) vient de daf-section-card. */
    .dp-card  { display: flex; flex-direction: column; }
    .dp-block { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; }

    .dp-identity       { flex-direction: row; align-items: center; gap: 12px; }
    .dp-identity__body { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 6px; }
    .dp-identity__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .dp-chip           { border-radius: 999px; padding: .1rem .55rem; font-size: 11px; font-weight: 600;
                         color: var(--color-on-surface-variant, #44474c);
                         background: var(--color-surface-container-highest, #e2e3e5); }

    .dp-label { margin: 0; font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
                color: var(--color-on-surface-variant, #44474c); }

    .dp-rule        { height: 1px; background: var(--color-outline-variant, #c5c6cd); opacity: .55; }
    .dp-rule--major { height: 2px; opacity: .4; }

    .dp-rows      { margin: 0; }
    .dp-row       { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 6px 0; }
    .dp-row--last { padding-bottom: 0; }
    .dp-row__key  { margin: 0; font-size: 12px; color: var(--color-on-surface-variant, #44474c); }
    .dp-row__val  { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--color-on-surface, #191c1e);
                    text-align: right; overflow-wrap: anywhere; }

    .dp-hint { margin: 0; padding: 0 16px 14px; font-size: 11px; color: var(--color-on-surface-variant, #44474c); }

    @media (max-width: 640px) { .dp-block { padding: 12px 14px; } }
  `],
})
export class EmployeeDetailsCardComponent {
  /** Nom affiché (titre de page) — repris pour l'avatar. */
  readonly name     = input.required<string>();
  /** Ligne de la liste (sessionStorage) : repli quand la fiche n'est pas chargée. */
  readonly employee = input<EmployeeListItem | null>(null);
  readonly profile  = input<EmployeeProfileDetail | null>(null);
  readonly loading  = input(false);

  private readonly hrApi     = inject(HrProfileService);
  private readonly translate = inject(TranslateService);

  private t(key: string, params?: Record<string, unknown>): string {
    this.translate.currentLang();
    return this.translate.instant(key, params);
  }

  readonly photoSrc  = computed(() => this.hrApi.photoSrc(this.profile()?.photoUrl));
  readonly matricule = computed(() => this.profile()?.matricule ?? this.employee()?.employeeId ?? null);

  readonly lifecycle = computed(() => {
    const s = this.profile()?.lifecycleStatus ?? this.employee()?.lifecycleStatus;
    if (!s) return null;
    const key = `PAYROLL.ENGINE_RESULTS.LIFECYCLE.${s}`;
    const label = this.t(key);
    const variant: BadgeVariant = s === 'ACTIVE' ? 'success'
      : (s === 'TERMINATED' || s === 'ARCHIVED') ? 'neutral' : 'warning';
    return { label: label === key ? s : label, variant };
  });

  readonly sections = computed<DetailSection[]>(() => {
    const p = this.profile();
    const e = this.employee();
    const row = (key: string, value: string | number | null | undefined): DetailRow | null =>
      value == null || value === '' ? null : { label: this.t(`PAYROLL.ENGINE_RESULTS.DETAILS.${key}`), value: String(value) };
    const section = (id: string, rows: (DetailRow | null)[]): DetailSection => ({
      id, title: this.t(`PAYROLL.ENGINE_RESULTS.DETAILS.SECTION_${id}`), rows: rows.filter((r): r is DetailRow => !!r),
    });
    const contract = p?.contractType ?? e?.contractType;

    return [
      section('CONTRACT', [
        row('CONTRACT_TYPE', contract ? contractTypeLabel(contract, this.translate) : null),
        row('HIRE_DATE', this.formatDate(p?.hireDate)),
        row('SENIORITY', this.seniority(p?.hireDate)),
        row('CONTRACT_END', this.formatDate(p?.contractEndDate)),
        row('PROBATION_END', p?.isOnProbation ? this.formatDate(p?.probationEndDate) : null),
        row('REGIME', p?.regimeLabelFr),
      ]),
      section('POSITION', [
        row('DEPARTMENT', p?.department ?? e?.department),
        row('GRADE', p?.grade),
        row('DISCIPLINE', p?.discipline),
        row('NOG_LEVEL', p?.nogLevel),
        row('PAYS', p?.paysLabel ?? e?.paysLabel),
      ]),
      section('PAYROLL', [
        row('MARITAL_STATUS', this.maritalLabel(p?.maritalStatus)),
        row('CHILDREN', p?.numberOfChildren),
        row('CNSS', p?.cnssNumber),
        row('CNSS_DATE', this.formatDate(p?.cnssAffiliationDate)),
      ]),
    ].filter(s => s.rows.length > 0);
  });

  private formatDate(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(this.translate.currentLang() === 'en' ? 'en-GB' : 'fr-FR',
      { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** « 3 ans 4 mois » depuis la date d'embauche. */
  private seniority(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const start = new Date(iso);
    if (Number.isNaN(start.getTime())) return null;
    const now = new Date();
    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (now.getDate() < start.getDate()) months--;
    if (months < 0) return null;
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const parts: string[] = [];
    if (years) parts.push(this.t('PAYROLL.ENGINE_RESULTS.DETAILS.YEARS', { count: years }));
    if (rest || !years) parts.push(this.t('PAYROLL.ENGINE_RESULTS.DETAILS.MONTHS', { count: rest }));
    return parts.join(' ');
  }

  private maritalLabel(code: string | null | undefined): string | null {
    if (!code) return null;
    const key = MARITAL_KEYS[code.toUpperCase()];
    return key ? this.t(`PAYROLL.ENGINE_RESULTS.DETAILS.MARITAL.${key}`) : code;
  }
}
