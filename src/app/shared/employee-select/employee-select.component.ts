import {
  ChangeDetectionStrategy, Component, forwardRef, inject,
  Input, OnChanges, OnDestroy, signal, computed,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HrProfileService, EmployeeListItem } from '../../core/hr-profile.service';

@Component({
  selector: 'app-employee-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => EmployeeSelectComponent),
    multi: true,
  }],
  templateUrl: './employee-select.component.html',
  styleUrl: './employee-select.component.scss',
})
export class EmployeeSelectComponent implements ControlValueAccessor, OnChanges, OnDestroy {
  @Input() paysId: number | null = null;

  private readonly hrService = inject(HrProfileService);

  readonly employees   = signal<EmployeeListItem[]>([]);
  readonly query       = signal('');
  readonly open        = signal(false);
  readonly isDisabled  = signal(false);
  readonly loading     = signal(false);
  private readonly _id = signal<number | null>(null);
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private onChange: (v: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  readonly selected = computed(() =>
    this.employees().find(e => e.userId === this._id()) ?? null
  );

  readonly displayText = computed(() => {
    if (this.open()) return this.query();
    const sel = this.selected();
    if (sel) {
      return sel.employeeId ? `${sel.fullName} (${sel.employeeId})` : sel.fullName;
    }
    return '';
  });

  ngOnChanges(): void {
    // Re-fetch when paysId filter changes
    if (this.open()) this.fetch(this.query());
  }

  ngOnDestroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  writeValue(id: number | null): void {
    this._id.set(id ?? null);
    // If we have an id but no employee loaded yet, fetch to populate display name
    if (id != null && !this.employees().find(e => e.userId === id)) {
      this.fetch('');
    }
  }
  registerOnChange(fn: (v: number | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.isDisabled.set(d); }

  onFocus(): void {
    this.query.set('');
    this.open.set(true);
    this.fetch('');
  }

  onInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.query.set(val);
    this.open.set(true);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.fetch(val), 300);
  }

  onBlur(): void {
    setTimeout(() => {
      this.open.set(false);
      this.onTouched();
    }, 200);
  }

  pick(e: EmployeeListItem): void {
    this._id.set(e.userId);
    this.open.set(false);
    this.query.set('');
    this.onChange(e.userId);
    this.onTouched();
  }

  clear(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this._id.set(null);
    this.open.set(false);
    this.query.set('');
    this.onChange(null);
    this.onTouched();
  }

  private fetch(search: string): void {
    this.loading.set(true);
    this.hrService.searchEmployees(search, this.paysId).subscribe({
      next: page => {
        // Keep the currently selected employee in the list even if the new page omits it
        const current = this._id();
        const inPage = page.content.some(e => e.userId === current);
        const prev = !inPage && current != null
          ? this.employees().filter(e => e.userId === current)
          : [];
        this.employees.set([...prev, ...page.content]);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
