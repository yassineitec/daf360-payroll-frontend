# Formula Studio — Phase 2: Guided Rubrique Editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dense spreadsheet-style rubrique editor in `/parameter-sets` with a guided card-based form where Finance managers can configure payroll rubriques in plain French — no CS knowledge required.

**Architecture:** The existing `ParameterSetsComponent` is enhanced in place — no new route or component. The FormArray approach is kept but its shape changes: `rate` becomes `ratePercent` (user enters 9.18, saved as 0.0918), `direction` is removed (auto-derived from `nature`), and `contractTypes` (comma string) becomes five checkboxes. Each rubrique renders as a collapsed card; clicking it expands a guided multi-section form with radio-button selectors, conditional fields, and a live preview footer.

**Tech Stack:** Angular 18 (OnPush, signals, `@for`/`@if`), `ReactiveFormsModule`, existing raw CSS variables from `parameter-sets.component.scss`.

---

## File Map

| Action | Path |
|--------|------|
| Modify | `src/app/core/payroll-api.service.ts` — add `capAmount` to DTOs |
| Modify | `src/app/modules/parameter-sets/parameter-sets.component.ts` — form shape + helpers |
| Modify | `src/app/modules/parameter-sets/parameter-sets.component.html` — guided card UI |
| Modify | `src/app/modules/parameter-sets/parameter-sets.component.scss` — new card styles |

---

## Task 1: Add `capAmount` to Frontend DTOs

**Files:**
- Modify: `src/app/core/payroll-api.service.ts`

### Context
`PayrollRubriqueDto` (line 27) lacks `capAmount`. `SavePayrollRubriqueRequest` (line 46) also lacks it. Both need it so the new `POURCENTAGE_PLAFONNE` mode can round-trip through the API. The `calcMode` comment in `PayrollRubriqueDto` also still omits `POURCENTAGE_PLAFONNE`.

### Steps

- [ ] **Step 1: Update `PayrollRubriqueDto`**

In `PayrollRubriqueDto`, find these two lines:
```typescript
  rate: number | null;       // decimal, e.g. 0.05 = 5%
  employerSharePct: number;  // decimal, e.g. 0.60 = 60%
```
Replace them with:
```typescript
  rate: number | null;         // decimal, e.g. 0.05 = 5%
  capAmount: number | null;    // used by POURCENTAGE_PLAFONNE: min(gross, capAmount) × rate
  employerSharePct: number;    // decimal, e.g. 0.60 = 60%
```
Also update the `calcMode` comment on the same interface:
```typescript
  calcMode: string;          // FIXE_MENSUEL | FIXE_JOURNALIER | POURCENTAGE_BRUT | POURCENTAGE_CHARGES | POURCENTAGE_PLAFONNE
```

- [ ] **Step 2: Update `SavePayrollRubriqueRequest`**

In `SavePayrollRubriqueRequest`, after the `rate` field, add:
```typescript
  capAmount?: number | null;
```
Full block after the change (lines 46–61 area):
```typescript
export interface SavePayrollRubriqueRequest {
  code: string;
  labelFr: string;
  labelEn?: string | null;
  nature: string;
  calcMode: string;
  amount?: number | null;
  rate?: number | null;
  capAmount?: number | null;
  employerSharePct?: number;
  employeeSharePct?: number;
  isSubjectToSocialCharges?: boolean;
  isSubjectToIrpp?: boolean;
  direction?: string;
  contractTypes?: string | null;
  isActive?: boolean;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```
