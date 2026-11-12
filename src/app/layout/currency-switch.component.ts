import {
  ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CURRENCY_GLYPHS, CurrencyService, SUPPORTED_CURRENCIES } from '../core/currency.service';

/**
 * Display-currency picker of the sidebar, desktop — the Finance module's: a « Devise  EUR ▴ »
 * row at the bottom of the rail, above « Aide & guides » (projected into `app-help-center`'s
 * footer). A click opens the list of currencies UPWARDS — the row sits at the bottom of the
 * screen.
 *
 * On mobile the rail becomes the bottom bar, which has no room for it: the shell keeps the
 * `daf-radial-menu` bubble there (hidden from 40rem up).
 *
 * The list's look is plain CSS, not Tailwind classes: payroll's styles.css is not run
 * through Tailwind (see help-center.component.ts), so only classes the shell already
 * generates — the ones daf-side-nav uses, kept on the row itself — are safe.
 *
 * `CurrencyService` stays the single writer, as with the bubble.
 */
@Component({
  selector: 'app-currency-switch',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    style: 'position: relative; display: block',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
  styles: [`
    .list {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 100%;
      z-index: 42;
      margin-bottom: 0.5rem;
      display: flex;
      flex-direction: column;
      padding: 0.25rem 0;
      border: 1px solid var(--color-surface-container, #eceef0);
      border-radius: 0.75rem;
      background: var(--color-surface, #fff);
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
    }
    .option {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      border: 0;
      background: none;
      text-align: start;
      cursor: pointer;
      color: var(--color-on-surface, #0b1c30);
      transition: background-color 0.15s;
    }
    .option:hover { background: color-mix(in srgb, var(--color-surface-container, #eceef0) 60%, transparent); }
    .option--current { color: var(--color-teal, #0d9488); font-weight: 600; }
    .glyph {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      height: 1.75rem;
      min-width: 1.75rem;
      padding: 0 0.25rem;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      background: var(--color-surface-container, #eceef0);
      color: var(--color-on-surface-variant, #3f4945);
    }
    .option--current .glyph { background: var(--color-teal, #0d9488); color: #fff; }
    .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .code { font-size: 12px; color: var(--color-outline, #6f7975); }
    .check { font-size: 18px; }
    .badge {
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      color: var(--color-teal, #0d9488);
      background: color-mix(in srgb, var(--color-teal, #0d9488) 10%, transparent);
    }
    .chevron { font-size: 18px; color: var(--color-outline, #6f7975); }
  `],
  template: `
    @if (open()) {
      <div role="listbox" class="list" [attr.aria-label]="'PAYROLL.COMMON.CURRENCY.TITLE' | translate">
        @for (c of options(); track c.code) {
          <button type="button" role="option" class="option" [class.option--current]="c.code === current()"
                  [attr.aria-selected]="c.code === current()" (click)="pick(c.code)">
            <span class="glyph">{{ c.glyph }}</span>
            <span class="name">{{ c.name }}</span>
            <span class="code">{{ c.code }}</span>
            @if (c.code === current()) {
              <span class="material-symbols-outlined check">check</span>
            }
          </button>
        }
      </div>
    }

    <!-- Same markup and classes as a top-level daf-side-nav entry, like « Aide & guides ». -->
    <button type="button" data-guide="currency-switch" [class]="itemClasses()"
            aria-haspopup="listbox" [attr.aria-expanded]="open()"
            [attr.aria-label]="('PAYROLL.COMMON.CURRENCY.TITLE' | translate) + ' : ' + (current() ?? '')"
            (click)="open.set(!open())" (mouseenter)="hovered.set(true)" (mouseleave)="hovered.set(false)">
      <span class="material-symbols-outlined shrink-0 transition-all duration-150"
            [style.font-variation-settings]="iconVariation()">currency_exchange</span>
      <span class="flex-1 text-left truncate text-label-md font-semibold">{{ 'PAYROLL.COMMON.CURRENCY.SHORT' | translate }}</span>
      @if (current()) {
        <span class="badge">{{ current() }}</span>
      }
      <span class="material-symbols-outlined chevron">{{ open() ? 'expand_more' : 'expand_less' }}</span>
    </button>
  `,
})
export class CurrencySwitchComponent {
  private readonly currencySvc = inject(CurrencyService);
  private readonly translate   = inject(TranslateService);
  private readonly host        = inject(ElementRef<HTMLElement>);

  readonly open    = signal(false);
  readonly hovered = signal(false);
  readonly current = this.currencySvc.display;

  /** `currentLang()` is read so the names re-translate on a language switch. */
  readonly options = computed(() => {
    this.translate.currentLang();
    return SUPPORTED_CURRENCIES.map(code => {
      const key = `PAYROLL.COMMON.CURRENCY.${code}`;
      const name = this.translate.instant(key) as string;
      return { code, glyph: CURRENCY_GLYPHS[code] ?? code, name: name === key ? code : name };
    });
  });

  /** daf-side-nav's `itemClasses` for a top-level entry; « active » while the list is open. */
  readonly itemClasses = computed(() => {
    const base = 'w-full flex items-center gap-3 rounded-md transition-all duration-150 cursor-pointer active:scale-95 px-3 py-3';
    if (this.open()) return `${base} bg-tertiary/50 text-teal`;
    return `${base} ${this.hovered() ? 'bg-surface-container/60 text-on-surface' : 'bg-transparent text-on-surface-variant'}`;
  });

  readonly iconVariation = computed(() =>
    `'FILL' ${this.open() || this.hovered() ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`);

  pick(code: string): void {
    this.currencySvc.setDisplay(code);
    this.open.set(false);
  }

  /** A click anywhere else closes the list. */
  onDocumentClick(e: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }
}
