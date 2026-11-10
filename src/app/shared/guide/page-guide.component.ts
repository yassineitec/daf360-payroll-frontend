import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender,
  computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonComponent } from '@khalilrebhiitec/daf360';
import { GuideStep } from './page-guide.types';
import { PageGuideService } from './page-guide.service';
import { SpeechService } from './speech.service';

/** Space kept between the highlighted element and the spotlight's edge. */
const PAD = 8;
/** Space between the spotlight and the step card. */
const GAP = 12;
/** Minimum distance kept from every viewport edge. */
const MARGIN = 16;
/** Card width (w-80 = 20rem), narrowed on small screens. */
const CARD_WIDTH = 320;

interface Box { top: number; left: number; width: number; height: number; }

/**
 * Step-by-step guide of a page: dims the page, highlights one element per step and
 * explains it in a small card (Précédent / Suivant / Terminer, ← → Échap).
 *
 * The page marks what to highlight with `data-guide="…"` and passes the steps. The
 * guide never opens by itself: « Aide & guides » or the « Première visite ? » bubble start it through
 * `PageGuideService`, by `storageKey`, after navigating to the page.
 *
 * ```html
 * <app-page-guide storageKey="home" [steps]="guideSteps" />
 * ```
 *
 * Written against the library's conventions (portal to `<body>`, `position: fixed`,
 * rAF re-measure — same reasons as `daf-help-popover`) so it can move to
 * `@khalilrebhiitec/daf360` unchanged once it has proven itself here.
 */
