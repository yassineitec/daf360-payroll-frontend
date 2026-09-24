import {
  ChangeDetectionStrategy, Component, ElementRef, EventEmitter, forwardRef, inject,
  Input, OnChanges, OnDestroy, Output, signal, computed, effect, viewChild,
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
  // No styleUrl: the chrome is now Tailwind utilities shared with `daf-select`.
  templateUrl: './employee-select.component.html',
})
export class EmployeeSelectComponent implements ControlValueAccessor, OnChanges, OnDestroy {
  @Input() paysId: number | null = null;

  /** Full picked record, for a consumer that wants more than the id (e.g. a summary
   *  card). Fires on pick/clear, and once more if a programmatically-set id (`writeValue`,
   *  used when loading a preset) resolves against a freshly-fetched page. */
  @Output() employeeSelected = new EventEmitter<EmployeeListItem | null>();

  private readonly hrService = inject(HrProfileService);

  readonly employees   = signal<EmployeeListItem[]>([]);
  readonly query       = signal('');
  readonly open        = signal(false);
  readonly isDisabled  = signal(false);
  readonly loading     = signal(false);
  private readonly _id = signal<number | null>(null);
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Portal + positioning ─────────────────────────────────────────────
  // `daf-card` always sets `overflow-hidden` on its wrapper, so a panel kept
  // `absolute` inside one gets clipped at the card's edge — the same trap
  // `daf-select` in the shared library works around by re-parenting its panel
  // to <body> and positioning it `fixed` from the trigger's rect. Mirror that
  // here rather than nesting this control inside anything with clipped overflow.
  private readonly triggerRef = viewChild<ElementRef<HTMLElement>>('trigger');
  private readonly panelRef   = viewChild<ElementRef<HTMLElement>>('panel');
  private portaledNode: HTMLElement | null = null;

  readonly dropdownTop   = signal(0);
  readonly dropdownLeft  = signal(0);
  readonly dropdownWidth = signal(0);

  private readonly portalDropdown = effect((onCleanup) => {
    if (!this.open()) return;
    const ref = this.panelRef();
    if (!ref) return;
    const node = ref.nativeElement;
    if (node.parentElement !== document.body) {
      document.body.appendChild(node);
      this.portaledNode = node;
    }
    this.updatePosition();

    const reposition = () => this.updatePosition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    onCleanup(() => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      node.remove();
      if (this.portaledNode === node) this.portaledNode = null;
    });
  });

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
    this.portaledNode?.remove();
    this.portaledNode = null;
  }

  private updatePosition(): void {
    const trigger = this.triggerRef()?.nativeElement;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const panelH = this.panelRef()?.nativeElement.offsetHeight || 256;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < panelH + gap && rect.top > spaceBelow;
    this.dropdownTop.set(flipUp ? Math.max(8, rect.top - gap - panelH) : rect.bottom + gap);
    this.dropdownLeft.set(rect.left);
    this.dropdownWidth.set(rect.width);
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
    this.employeeSelected.emit(e);
  }

  clear(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this._id.set(null);
    this.open.set(false);
    this.query.set('');
    this.onChange(null);
    this.onTouched();
    this.employeeSelected.emit(null);
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
        // A programmatically-set id (writeValue, e.g. loading a preset) has no picked
        // record to emit until its page resolves — do it here, once.
        if (current != null) {
          const resolved = this.employees().find(e => e.userId === current);
          if (resolved) this.employeeSelected.emit(resolved);
        }
      },
      error: () => this.loading.set(false),
    });
  }
}
