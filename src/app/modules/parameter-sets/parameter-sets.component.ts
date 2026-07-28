import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  PayrollApiService,
  ParameterSetDto,
  SocialChargeRateDto,
  SavePayrollRubriqueRequest,
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

  readonly rubriqueNatures   = ['AVANTAGE', 'INDEMNITE', 'PRIME', 'RETENUE'];
  readonly rubriqueCalcModes = [
    { value: 'FIXE_MENSUEL',        label: 'Fixe mensuel' },
    { value: 'FIXE_JOURNALIER',     label: 'Fixe/jour' },
    { value: 'POURCENTAGE_BRUT',    label: '% Brut' },
    { value: 'POURCENTAGE_CHARGES', label: '% Charges' },
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
      next: ps => { this.paramSets.set(ps); this.loading.set(false); },
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
    (ps.rubriques ?? []).forEach(r => this.editRubriques.push(this.fb.group({
      code:                     [r.code,     Validators.required],
      labelFr:                  [r.labelFr,  Validators.required],
      labelEn:                  [r.labelEn ?? ''],
      nature:                   [r.nature    ?? 'AVANTAGE'],
      calcMode:                 [r.calcMode  ?? 'FIXE_MENSUEL'],
      amount:                   [r.amount    ?? null],
      rate:                     [r.rate      ?? null],
      employerSharePct:         [r.employerSharePct ?? 0],
      employeeSharePct:         [r.employeeSharePct ?? 0],
      isSubjectToSocialCharges: [r.isSubjectToSocialCharges ?? false],
      isSubjectToIrpp:          [r.isSubjectToIrpp ?? true],
      direction:                [r.direction ?? 'CREDIT'],
      contractTypes:            [r.contractTypes ?? ''],
      isActive:                 [r.isActive  ?? true],
    })));
    this.editingRubriquesId.set(ps.id);
  }

  private closeRubriquesEditor(): void {
    this.editingRubriquesId.set(null);
    while (this.editRubriques.length) this.editRubriques.removeAt(0);
  }

  addEditRubrique(): void {
    this.editRubriques.push(this.fb.group({
      code:                     ['', Validators.required],
      labelFr:                  ['', Validators.required],
      labelEn:                  [''],
      nature:                   ['AVANTAGE'],
      calcMode:                 ['FIXE_MENSUEL'],
      amount:                   [null],
      rate:                     [null],
      employerSharePct:         [0],
      employeeSharePct:         [0],
      isSubjectToSocialCharges: [false],
      isSubjectToIrpp:          [true],
      direction:                ['CREDIT'],
      contractTypes:            [''],
      isActive:                 [true],
    }));
  }

  removeEditRubrique(i: number): void { this.editRubriques.removeAt(i); }

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
      rate:                     r.rate,
      employerSharePct:         r.employerSharePct,
      employeeSharePct:         r.employeeSharePct,
      isSubjectToSocialCharges: r.isSubjectToSocialCharges,
      isSubjectToIrpp:          r.isSubjectToIrpp,
      direction:                r.direction,
      contractTypes:            r.contractTypes?.trim() || null,
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
      case 'FIXE_MENSUEL':        return 'Fixe mensuel';
      case 'FIXE_JOURNALIER':     return 'Fixe/jour';
      case 'POURCENTAGE_BRUT':    return '% Brut';
      case 'POURCENTAGE_CHARGES': return '% Charges';
      default:                    return calcMode;
    }
  }

  rubriqueValue(r: { calcMode: string; amount: number | null; rate: number | null }, devise: string = ''): string {
    if (r.calcMode === 'FIXE_MENSUEL' || r.calcMode === 'FIXE_JOURNALIER') {
      return r.amount != null ? `${r.amount.toLocaleString('fr-FR')}${r.calcMode === 'FIXE_JOURNALIER' ? '/j' : ''}` : '—';
    }
    return r.rate != null ? `${(r.rate * 100).toFixed(2)} %` : '—';
  }
}
