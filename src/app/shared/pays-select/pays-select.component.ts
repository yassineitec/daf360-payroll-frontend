import {
  ChangeDetectionStrategy, Component, forwardRef, inject, OnInit,
  signal, computed,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { PayrollApiService, PaysDto } from '../../core/payroll-api.service';

@Component({
  selector: 'app-pays-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => PaysSelectComponent),
    multi: true,
  }],
  templateUrl: './pays-select.component.html',
  styleUrl: './pays-select.component.scss',
})
export class PaysSelectComponent implements ControlValueAccessor, OnInit {
  private readonly api = inject(PayrollApiService);

  readonly allPays    = signal<PaysDto[]>([]);
  readonly query      = signal('');
  readonly open       = signal(false);
  readonly isDisabled = signal(false);
  private readonly _id = signal<number | null>(null);

  private onChange: (v: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  readonly selected = computed(() =>
    this.allPays().find(p => p.id === this._id()) ?? null
  );

  readonly filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.allPays();
    return this.allPays().filter(p =>
      p.frenchLabel.toLowerCase().includes(q) ||
      p.isoCode.toLowerCase().includes(q)
    );
  });

  readonly displayText = computed(() => {
    if (this.open()) return this.query();
    const sel = this.selected();
    return sel ? `${sel.frenchLabel} (${sel.isoCode})` : '';
  });

  ngOnInit(): void {
    this.api.listPays().subscribe(list => this.allPays.set(list));
  }

  writeValue(id: number | null): void { this._id.set(id ?? null); }
  registerOnChange(fn: (v: number | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.isDisabled.set(d); }

  onFocus(): void {
    this.query.set('');
    this.open.set(true);
  }

  onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.open.set(true);
  }

  onBlur(): void {
    setTimeout(() => {
      this.open.set(false);
      this.onTouched();
    }, 200);
  }

  pick(p: PaysDto): void {
    this._id.set(p.id);
    this.open.set(false);
    this.query.set('');
    this.onChange(p.id);
    this.onTouched();
  }

  clear(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this._id.set(null);
    this.open.set(false);
    this.query.set('');
    this.onChange(null);
    this.onTouched();
  }
}