cd c:\Users\ITEC2\OneDrive\Documents\projects\daf360-payroll-frontend
npx tsc --noEmit
```
Expected: no errors related to `PayrollRubriqueDto` or `SavePayrollRubriqueRequest`.

- [ ] **Step 4: Commit**

```bash
git add src/app/core/payroll-api.service.ts
git commit -m "feat(payroll): add capAmount to PayrollRubriqueDto and SavePayrollRubriqueRequest"
```

---

## Task 2: Update Component TypeScript — Form Shape + Guided Helpers

**Files:**
- Modify: `src/app/modules/parameter-sets/parameter-sets.component.ts`

### Context
The current component (294 lines) uses a FormArray where each row has `rate` (decimal), `direction` (manual), and `contractTypes` (raw comma string). These are confusing for non-CS users. This task replaces them with:
- `ratePercent` — user enters 9.18, component divides by 100 on save
- `direction` removed from form — computed on save from `nature` (RETENUE → DEBIT, others → CREDIT)
- `contractTypes` replaced by `ctAll` + `ctCDI` + `ctCDD` + `ctSTAGE` + `ctCIVP` checkboxes
- `capAmount` added (required for POURCENTAGE_PLAFONNE)

New additions:
- `natureOptions` and `calcModeOptions` arrays with French labels + descriptions
- `expandedRubriques` signal (Set<number>) to track which cards are open
- `testGross` signal for live preview
- `previewAmount(i)` method — computes rubrique amount for a test gross
- `toggleRubriqueCard(i)` / `isRubriqueExpanded(i)` helpers
- `natureLabel(v)` / `calcModeLabel(v)` label helpers

### Steps

- [ ] **Step 1: Replace the rubrique-related properties block**

Find (lines 44–58):
```typescript
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
```

Replace with:
```typescript
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
    { value: 'FIXE_MENSUEL',         label: 'Montant fixe mensuel',       description: 'Un montant défini, versé chaque mois' },
    { value: 'FIXE_JOURNALIER',      label: 'Montant par jour travaillé', description: 'Montant × nombre de jours effectivement travaillés' },
    { value: 'POURCENTAGE_BRUT',     label: 'Pourcentage du salaire brut', description: 'Taux × salaire brut total' },
    { value: 'POURCENTAGE_CHARGES',  label: 'Pourcentage des charges',    description: 'Taux × base de calcul des charges sociales' },
    { value: 'POURCENTAGE_PLAFONNE', label: 'Pourcentage plafonné',       description: 'Taux × min(salaire brut, plafond mensuel)' },
  ];

  readonly rubriquesForm = this.fb.group({ items: this.fb.array([]) });
  get editRubriques(): FormArray { return this.rubriquesForm.get('items') as FormArray; }
  editRubriqueGroup(i: number): FormGroup { return this.editRubriques.at(i) as FormGroup; }
