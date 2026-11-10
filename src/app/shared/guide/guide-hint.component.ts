import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonComponent } from '@khalilrebhiitec/daf360';
import { UserStore } from '../../core/user.store';
import { GuidePageDef, guidePageAt } from './guide-pages';
import { PageGuideService } from './page-guide.service';

/** Prefix of the per-page « already offered » flag in localStorage. */
const SEEN_KEY = 'pay-guide-hint-seen:';
/** Lets the page render before the bubble comes in. */
const SHOW_DELAY_MS = 1200;

/**
 * « Première visite ? » bubble: the first time the user opens a page that has a guide, a
 * small card offers to start it (« Lancer le guide ») or not (« Plus tard »). Either answer —
 * or starting that guide any other way — marks the page as offered, so the bubble shows
 * once per page and per browser (localStorage; if storage is unavailable it simply shows
 * again next visit).
 *
 * Desktop: right of the sidebar, level with its « Aide & guides » entry, its arrow pointing at it, so
 * the user also learns where the guides live. Mobile: above the assistant's and the currency bubbles.
 */
@Component({
  selector: 'app-guide-hint',
  standalone: true,
  imports: [TranslatePipe, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown(); as p) {
      <div role="dialog" aria-live="polite" [attr.aria-label]="'GUIDE.HINT.TITLE' | translate"
           class="guide-hint fixed inset-x-4 bottom-[13.5rem] z-[55] rounded-xl border border-surface-container p-4 shadow-lg
                  sm:inset-x-auto sm:bottom-4 sm:start-[16.75rem] sm:w-72"
           style="background: var(--color-surface, #fff)">
        <button type="button" (click)="later()" [attr.aria-label]="'GUIDE.HINT.LATER' | translate"
                class="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-outline hover:bg-surface-container/60 cursor-pointer">
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>

        <div class="flex items-start gap-3 pe-5">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tertiary/50 text-teal">
            <span class="material-symbols-outlined text-[20px]"
                  style="font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24">tips_and_updates</span>
          </span>
          <div class="min-w-0">
            <p class="text-[14px] font-semibold text-on-surface">{{ 'GUIDE.HINT.TITLE' | translate }}</p>
            <p class="mt-0.5 text-[13px] leading-snug text-on-surface-variant">{{ 'GUIDE.HINT.TEXT' | translate }}</p>
            <p class="mt-1 truncate text-[12px] font-medium text-teal">{{ p.labelKey | translate }}</p>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-2 gap-2">
          <daf-button [options]="{ variant: 'ghost', size: 'sm', label: ('GUIDE.HINT.LATER' | translate), fullWidth: true }"
                      (onClick)="later()" />
          <daf-button [options]="{ variant: 'teal', size: 'sm', label: ('GUIDE.HINT.START' | translate), iconStart: 'play_arrow', fullWidth: true }"
                      (onClick)="start()" />
        </div>

        <!-- Desktop: the arrow points left at « Aide & guides », where the guides live. -->
        <span class="guide-hint-arrow hidden sm:block" aria-hidden="true"></span>
      </div>
    }
  `,
  styles: [`
    .guide-hint { animation: guide-hint-in .25s ease-out; }
    @keyframes guide-hint-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .guide-hint-arrow {
      position: absolute; inset-inline-start: -7px; bottom: 18px; width: 12px; height: 12px;
      background: var(--color-surface, #fff); transform: rotate(45deg);
      border-left: 1px solid var(--color-surface-container, #e5e7eb);
      border-bottom: 1px solid var(--color-surface-container, #e5e7eb);
    }
    @media (prefers-reduced-motion: reduce) { .guide-hint { animation: none; } }
  `],
})
export class GuideHintComponent {
  private readonly router = inject(Router);
  private readonly users  = inject(UserStore);
  private readonly guide  = inject(PageGuideService);

  private readonly url = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(() => this.router.url)),
    { initialValue: this.router.url },
  );

  /** The page the user is on, when it has a guide they may run. */
  private readonly page = computed<GuidePageDef | undefined>(() => {
    const url = this.url() ?? '';
    const p = guidePageAt(url);
    return p && (p.permissions.length === 0 || p.permissions.some(c => this.users.hasPermission(c))) ? p : undefined;
  });

  /** The page whose bubble is up, once the delay has passed. */
  readonly shown = signal<GuidePageDef | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // A new page: drop the bubble, and offer this page's guide if it never was.
    effect(() => {
      const p = this.page();
      untracked(() => {
        clearTimeout(this.timer);
        this.shown.set(null);
        if (!p || this.seen(p.guideKey)) return;
        this.timer = setTimeout(() => {
          if (this.page() === p && !this.seen(p.guideKey)) this.shown.set(p);
        }, SHOW_DELAY_MS);
      });
    });

    // The guide started some other way (« Aide & guides »): offered enough.
    effect(() => {
      const key = this.guide.started()?.key;
      if (!key) return;
      untracked(() => {
        this.markSeen(key);
        if (this.shown()?.guideKey === key) this.shown.set(null);
      });
    });

    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  start(): void {
    const p = this.shown();
    if (!p) return;
    this.markSeen(p.guideKey);
    this.shown.set(null);
    this.guide.request(p.guideKey);
  }

  later(): void {
    const p = this.shown();
    if (p) this.markSeen(p.guideKey);
    this.shown.set(null);
  }

  private seen(key: string): boolean {
    try { return localStorage.getItem(SEEN_KEY + key) === '1'; } catch { return false; }
  }

  private markSeen(key: string): void {
    try { localStorage.setItem(SEEN_KEY + key, '1'); } catch { /* private mode: shown again next visit */ }
  }
}
