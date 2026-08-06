import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  PayrollApiService,
  ParameterSetDto,
  SocialChargeRateDto,
  SavePayrollRubriqueRequest,
  PayrollRubriqueDto,
} from '../../core/payroll-api.service';
import { PaysSelectComponent } from '../../shared/pays-select/pays-select.component';

@Component({
  selector: 'app-parameter-sets',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, PaysSelectComponent],
  templateUrl: './parameter-sets.component.html',
  styleUrl: './parameter-sets.component.scss',
})
export class ParameterSetsComponent {
  private readonly api = inject(PayrollApiService);
  private readonly fb  = inject(FormBuilder);

  readonly loading   = signal(false);
  readonly error     = signal<string | null>(null);
  readonly paramSets = signal<ParameterSetDto[]>([]);
  readonly selected  = signal<ParameterSetDto | null>(null);

  // ── Charges sociales editor ───────────────────────────────────────────────
  readonly editingChargesId = signal<number | null>(null);
  readonly savingCharges    = signal(false);

  readonly contractTypes   = ['CDI', 'CDD', 'STAGE', 'CIVP'];
  readonly baseCalcOptions = [
    { value: 'GROSS',        label: 'Brut' },
    { value: 'CAPPED_GROSS', label: 'Brut plafonné' },
    { value: 'FIXED',        label: 'Fixe' },
  ];

  readonly chargesForm = this.fb.group({ rates: this.fb.array([]) });
  get editRates(): FormArray { return this.chargesForm.get('rates') as FormArray; }
  editRateGroup(i: number): FormGroup { return this.editRates.at(i) as FormGroup; }

  // ── Rubriques de paie editor ──────────────────────────────────────────────
  readonly editingRubriquesId = signal<number | null>(null);
  readonly savingRubriques    = signal(false);
  readonly expandedRubriques  = signal<Set<number>>(new Set());
  readonly testGross          = signal<number>(3000);

  readonly natureOptions = [
    { value: 'AVANTAGE',  label: 'Avantage en nature', description: 'Élément de rémunération non monétaire ajouté au brut' },
    { value: 'INDEMNITE', label: 'Indemnité',           description: 'Compensation pour frais ou contraintes professionnelles' },
    { value: 'PRIME',     label: 'Prime',               description: 'Complément de salaire lié à la performance ou au poste' },
    { value: 'RETENUE',   label: 'Retenue',             description: 'Prélèvement déduit du salaire brut' },
  ];

  readonly calcModeOptions = [
    { value: 'FIXE_MENSUEL',         label: 'Montant fixe mensuel',        description: 'Un montant défini, versé chaque mois' },
    { value: 'FIXE_JOURNALIER',      label: 'Montant par jour travaillé',  description: 'Montant × nombre de jours effectivement travaillés' },
    { value: 'POURCENTAGE_BRUT',     label: 'Pourcentage du salaire brut', description: 'Taux × salaire brut total' },
    { value: 'POURCENTAGE_CHARGES',  label: 'Pourcentage des charges',     description: 'Taux × base de calcul des charges sociales' },
    { value: 'POURCENTAGE_PLAFONNE', label: 'Pourcentage plafonné',        description: 'Taux × min(salaire brut, plafond mensuel)' },
  ];

  readonly rubriquesForm = this.fb.group({ items: this.fb.array([]) });
  get editRubriques(): FormArray { return this.rubriquesForm.get('items') as FormArray; }
  editRubriqueGroup(i: number): FormGroup { return this.editRubriques.at(i) as FormGroup; }

  // ── Filter ────────────────────────────────────────────────────────────────
  readonly filterForm = this.fb.group({ paysId: [null as number | null, Validators.required] });

  // ── Data loading ──────────────────────────────────────────────────────────
  load(): void {
    const paysId = this.filterForm.get('paysId')?.value;
    if (!paysId) return;
    this.loading.set(true);
    this.error.set(null);
    this.api.listParameterSets(paysId).subscribe({
      next: ps => {
        this.paramSets.set(ps);
        this.loading.set(false);
        // Auto-select the first (usually only) parameter set so the detail
        // panel — including Rubriques — is visible without an extra click.
        if (ps.length > 0 && !this.selected()) this.selected.set(ps[0]);
      },
      error: err => { this.error.set(err?.error?.message ?? 'Erreur'); this.loading.set(false); },
    });
  }