```

- [ ] **Step 2: Replace `openRubriquesEditor` FormGroup shape**

Find (lines 135–156):
```typescript
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
```
Replace with:
```typescript
  openRubriquesEditor(ps: ParameterSetDto): void {
    if (this.editingRubriquesId() === ps.id) { this.closeRubriquesEditor(); return; }
    this.closeChargesEditor();
    while (this.editRubriques.length) this.editRubriques.removeAt(0);
    (ps.rubriques ?? []).forEach(r => this.editRubriques.push(this.makeRubriqueGroup(r)));
    this.editingRubriquesId.set(ps.id);
  }

  private makeRubriqueGroup(r: Partial<{ code: string; labelFr: string; labelEn: string | null; nature: string; calcMode: string; amount: number | null; rate: number | null; capAmount: number | null; employerSharePct: number; employeeSharePct: number; isSubjectToSocialCharges: boolean; isSubjectToIrpp: boolean; contractTypes: string | null; isActive: boolean }>): FormGroup {
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
```

- [ ] **Step 3: Replace `closeRubriquesEditor` to reset expanded state**

Find (lines 158–161):
```typescript
  private closeRubriquesEditor(): void {
    this.editingRubriquesId.set(null);
    while (this.editRubriques.length) this.editRubriques.removeAt(0);
  }
```
Replace with:
```typescript
  private closeRubriquesEditor(): void {
    this.editingRubriquesId.set(null);
    this.expandedRubriques.set(new Set());
    while (this.editRubriques.length) this.editRubriques.removeAt(0);
  }
```

- [ ] **Step 4: Replace `addEditRubrique` to use new form shape and auto-expand**

Find (lines 163–180):
```typescript
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
```
Replace with:
```typescript
  addEditRubrique(): void {
    this.editRubriques.push(this.makeRubriqueGroup({}));
    const newIndex = this.editRubriques.length - 1;
    const s = new Set(this.expandedRubriques());
    s.add(newIndex);
    this.expandedRubriques.set(s);
  }
```

- [ ] **Step 5: Replace `saveRubriques` to convert form fields back to API fields**

Find (lines 184–215):
```typescript
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
```
Replace with:
```typescript
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
          .filter(t => r['ct' + t] === true)
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
```

**Note on the `contractTypes` mapping:** `r['ct' + t]` reads `r.ctCDI`, `r.ctCDD`, `r.ctSTAGE`, `r.ctCIVP` dynamically. The `as const` cast lets TypeScript accept it; at runtime this is plain object property access.

- [ ] **Step 6: Add card expansion helpers and live preview method**

Add these four methods to the `// ── Helpers` section (after `rubriqueValue`, before the closing `}`):

```typescript
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
```

- [ ] **Step 7: Update `formatCalcMode` and `rubriqueValue` helpers**

Find `formatCalcMode` (around line 277):
```typescript
  formatCalcMode(calcMode: string): string {
    switch (calcMode) {
      case 'FIXE_MENSUEL':        return 'Fixe mensuel';
      case 'FIXE_JOURNALIER':     return 'Fixe/jour';
      case 'POURCENTAGE_BRUT':    return '% Brut';
      case 'POURCENTAGE_CHARGES': return '% Charges';
      default:                    return calcMode;
    }
  }
```
Replace with:
```typescript
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
```

Find `rubriqueValue` (around line 287):
```typescript
  rubriqueValue(r: { calcMode: string; amount: number | null; rate: number | null }, devise: string = ''): string {
    if (r.calcMode === 'FIXE_MENSUEL' || r.calcMode === 'FIXE_JOURNALIER') {
      return r.amount != null ? `${r.amount.toLocaleString('fr-FR')}${r.calcMode === 'FIXE_JOURNALIER' ? '/j' : ''}` : '—';
    }
    return r.rate != null ? `${(r.rate * 100).toFixed(2)} %` : '—';
  }
```
Replace with:
```typescript
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
```

- [ ] **Step 8: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: zero errors in `parameter-sets.component.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/app/modules/parameter-sets/parameter-sets.component.ts
git commit -m "feat(payroll): redesign rubrique form — guided mode selector, % rate, contractType checkboxes, live preview signals"
```

---

## Task 3: Replace Rubrique Editor HTML with Guided Card UI

**Files:**
- Modify: `src/app/modules/parameter-sets/parameter-sets.component.html`

### Context
The current rubrique editor (lines 193–252) is a dense CSS-grid spreadsheet. It must be replaced with expandable card-based guided forms. The read-only table (lines 152–191) should also be updated to show French nature labels and capAmount in the value column.

There are three targeted replacements:
1. Read-only table: update Nature column and Valeur column
2. Rubrique editor toolbar: minor wording change
3. The dense grid: replace with guided card list

### Steps

- [ ] **Step 1: Update Nature column in read-only table to show French labels**

Find (around line 175):
```html
                            <td><span [class]="natureClass(r.nature)">{{ r.nature }}</span></td>
```
Replace with:
```html
                            <td><span [class]="natureClass(r.nature)">{{ natureLabel(r.nature) }}</span></td>
```

- [ ] **Step 2: Update Value column in read-only table to pass capAmount**

Find (around line 177):
```html
                            <td class="num">{{ rubriqueValue(r) }}</td>
```
Replace with:
```html
                            <td class="num">{{ rubriqueValue(r, '') }}</td>
```
(The `rubriqueValue` signature now accepts `capAmount` from the DTO directly because `r` is a `PayrollRubriqueDto` which will have `capAmount` after Task 1 — no further change needed here since the TS signature accepts `capAmount?` as optional.)

- [ ] **Step 3: Replace the entire rubrique editor block**

Find this entire block (lines 193–252):
```html
              <!-- Rubriques inline editor -->
              @if (editingRubriquesId() === ps.id) {
                <div class="rubriques-editor" [formGroup]="rubriquesForm">
                  <div class="editor-toolbar">
                    <button type="button" class="btn-sm btn-sm--secondary" (click)="addEditRubrique()">+ Ajouter une rubrique</button>
                    <button type="button" class="btn-sm btn-sm--primary" (click)="saveRubriques(ps.id)" [disabled]="savingRubriques()">
                      @if (savingRubriques()) { Enregistrement… } @else { Enregistrer }
                    </button>
                  </div>

                  @if (editRubriques.length === 0) {
                    <p class="detail-empty">Aucune rubrique — cliquez sur « Ajouter une rubrique ».</p>
                  } @else {
                    <div class="rubriques-wrap">
                      <div class="rubrique-head">
                        <span>Code</span>
                        <span>Libellé FR</span>
                        <span>Nature</span>
                        <span>Mode</span>
                        <span>Montant</span>
                        <span>Taux (déc.)</span>
                        <span>Direction</span>
                        <span title="Soumis à l'IRPP">IRPP</span>
                        <span title="Soumis aux charges sociales">CS</span>
                        <span title="Laisser vide = tous les types">Contrats</span>
                        <span>Actif</span>
                        <span></span>
                      </div>
                      <ng-container formArrayName="items">
                        @for (ctrl of editRubriques.controls; track $index; let i = $index) {
                          <div class="rubrique-row" [formGroupName]="i">
                            <input class="ri" formControlName="code" placeholder="TICKETS_RESTO" style="text-transform:uppercase" />
                            <input class="ri" formControlName="labelFr" placeholder="Tickets restaurant Pluxee" />
                            <select class="ri" formControlName="nature">
                              @for (n of rubriqueNatures; track n) { <option [value]="n">{{ n }}</option> }
                            </select>
                            <select class="ri" formControlName="calcMode">
                              @for (m of rubriqueCalcModes; track m.value) { <option [value]="m.value">{{ m.label }}</option> }
                            </select>
                            <input class="ri" type="number" step="0.01" formControlName="amount" placeholder="—" />
                            <input class="ri" type="number" step="0.0001" formControlName="rate" placeholder="0.0500" />
                            <select class="ri" formControlName="direction">
                              <option value="CREDIT">CREDIT</option>
                              <option value="DEBIT">DEBIT</option>
                            </select>
                            <div class="ri-check"><input type="checkbox" formControlName="isSubjectToIrpp" /></div>
                            <div class="ri-check"><input type="checkbox" formControlName="isSubjectToSocialCharges" /></div>
                            <input class="ri" formControlName="contractTypes" placeholder="CDI,CDD" />
                            <div class="ri-check"><input type="checkbox" formControlName="isActive" /></div>
                            <button type="button" class="btn-remove" title="Supprimer" (click)="removeEditRubrique(i)">✕</button>
                          </div>
                        }
                      </ng-container>
                    </div>
                    <p class="editor-hint">
                      Taux : valeur décimale (ex. 0.05 = 5%). Montant : en devise locale. Contrats vide = applicable à tous les types.
                    </p>
                  }
                </div>
              }
```

Replace with the following guided card editor:
```html
              <!-- Rubriques guided card editor -->
              @if (editingRubriquesId() === ps.id) {
                <div class="rubriques-editor" [formGroup]="rubriquesForm">
                  <div class="editor-toolbar">
                    <button type="button" class="btn-sm btn-sm--secondary" (click)="addEditRubrique()">+ Ajouter une rubrique</button>
                    <button type="button" class="btn-sm btn-sm--primary" (click)="saveRubriques(ps.id)" [disabled]="savingRubriques()">
                      @if (savingRubriques()) { Enregistrement… } @else { Enregistrer tout }
                    </button>
                  </div>

                  @if (editRubriques.length === 0) {
                    <p class="detail-empty">Aucune rubrique — cliquez sur « Ajouter une rubrique ».</p>
                  } @else {
                    <!-- Test gross control shown above card list -->
                    <div class="preview-control">
                      <span class="field-label">Salaire brut de test :</span>
                      <input type="number" class="ri preview-gross-input"
                             [value]="testGross()"
                             (input)="testGross.set(+$any($event.target).value || 3000)"
                             min="1" step="100" />
                      <span class="preview-gross-unit">TND / mois</span>
                    </div>

                    <ng-container formArrayName="items">
                      @for (ctrl of editRubriques.controls; track $index; let i = $index) {
                        <div class="rubrique-card" [class.rubrique-card--expanded]="isRubriqueExpanded(i)" [formGroupName]="i">

                          <!-- ── Card header (always visible, click to expand) ── -->
                          <div class="rubrique-card-header" (click)="toggleRubriqueCard(i)">
                            <div class="rch-left">
                              <span class="rch-arrow">{{ isRubriqueExpanded(i) ? '▼' : '▶' }}</span>
                              <code class="code-pill">{{ editRubriqueGroup(i).get('code')!.value || '…' }}</code>
                              <span class="rch-label">{{ editRubriqueGroup(i).get('labelFr')!.value || 'Nouvelle rubrique' }}</span>
                              <span [class]="natureClass(editRubriqueGroup(i).get('nature')!.value)" class="rch-badge">
                                {{ natureLabel(editRubriqueGroup(i).get('nature')!.value) }}
                              </span>
                              <span class="rch-mode">{{ calcModeLabel(editRubriqueGroup(i).get('calcMode')!.value) }}</span>
                            </div>
                            <div class="rch-right">
                              <span class="rch-value">{{ previewAmount(i) }} TND</span>
                              <button type="button" class="btn-remove" title="Supprimer cette rubrique"
                                      (click)="$event.stopPropagation(); removeEditRubrique(i)">✕</button>
                            </div>
                          </div>

                          <!-- ── Card body (shown when expanded) ── -->
                          @if (isRubriqueExpanded(i)) {
                            <div class="rubrique-card-body">

                              <!-- Section: Identification -->
                              <div class="rg-section">
                                <h4 class="rg-section-title">Identification</h4>
                                <div class="rg-row">
                                  <div class="rg-field rg-field--sm">
                                    <label class="field-label">Code interne *</label>
                                    <input class="field-input" formControlName="code"
                                           placeholder="CNSS_SAL" style="text-transform:uppercase" />
                                  </div>
                                  <div class="rg-field rg-field--lg">
                                    <label class="field-label">Libellé (français) *</label>
                                    <input class="field-input" formControlName="labelFr"
                                           placeholder="ex : Cotisation CNSS salariale" />
                                  </div>
                                  <div class="rg-field rg-field--lg">
                                    <label class="field-label">Libellé (anglais)</label>
                                    <input class="field-input" formControlName="labelEn"
                                           placeholder="ex : CNSS employee contribution" />
                                  </div>
                                </div>
                              </div>

                              <!-- Section: Nature -->
                              <div class="rg-section">
                                <h4 class="rg-section-title">Nature de la rubrique</h4>
                                <div class="rg-radio-group">
                                  @for (opt of natureOptions; track opt.value) {
                                    <label class="rg-radio-card"
                                           [class.rg-radio-card--selected]="editRubriqueGroup(i).get('nature')!.value === opt.value">
                                      <input type="radio" formControlName="nature" [value]="opt.value" />
                                      <span class="rg-radio-title">{{ opt.label }}</span>
                                      <span class="rg-radio-desc">{{ opt.description }}</span>
                                    </label>
                                  }
                                </div>
                              </div>

                              <!-- Section: Calcul -->
                              <div class="rg-section">
                                <h4 class="rg-section-title">Comment est-elle calculée ?</h4>
                                <div class="rg-radio-group">
                                  @for (opt of calcModeOptions; track opt.value) {
                                    <label class="rg-radio-card"
                                           [class.rg-radio-card--selected]="editRubriqueGroup(i).get('calcMode')!.value === opt.value">
                                      <input type="radio" formControlName="calcMode" [value]="opt.value" />
                                      <span class="rg-radio-title">{{ opt.label }}</span>
                                      <span class="rg-radio-desc">{{ opt.description }}</span>
                                    </label>
                                  }
                                </div>

                                <!-- Conditional: FIXE modes show Amount -->
                                @if (editRubriqueGroup(i).get('calcMode')!.value === 'FIXE_MENSUEL' ||
                                     editRubriqueGroup(i).get('calcMode')!.value === 'FIXE_JOURNALIER') {
                                  <div class="rg-row rg-row--mt">
                                    <div class="rg-field rg-field--md">
                                      <label class="field-label">
                                        Montant ({{ editRubriqueGroup(i).get('calcMode')!.value === 'FIXE_JOURNALIER' ? 'par jour' : 'par mois' }})
                                      </label>
                                      <input class="field-input" type="number" step="0.01" formControlName="amount" placeholder="0.00" />
                                    </div>
                                  </div>
                                }

                                <!-- Conditional: POURCENTAGE modes show Rate (and optionally Cap) -->
                                @if (editRubriqueGroup(i).get('calcMode')!.value === 'POURCENTAGE_BRUT' ||
                                     editRubriqueGroup(i).get('calcMode')!.value === 'POURCENTAGE_CHARGES' ||
                                     editRubriqueGroup(i).get('calcMode')!.value === 'POURCENTAGE_PLAFONNE') {
                                  <div class="rg-row rg-row--mt">
                                    <div class="rg-field rg-field--sm">
                                      <label class="field-label">Taux (%)</label>
                                      <input class="field-input" type="number" step="0.01"
                                             formControlName="ratePercent" placeholder="9.18" />
                                    </div>
                                    @if (editRubriqueGroup(i).get('calcMode')!.value === 'POURCENTAGE_PLAFONNE') {
                                      <div class="rg-field rg-field--md">
                                        <label class="field-label">Plafond mensuel</label>
                                        <input class="field-input" type="number" step="0.01"
                                               formControlName="capAmount" placeholder="3 500.00" />
                                      </div>
                                    }
                                  </div>
                                }
                              </div>

                              <!-- Section: Fiscalité -->
                              <div class="rg-section">
                                <h4 class="rg-section-title">Fiscalité &amp; charges sociales</h4>
                                <div class="rg-checkbox-group">
                                  <label class="rg-checkbox-item">
                                    <input type="checkbox" formControlName="isSubjectToIrpp" />
                                    <span>
                                      <strong>Soumis à l'IRPP</strong>
                                      <small>Cette rubrique est intégrée dans le calcul de l'impôt sur le revenu</small>
                                    </span>
                                  </label>
                                  <label class="rg-checkbox-item">
                                    <input type="checkbox" formControlName="isSubjectToSocialCharges" />
                                    <span>
                                      <strong>Élargit l'assiette des charges sociales</strong>
                                      <small>Cette rubrique s'ajoute à la base de calcul des cotisations sociales</small>
                                    </span>
                                  </label>
                                </div>
                              </div>

                              <!-- Section: Contrats -->
                              <div class="rg-section">
                                <h4 class="rg-section-title">Types de contrat applicables</h4>
                                <div class="rg-checkbox-group">
                                  <label class="rg-checkbox-item">
                                    <input type="checkbox" formControlName="ctAll" />
                                    <span>
                                      <strong>Tous les types de contrat</strong>
                                      <small>CDI, CDD, Stage, CIVP — aucune restriction</small>
                                    </span>
                                  </label>
                                  @if (!editRubriqueGroup(i).get('ctAll')!.value) {
                                    <div class="rg-contract-types">
                                      <label class="rg-tag-check"><input type="checkbox" formControlName="ctCDI" /> CDI</label>
                                      <label class="rg-tag-check"><input type="checkbox" formControlName="ctCDD" /> CDD</label>
                                      <label class="rg-tag-check"><input type="checkbox" formControlName="ctSTAGE" /> Stage</label>
                                      <label class="rg-tag-check"><input type="checkbox" formControlName="ctCIVP" /> CIVP</label>
                                    </div>
                                  }
                                </div>
                              </div>

                              <!-- Section: Statut -->
                              <div class="rg-section">
                                <h4 class="rg-section-title">Statut</h4>
                                <label class="rg-checkbox-item">
                                  <input type="checkbox" formControlName="isActive" />
                                  <span>
                                    <strong>Rubrique active</strong>
                                    <small>Décocher pour désactiver sans supprimer</small>
                                  </span>
                                </label>
                              </div>

                              <!-- Live preview footer -->
                              <div class="rg-preview-section">
                                <span class="rg-preview-label">
                                  Aperçu — pour un salaire brut de {{ testGross().toLocaleString('fr-FR') }} TND
                                </span>
                                <span class="rg-preview-amount">{{ previewAmount(i) }} TND</span>
                              </div>

                            </div>
                          }
                        </div>
                      }
                    </ng-container>
                  }
                </div>
              }
```

- [ ] **Step 4: Verify HTML template compiles**

```
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/modules/parameter-sets/parameter-sets.component.html
git commit -m "feat(payroll): replace rubrique grid editor with guided card form"
```

---

## Task 4: Add CSS for Guided Rubrique Cards

**Files:**
- Modify: `src/app/modules/parameter-sets/parameter-sets.component.scss`

### Context
The current SCSS (73 lines) ends with nature/direction badge modifiers. Append new classes after line 73. The dense grid classes (`.rubrique-head`, `.rubrique-row`) are no longer used in the template — they can remain or be removed. To minimise churn, leave them in place and just append new classes.

### Steps

- [ ] **Step 1: Append the guided card styles**

Add at the end of `parameter-sets.component.scss` (after the last closing `}`):

```scss
/* ── Test-gross preview control ─────────────────────────────────────────── */
.preview-control {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 12px;
  .preview-gross-input { width: 110px; height: 32px; }
  .preview-gross-unit { font-size: 0.8125rem; color: var(--color-on-surface-variant); }
}

/* ── Guided rubrique card ────────────────────────────────────────────────── */
.rubrique-card {
  border: 1px solid var(--color-outline-variant);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
  background: var(--color-surface);
  overflow: hidden;
  transition: border-color 0.15s;
  &--expanded { border-color: var(--color-primary); }
}

.rubrique-card-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; cursor: pointer; gap: 12px;
  user-select: none;
  &:hover { background: var(--color-surface-container-low); }
}

.rch-left {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: 1; min-width: 0;
}
.rch-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.rch-arrow { font-size: 0.6875rem; color: var(--color-on-surface-variant); width: 14px; }
.rch-label { font-size: 0.9375rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }
.rch-badge { flex-shrink: 0; }
.rch-mode { font-size: 0.75rem; color: var(--color-on-surface-variant); white-space: nowrap; }
.rch-value { font-size: 0.875rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--color-primary); white-space: nowrap; }

/* ── Card body ───────────────────────────────────────────────────────────── */
.rubrique-card-body {
  padding: 0 20px 20px;
  border-top: 1px solid var(--color-outline-variant);
}

/* ── Form sections ───────────────────────────────────────────────────────── */
.rg-section {
  margin-top: 20px;
  &-title {
    font-size: 0.8125rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--color-on-surface-variant);
    margin: 0 0 12px;
  }
}

.rg-row {
  display: flex; gap: 16px; flex-wrap: wrap;
  &--mt { margin-top: 12px; }
}

.rg-field {
  display: flex; flex-direction: column; gap: 6px;
  &--sm  { flex: 0 0 140px; }
  &--md  { flex: 0 0 200px; }
  &--lg  { flex: 1 1 240px; min-width: 180px; max-width: 360px; }
}

/* ── Radio cards ─────────────────────────────────────────────────────────── */
.rg-radio-group {
  display: flex; flex-wrap: wrap; gap: 10px;
}

.rg-radio-card {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 14px; min-width: 160px; flex: 1 1 160px; max-width: 220px;
  border: 1px solid var(--color-outline-variant);
  border-radius: var(--radius-md); cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  input[type="radio"] { display: none; }
  &--selected {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  }
  &:hover:not(.rg-radio-card--selected) {
    background: var(--color-surface-container-low);
  }
}

.rg-radio-title {
  font-size: 0.875rem; font-weight: 600; line-height: 1.3;
}

.rg-radio-desc {
  font-size: 0.75rem; color: var(--color-on-surface-variant); line-height: 1.4;
}

/* ── Checkbox groups ─────────────────────────────────────────────────────── */
.rg-checkbox-group {
  display: flex; flex-direction: column; gap: 8px;
}

.rg-checkbox-item {
  display: flex; align-items: flex-start; gap: 10px; cursor: pointer;
  input[type="checkbox"] { margin-top: 3px; flex-shrink: 0; }
  strong { display: block; font-size: 0.875rem; font-weight: 600; }
  small { display: block; font-size: 0.75rem; color: var(--color-on-surface-variant); margin-top: 1px; }
}

.rg-contract-types {
  display: flex; gap: 10px; flex-wrap: wrap; margin-left: 24px; margin-top: 8px;
}

.rg-tag-check {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  padding: 4px 12px; border: 1px solid var(--color-outline-variant);
  border-radius: 999px; font-size: 0.8125rem; font-weight: 600;
  input[type="checkbox"] { display: none; }
  &:has(input:checked) {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
  }
}

/* ── Live preview ────────────────────────────────────────────────────────── */
.rg-preview-section {
  margin-top: 20px; padding: 14px 16px;
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-radius: var(--radius-md);
  display: flex; justify-content: space-between; align-items: center; gap: 16px;
}

.rg-preview-label {
  font-size: 0.8125rem; color: var(--color-on-surface-variant);
}

.rg-preview-amount {
  font-size: 1.25rem; font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--color-primary);
}
```

- [ ] **Step 2: Verify no style regressions**

The old `.rubrique-head` and `.rubrique-row` classes are still in the SCSS but no longer in the template. That's fine — unused CSS doesn't cause errors.

Run:
```
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/modules/parameter-sets/parameter-sets.component.scss
git commit -m "feat(payroll): add guided rubrique card styles — radio cards, preview, contract tags"
```

---

## Task 5: Start Dev Server and Validate End-to-End

**Files:** (none — runtime validation only)

### Context
The guided card editor is complete. This task verifies the full flow works: load a parameter set, open the rubrique editor, expand a card, change calc mode to `POURCENTAGE_PLAFONNE`, fill in rate + cap, observe live preview, and save. Angular's template compiler will also catch any remaining binding errors at dev-server start.

### Steps

- [ ] **Step 1: Start the dev server**

```bash
cd c:\Users\ITEC2\OneDrive\Documents\projects\daf360-payroll-frontend
npm start
```
Expected: compiles without errors, serves at `http://localhost:4205`.

- [ ] **Step 2: Navigate to `/parameter-sets`**

Select a country, click "Charger", expand a parameter set that has rubriques, click "Modifier" on the Rubriques section.

Expected:
- Preview gross input appears above the card list
- Each rubrique is shown as a collapsed card with: code pill, French label, nature badge (French), mode label, and preview amount
- No spreadsheet grid

- [ ] **Step 3: Expand a card and verify guided form sections**

Click a rubrique card to expand it.

Expected:
- Section "Identification": code, labelFr, labelEn inputs
- Section "Nature de la rubrique": four radio cards in French
- Section "Comment est-elle calculée ?": five radio cards with descriptions
- For a POURCENTAGE mode: Taux (%) input visible; for FIXE: Montant input visible
- Section "Fiscalité & charges sociales": two checkboxes with descriptions
- Section "Types de contrat applicables": "Tous les types" checkbox; unchecking reveals CDI/CDD/STAGE/CIVP tags
- Section "Statut": isActive checkbox
- Live preview footer: "Aperçu — pour un salaire brut de 3 000 TND → X,XX TND"

- [ ] **Step 4: Test `POURCENTAGE_PLAFONNE` mode**

Select a rubrique (or add a new one), choose "Pourcentage plafonné".

Expected:
- Only "Taux (%)" and "Plafond mensuel" inputs appear (no Montant)
- Change taux to 9.18, plafond to 3500, test gross = 3200 → preview = 294.18 (= 3200 × 0.0918)
- Change test gross to 4000 → preview = 321.30 (= 3500 × 0.0918, capped)

- [ ] **Step 5: Test save round-trip**

Save the parameter set. Reload the page. Open the same parameter set's rubrique editor and expand the same card.

Expected:
- `ratePercent` field shows the same % (not the decimal)
- `capAmount` field is preserved
- `contractTypes` checkboxes reflect saved state

- [ ] **Step 6: Verify read-only table**

Close the editor (click "Annuler"). Check the read-only rubriques table.

Expected:
- Nature column shows French labels ("Retenue", "Prime", etc.) not English constants
- `POURCENTAGE_PLAFONNE` rubriques show value like `9.18 % (plaf. 3 500)` in Valeur column

- [ ] **Step 7: Final commit**

If any minor fixes were needed during testing, commit them:
```bash
git add -p
git commit -m "fix(payroll): guided rubrique editor runtime fixes"
```

---

## Self-Review

### Spec Coverage Checklist

| Requirement | Covered by |
|-------------|-----------|
| `capAmount` round-trips through frontend | Task 1 (DTOs) + Task 2 (form `makeRubriqueGroup` + save) |
| `POURCENTAGE_PLAFONNE` in calc mode selector | Task 2 (`calcModeOptions` array) + Task 3 (radio cards) |
| Conditional fields per calc mode | Task 3 (`@if` blocks in calc section) |
| Rate entered as % (9.18 not 0.0918) | Task 2 (`ratePercent` field + `/100` on save) |
| Direction auto-derived from nature | Task 2 (`saveRubriques` `direction` computation) |
| contractTypes as checkboxes | Task 2 (`ctAll/ctCDI/ctCDD/ctSTAGE/ctCIVP`) + Task 3 |
| French labels for nature | Task 2 (`natureOptions`) + Task 2 (`natureLabel()`) + Task 3 |
| French labels for calc modes | Task 2 (`calcModeOptions`) + Task 2 (`calcModeLabel()`) + Task 3 |
| Live preview per card | Task 2 (`previewAmount()`, `testGross` signal) + Task 3 |
| Editable test gross salary | Task 3 (`.preview-control` block) |
| Card expand/collapse | Task 2 (`toggleRubriqueCard`, `expandedRubriques`) + Task 3 |
| New rubriques auto-expand | Task 2 (`addEditRubrique` sets expanded) |
| Read-only table French labels | Task 3 Step 1 |
| Read-only table capAmount display | Task 3 Step 2 + Task 2 (`rubriqueValue` update) |

### Type Consistency Check

- `makeRubriqueGroup` uses `ratePercent` (not `rate`) throughout ✓
- `saveRubriques` reads `r.ratePercent` and converts `/100` → `rate` in payload ✓
- `previewAmount` reads `g['ratePercent']` (not `g['rate']`) ✓
- `previewAmount` reads `g['capAmount']` ✓
- `SavePayrollRubriqueRequest` has `capAmount?: number | null` after Task 1 ✓
- `PayrollRubriqueDto` has `capAmount: number | null` after Task 1, so `rubriqueValue(r)` can access `r.capAmount` ✓

### Placeholder Scan

No TBDs, no "implement later", all code blocks are complete.