@Component({
  selector: 'app-page-guide',
  standalone: true,
  imports: [TranslatePipe, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    @if (open() && step(); as s) {
      <div class="fixed inset-0 z-[9998]" (click)="close()"></div>

      @if (spot(); as b) {
        <!-- The spotlight: a transparent box whose huge shadow is the dimmed page. -->
        <div class="pointer-events-none fixed z-[9998] rounded-2xl ring-2 ring-teal transition-all duration-300"
             style="box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.55)"
             [style.top.px]="b.top" [style.left.px]="b.left"
             [style.width.px]="b.width" [style.height.px]="b.height"></div>
      } @else {
        <div class="pointer-events-none fixed inset-0 z-[9998] bg-slate-900/55"></div>
      }

      <div #card role="dialog" aria-modal="true" [attr.aria-label]="s.titleKey | translate"
           class="fixed z-[9999] flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-5 shadow-2xl transition-all duration-300"
           [style.top.px]="cardPos().top" [style.left.px]="cardPos().left" [style.width.px]="cardWidth()">
        <div class="flex items-start gap-2">
          @if (s.icon) {
            <span class="material-symbols-outlined flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-[18px] text-teal">{{ s.icon }}</span>
          }
          <h2 class="flex-1 pt-1 text-body-md font-semibold text-on-surface">{{ s.titleKey | translate }}</h2>
          <!-- Read-aloud on/off: once on, every step is read as it opens (kept per browser).
               Only when the browser has a voice for the UI language. -->
          @if (speech.available()) {
            <button type="button"
                    class="material-symbols-outlined flex h-7 w-7 items-center justify-center rounded-full text-[20px] transition-colors"
                    [class]="speech.auto() ? 'bg-teal/10 text-teal' : 'text-on-surface-variant hover:text-on-surface'"
                    [attr.aria-pressed]="speech.auto()"
                    [attr.aria-label]="(speech.auto() ? 'GUIDE.VOICE.OFF' : 'GUIDE.VOICE.ON') | translate"
                    [title]="(speech.auto() ? 'GUIDE.VOICE.OFF' : 'GUIDE.VOICE.ON') | translate"
                    (click)="toggleVoice()">{{ speech.auto() ? (speech.speaking() ? 'graphic_eq' : 'volume_up') : 'volume_off' }}</button>
          }
          <button type="button" class="material-symbols-outlined text-[20px] text-on-surface-variant hover:text-on-surface"
                  [attr.aria-label]="'GUIDE.CLOSE' | translate" (click)="close()">close</button>
        </div>

        <p class="text-body-sm text-on-surface-variant">{{ s.textKey | translate }}</p>

        @if (single()) {
          <!-- One step asked from the assistant: no counter, no Précédent / Suivant. -->
          <div class="flex items-center justify-end gap-2 pt-1">
            @if (steps().length > 1) {
              <daf-button [options]="{ variant: 'ghost', size: 'sm', label: ('GUIDE.SEE_ALL' | translate) }" (onClick)="start()" />
            }
            <daf-button [options]="{ variant: 'teal', size: 'sm', label: ('GUIDE.DONE' | translate) }" (onClick)="close()" />
          </div>
        } @else {
        <div class="flex items-center justify-between gap-2 pt-1">
          <span class="text-body-sm text-on-surface-variant">
            {{ 'GUIDE.STEP_OF' | translate:{ current: index() + 1, total: steps().length } }}
          </span>
          <div class="flex gap-2">
            @if (index() > 0) {
              <daf-button [options]="{ variant: 'ghost', size: 'sm', label: ('GUIDE.PREV' | translate) }" (onClick)="prev()" />
            }
            <daf-button
              [options]="{ variant: 'teal', size: 'sm', label: ((isLast() ? 'GUIDE.DONE' : 'GUIDE.NEXT') | translate) }"
              (onClick)="next()" />
          </div>
        </div>
        }
      </div>
    }
  `,
})
export class PageGuideComponent {
  readonly steps = input.required<GuideStep[]>();
  /** Identifies this page's guide for « Aide & guides » (`GUIDE_PAGES.guideKey`). */
  readonly storageKey = input.required<string>();
  /** A step with a `tab` opens: the page shows that tab (see `GuideStep.tab`). */
  readonly tabChange = output<string>();
  /** The guide closed (✕, Échap, « Terminer », a click on the veil): a page showing a preview for it can drop it. */
  readonly closed = output<void>();

  private readonly service = inject(PageGuideService);
  private readonly translate = inject(TranslateService);
  readonly speech = inject(SpeechService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');

  readonly open  = signal(false);
  readonly index = signal(0);
  readonly step   = computed(() => this.steps()[this.index()]);
  readonly isLast = computed(() => this.index() >= this.steps().length - 1);
  /** Showing one step only (asked from the assistant), not the whole guide. */
  readonly single = signal(false);

  /** Highlighted area, or null for a centred step. */
  readonly spot      = signal<Box | null>(null);
  readonly cardPos   = signal({ top: 0, left: 0 });
  readonly cardWidth = signal(CARD_WIDTH);

  private frame = 0;

  constructor() {
    afterNextRender(() => {
      // Out of every card's overflow/stacking context, like daf-help-popover.
      document.body.appendChild(this.host.nativeElement);
    });

    // Requested by « Aide & guides » or the bubble: this page's key → start, and consume the request.
    effect(() => {
      const req = this.service.requested();
      if (req?.key !== this.storageKey()) return;
      untracked(() => {
        this.service.requested.set(null);
        const at = req.focus
          ? this.steps().findIndex(s => s.textKey === req.focus || s.titleKey === req.focus)
          : -1;
        if (at >= 0) this.startAt(at);
        else this.start();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(this.frame);
      this.host.nativeElement.remove();
      if (this.open()) this.speech.stop();   // leaving the page mid-guide
    });
  }

  /** The whole guide, from its first step. */
  start(): void {
    if (!this.steps().length) return;
    this.single.set(false);
    this.index.set(0);
    this.open.set(true);
    this.enterStep();
    this.loop();
  }

  /** Step `index` alone, with « Voir tout le guide » / « Terminer ». */
  startAt(index: number): void {
    this.single.set(true);
    this.index.set(index);
    this.open.set(true);
    this.enterStep();
    this.loop();
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    cancelAnimationFrame(this.frame);
    this.speech.stop();
    this.closed.emit();
  }

  /** Turns read-aloud on (and reads the current step) or off (and stops). */
  toggleVoice(): void {
    const on = !this.speech.auto();
    this.speech.setAuto(on);
    if (on) this.readStep();
  }

  /** Reads the current step's title and text, when read-aloud is on. */
  private readStep(): void {
    const s = this.step();
    if (!s || !this.speech.auto() || !this.speech.available()) return;
    this.speech.speak([
      this.translate.instant(s.titleKey) as string,
      this.translate.instant(s.textKey) as string,
    ]);
  }

  next(): void {
    if (this.isLast()) { this.close(); return; }
    this.index.update(i => i + 1);
    this.enterStep();
  }

  prev(): void {
    if (this.index() === 0) return;
    this.index.update(i => i - 1);
    this.enterStep();
  }

  /**
   * Asks the page for the step's tab, then scrolls to the target once the new panel has
   * rendered (next frame) — scrolling right away would aim at the previous tab's content.
   */
  private enterStep(): void {
    const tab = this.step()?.tab;
    if (tab) this.tabChange.emit(tab);
    requestAnimationFrame(() => this.scrollToTarget());
    this.readStep();
  }

  onKey(e: KeyboardEvent): void {
    if (!this.open()) return;
    if (e.key === 'Escape') this.close();
    else if (this.single()) return;
    else if (e.key === 'ArrowRight') this.next();
    else if (e.key === 'ArrowLeft') this.prev();
  }

  /** First element of the step's target that is actually displayed at this width. */
  private target(): HTMLElement | null {
    const s = this.step();
    const query = s?.selector ?? (s?.target ? `[data-guide="${s.target}"]` : null);
    if (!query) return null;
    const all = document.querySelectorAll<HTMLElement>(query);
    return [...all].find(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }) ?? null;
  }

  private scrollToTarget(): void {
    this.target()?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Re-measures every frame while open: follows smooth scrolling, resize and the
   * page's own late layout without listening to each of them (see daf-help-popover).
   */
  private loop(): void {
    this.zone.runOutsideAngular(() => {
      const tick = () => {
        if (!this.open()) return;
        this.zone.run(() => this.place());
        this.frame = requestAnimationFrame(tick);
      };
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(tick);
    });
  }

  private place(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(CARD_WIDTH, vw - 2 * MARGIN);
    const height = this.card()?.nativeElement.offsetHeight ?? 180;
    if (width !== this.cardWidth()) this.cardWidth.set(width);

    const el = this.target();
    if (!el) {
      this.setSpot(null);
      this.setCard((vh - height) / 2, (vw - width) / 2);
      return;
    }

    const r = el.getBoundingClientRect();
    const spot: Box = {
      top: r.top - PAD, left: r.left - PAD,
      width: r.width + 2 * PAD, height: r.height + 2 * PAD,
    };
    this.setSpot(spot);

    // Below if it fits, else above, else over the element's top (tall targets).
    let top: number;
    if (spot.top + spot.height + GAP + height <= vh - MARGIN) top = spot.top + spot.height + GAP;
    else if (spot.top - GAP - height >= MARGIN) top = spot.top - GAP - height;
    else top = Math.max(MARGIN, Math.min(vh - height - MARGIN, spot.top + MARGIN));
    const left = Math.max(MARGIN, Math.min(vw - width - MARGIN, spot.left));
    this.setCard(top, left);
  }

  /** Only write when something moved, so an idle frame changes no signal. */
  private setSpot(b: Box | null): void {
    const cur = this.spot();
    const same = b && cur
      ? b.top === cur.top && b.left === cur.left && b.width === cur.width && b.height === cur.height
      : b === cur;
    if (!same) this.spot.set(b);
  }

  private setCard(top: number, left: number): void {
    const cur = this.cardPos();
    if (cur.top !== top || cur.left !== left) this.cardPos.set({ top, left });
  }
}