  select(ps: ParameterSetDto): void {
    const same = this.selected()?.id === ps.id;
    this.selected.set(same ? null : ps);
    if (same) { this.closeChargesEditor(); this.closeRubriquesEditor(); }
  }

  // ── Charges sociales ──────────────────────────────────────────────────────
  openChargesEditor(ps: ParameterSetDto): void {
    if (this.editingChargesId() === ps.id) { this.closeChargesEditor(); return; }
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
    })));
    this.editingChargesId.set(ps.id);
  }

  private closeChargesEditor(): void {
    this.editingChargesId.set(null);
    while (this.editRates.length) this.editRates.removeAt(0);
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
    }));
  }

  removeEditRate(i: number): void { this.editRates.removeAt(i); }

  saveCharges(psId: number): void {
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
        this.error.set(err?.error?.message ?? 'Erreur sauvegarde charges');
        this.savingCharges.set(false);
      },
    });
  }

  // ── Rubriques de paie ──────────────────────────────────────────────────────
  openRubriquesEditor(ps: ParameterSetDto): void {
    if (this.editingRubriquesId() === ps.id) { this.closeRubriquesEditor(); return; }
    this.closeChargesEditor();
    while (this.editRubriques.length) this.editRubriques.removeAt(0);
    (ps.rubriques ?? []).forEach(r => this.editRubriques.push(this.makeRubriqueGroup(r)));
    // Auto-expand the first card so the form is immediately visible.
    this.expandedRubriques.set(new Set([0]));
    this.editingRubriquesId.set(ps.id);
  }

  private makeRubriqueGroup(r: Partial<PayrollRubriqueDto>): FormGroup {
    return this.fb.group({
      code:                     [r.code     ?? '',           Validators.required],
      labelFr:                  [r.labelFr  ?? '',           Validators.required],
      labelEn:                  [r.labelEn  ?? ''],
      nature:                   [r.nature   ?? 'AVANTAGE'],
      calcMode:                 [r.calcMode ?? 'FIXE_MENSUEL'],
      amount:                   [r.amount   ?? null],
      ratePercent:              [r.rate != null ? +(r.rate * 100).toFixed(4) : null],
      capAmount:                [r.capAmount ?? null],
      employerSharePct:         [r.employerSharePct  ?? 0],
      employeeSharePct:         [r.employeeSharePct  ?? 0],
      isSubjectToSocialCharges: [r.isSubjectToSocialCharges ?? false],
      isSubjectToIrpp:          [r.isSubjectToIrpp   ?? true],
      ctAll:                    [!r.contractTypes],
      ctCDI:                    [r.contractTypes?.includes('CDI')   ?? false],
      ctCDD:                    [r.contractTypes?.includes('CDD')   ?? false],
      ctSTAGE:                  [r.contractTypes?.includes('STAGE') ?? false],
      ctCIVP:                   [r.contractTypes?.includes('CIVP')  ?? false],
      isActive:                 [r.isActive  ?? true],
    });
  }

  private closeRubriquesEditor(): void {
    this.editingRubriquesId.set(null);
    this.expandedRubriques.set(new Set());
    while (this.editRubriques.length) this.editRubriques.removeAt(0);
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
    this.savingRubriques.set(true);
    const raw = this.rubriquesForm.getRawValue().items as any[];
    const payload: SavePayrollRubriqueRequest[] = raw.map(r => ({
      code:                     r.code,
      labelFr:                  r.labelFr,
      labelEn:                  r.labelEn?.trim() || null,
      nature:                   r.nature,
      calcMode:                 r.calcMode,
      amount:                   r.amount,
      rate:                     r.ratePercent != null ? r.ratePercent / 100 : null,
      capAmount:                r.capAmount,
      employerSharePct:         r.employerSharePct ?? 0,
      employeeSharePct:         r.employeeSharePct ?? 0,
      isSubjectToSocialCharges: r.isSubjectToSocialCharges,
      isSubjectToIrpp:          r.isSubjectToIrpp,
      direction:                r.nature === 'RETENUE' ? 'DEBIT' : 'CREDIT',
      contractTypes:            r.ctAll ? null :
        (['CDI', 'CDD', 'STAGE', 'CIVP'] as const)
          .filter((t: string) => r['ct' + t] === true)
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
        this.error.set(err?.error?.message ?? 'Erreur sauvegarde rubriques');
        this.savingRubriques.set(false);
      },
    });
  }

  // ── Workflow ───────────────────────────────────────────────────────────────
  submit(id: number): void {
    this.api.submitParameterSet(id).subscribe({
      next: updated => this.paramSets.update(ps => ps.map(p => p.id === updated.id ? updated : p)),
    });
  }

  approveHr(id: number): void {
    this.api.approveHr(id).subscribe({
      next: updated => this.paramSets.update(ps => ps.map(p => p.id === updated.id ? updated : p)),
    });
  }

  approveFinance(id: number): void {
    this.api.approveFinance(id).subscribe({
      next: updated => this.paramSets.update(ps => ps.map(p => p.id === updated.id ? updated : p)),
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  statusLabel(ps: ParameterSetDto): string {
    switch (ps.status) {
      case 'DRAFT':    return 'Brouillon';
      case 'ACTIVE':   return 'Actif';
      case 'ARCHIVED': return 'Archivé';
      case 'PENDING_FINANCE': {
        const dirOk  = ps.approvedByHr      != null;
        const dafOk  = ps.approvedByFinance != null;
        if (dirOk && !dafOk)  return 'Directeur Pays ✓ — En attente DAF';
        if (!dirOk && dafOk)  return 'DAF ✓ — En attente Directeur Pays';
        return 'Soumis — En attente d\'approbation';
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
    switch (calcMode) {
      case 'FIXE_MENSUEL':         return 'Fixe mensuel';
      case 'FIXE_JOURNALIER':      return 'Fixe/jour';
      case 'POURCENTAGE_BRUT':     return '% Brut';
      case 'POURCENTAGE_CHARGES':  return '% Charges';
      case 'POURCENTAGE_PLAFONNE': return '% Plafonné';
      default:                     return calcMode;
    }
  }

  rubriqueValue(r: { calcMode: string; amount: number | null; rate: number | null; capAmount?: number | null }, devise: string = ''): string {
    if (r.calcMode === 'FIXE_MENSUEL' || r.calcMode === 'FIXE_JOURNALIER') {
      return r.amount != null ? `${r.amount.toLocaleString('fr-FR')}${r.calcMode === 'FIXE_JOURNALIER' ? '/j' : ''}` : '—';
    }
    if (r.rate != null) {
      const pct = `${(r.rate * 100).toFixed(2)} %`;
      return (r.calcMode === 'POURCENTAGE_PLAFONNE' && r.capAmount != null)
        ? `${pct} (plaf. ${r.capAmount.toLocaleString('fr-FR')})`
        : pct;
    }
    return '—';
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
    return this.natureOptions.find(o => o.value === value)?.label ?? value;
  }

  calcModeLabel(value: string): string {
    return this.calcModeOptions.find(o => o.value === value)?.label ?? value;
  }

  previewAmount(i: number): string {
    const g = this.editRubriqueGroup(i).getRawValue();
    const gross = this.testGross();
    let amount = 0;
    switch (g['calcMode']) {
      case 'FIXE_MENSUEL':
      case 'FIXE_JOURNALIER':
        amount = g['amount'] ?? 0;
        break;
      case 'POURCENTAGE_BRUT':
      case 'POURCENTAGE_CHARGES':
        amount = gross * (g['ratePercent'] ?? 0) / 100;
        break;
      case 'POURCENTAGE_PLAFONNE': {
        const cap: number = g['capAmount'] ?? gross;
        amount = Math.min(gross, cap) * (g['ratePercent'] ?? 0) / 100;
        break;
      }
    }
    return amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
