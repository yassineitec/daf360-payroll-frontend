import {
  ChangeDetectionStrategy, Component, TemplateRef, computed, inject, signal, viewChild,
} from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ModalRef, ModalService } from '@khalilrebhiitec/daf360';
import { GUIDE_PAGES, guidePageAt, helpTabOf } from './guide-pages';
import { HELP_CONTENT, HelpVideo } from './help-content';
import { HelpChatService } from './help-chat.service';
import { PageGuideService } from './page-guide.service';
import { SpeechService, StopSpeechOnDestroyDirective } from './speech.service';

/** Route of the help page, relative to the payroll shell. */
const HELP_ROUTE = 'aide';

/** One big card of the « Aide & guides » window. */
interface HelpChoice {
  id: 'guide' | 'videos' | 'chat';
  icon: string;
  /** Tailwind classes of the icon badge. */
  tone: string;
  labelKey: string;
  hintKey: string;
  count?: number;
}

/**
 * « Aide & guides » entry, pinned to the bottom of the sidebar rail — the same entry as in
 * the RH module. A click opens a window (library modal) of big cards about the page the
 * user is on: start its guide right here, play its videos, ask the assistant
 * (`app-help-chat`) — then « Tout le centre d'aide » for the help page (/finance/aide,
 * `modules/help`), which holds the FAQ and the documentation. A card with nothing behind
 * it is left out.
 *
 * Projected into `daf-side-nav`'s footer slot (`dafSideNavFooter`, lib 5.13.0), under the
 * item list: the list scrolls above it, nothing passes under it. Desktop only — the rail turns into the mobile
 * bottom bar below `sm`; there the « Première visite ? » bubble is the way in.
 *
 * The footer takes other rail entries through `<ng-content>`, shown above this one: the
 * shell puts its display-currency switch there (`app-currency-switch`).
 */
@Component({
  selector: 'app-help-center',
  standalone: true,
  imports: [TranslatePipe, StopSpeechOnDestroyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The card being read aloud stands out (same look as hovering it).
  // The footer's geometry is plain CSS here, not Tailwind classes: payroll's styles.css is
  // not run through Tailwind (no postcss.config.json), so an arbitrary class such as
  // `z-[41]` or `sm:block` only exists if the shell happens to generate it — it didn't, and
  // the entry stayed hidden. Shown from 40rem up, like the daf-side-nav rail it sits in.
  styles: [`
    .help-footer { display: none; }
    @media (min-width: 40rem) { .help-footer { display: block; } }
    .help-footer__list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding-top: 1rem;
      border-top: 1px solid var(--color-surface-container, #eceef0);
    }
    .reading {
      border-color: var(--color-teal, #0d9488);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-teal, #0d9488) 25%, transparent);
      transform: translateY(-2px);
    }
  `],
  // Same markup and classes as a top-level `daf-side-nav` entry and the same divider as a
  // `divider: true` entry, so it reads as one more item of the rail, pinned to its bottom.
  template: `
    <div class="help-footer">
      <div class="help-footer__list">
        <!-- Other footer entries of the rail, above this one (the shell's currency switch). -->
        <ng-content />
        <button type="button" data-guide="help-center" [class]="itemClasses()"
                [attr.aria-current]="active() ? 'page' : null" [attr.aria-haspopup]="'dialog'"
                (click)="openChooser()" (mouseenter)="hovered.set(true)" (mouseleave)="hovered.set(false)">
          <span class="material-symbols-outlined shrink-0 transition-all duration-150"
                [style.font-variation-settings]="iconVariation()">help</span>
          <span class="flex-1 text-left truncate text-label-md font-semibold">
            {{ 'GUIDE.HELP_CENTER' | translate }}
          </span>
        </button>
      </div>
    </div>

    <!-- The player: a large modal of its own (maximizable). -->
    <ng-template #videoTpl>
      @if (playing(); as v) {
        <video class="block max-h-[75vh] w-full rounded-xl bg-black" controls autoplay playsinline
               [src]="v.url">
        </video>
      }
    </ng-template>

    <!-- Body of the window: one big card per choice. With several videos, « Vidéos » swaps
         the cards for the list to pick one from. -->
    <ng-template #chooserTpl>
      @if (pickingVideo()) {
        <div class="flex flex-col gap-3 pt-1">
          @for (v of videos(); track v.titleKey) {
            <button type="button" (click)="play(v)"
                    class="flex items-center gap-4 rounded-xl border border-surface-container p-4 text-left transition-all duration-150 hover:border-teal hover:shadow-md cursor-pointer"
                    style="background: var(--color-surface, #fff)">
              <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
                <span class="material-symbols-outlined text-[26px]"
                      style="font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24">play_arrow</span>
              </span>
              <span class="flex-1 text-[15px] font-semibold text-on-surface">{{ v.titleKey | translate }}</span>
              <span class="text-[12px] text-outline">{{ 'GUIDE.CENTER.MINUTES' | translate:{ count: v.minutes } }}</span>
            </button>
          }
          <button type="button" (click)="pickingVideo.set(false)"
                  class="flex items-center gap-2 self-center rounded-md px-4 py-2 text-[14px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container/60 cursor-pointer">
            <span class="material-symbols-outlined text-[18px] rtl:rotate-180">arrow_back</span>
            {{ 'GUIDE.MENU.BACK' | translate }}
          </button>
        </div>
      } @else {
        <div class="flex flex-col gap-5 pt-1" appStopSpeechOnDestroy="help-menu">
          <!-- Read-aloud of the window (browser voice), only when there is one for the language. -->
          @if (speech.available()) {
            <button type="button" (click)="toggleListen()" [attr.aria-pressed]="speech.speaking()"
                    class="flex items-center gap-2 self-end rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors cursor-pointer"
                    [class]="speech.speaking() ? 'border-teal bg-teal/10 text-teal' : 'border-surface-container text-on-surface-variant hover:text-on-surface'">
              <span class="material-symbols-outlined text-[18px]">{{ speech.speaking() ? 'stop_circle' : 'volume_up' }}</span>
              {{ (speech.speaking() ? 'GUIDE.VOICE.STOP' : 'GUIDE.VOICE.LISTEN') | translate }}
            </button>
          }

          @if (choices().length) {
            <div class="flex flex-col gap-3 sm:flex-row sm:justify-center">
              @for (c of choices(); track c.id; let i = $index) {
                <button type="button" (click)="pick(c.id)"
                        [class.reading]="speech.part() === i + 1"
                        class="group flex min-h-[148px] flex-col sm:w-[calc((100%-1.5rem)/3)] items-center justify-center gap-3 rounded-xl border border-surface-container p-5 text-center transition-all duration-150 hover:-translate-y-0.5 hover:border-teal hover:shadow-md focus-visible:outline-2 focus-visible:outline-teal cursor-pointer"
                        style="background: var(--color-surface, #fff)">
                  <span class="flex h-14 w-14 items-center justify-center rounded-full {{ c.tone }}">
                    <span class="material-symbols-outlined text-[30px]"
                          style="font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24">{{ c.icon }}</span>
                  </span>
                  <span class="text-[15px] font-semibold text-on-surface">{{ c.labelKey | translate }}</span>
                  <span class="text-[12px] leading-snug text-on-surface-variant">
                    {{ c.hintKey | translate:{ count: c.count ?? 0 } }}
                  </span>
                </button>
              }
            </div>
          } @else {
            <p class="py-6 text-center text-body-md text-on-surface-variant">{{ 'GUIDE.MENU.NONE' | translate }}</p>
          }

          <button type="button" (click)="openHelp()"
                  class="flex items-center justify-center gap-2 self-center rounded-md px-4 py-2 text-[14px] font-semibold text-teal transition-colors hover:bg-tertiary/40 cursor-pointer">
            <span class="material-symbols-outlined text-[20px]">help_center</span>
            {{ 'GUIDE.MENU.ALL' | translate }}
            <span class="material-symbols-outlined text-[18px] rtl:rotate-180">arrow_forward</span>
          </button>
        </div>
      }
    </ng-template>
  `,
})
export class HelpCenterComponent {
  private readonly router    = inject(Router);
  private readonly route     = inject(ActivatedRoute);
  private readonly modal     = inject(ModalService);
  private readonly translate = inject(TranslateService);
  private readonly guide     = inject(PageGuideService);
  private readonly chat      = inject(HelpChatService);
  readonly speech            = inject(SpeechService);
  private readonly chooserTpl = viewChild.required<TemplateRef<unknown>>('chooserTpl');
  private readonly videoTpl   = viewChild.required<TemplateRef<unknown>>('videoTpl');

  readonly hovered = signal(false);
  /** The window shows the video list instead of the cards (several videos). */
  readonly pickingVideo = signal(false);
  /** The video in the player. */
  readonly playing = signal<HelpVideo | null>(null);
  private ref: ModalRef | null = null;

  private readonly url = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(() => this.router.url)),
    { initialValue: this.router.url },
  );

  /** On the help page itself. */
  readonly active = computed(() =>
    new RegExp(`(^|/)${HELP_ROUTE}(/|$)`).test((this.url() ?? '').split(/[?#]/)[0]));

  /** The page the user is on, when it has a guide (none on the help page itself). */
  readonly page = computed(() => (this.active() ? undefined : guidePageAt(this.url() ?? '')));

  /**
   * The videos of THIS page (its own entry) — those of its help tab when it has none (an
   * invoice's file shows the « Factures » tour). Only those with a file to play.
   */
  readonly videos = computed<HelpVideo[]>(() => {
    const p = this.page();
    if (!p) return [];
    const playable = (v: HelpVideo[] = []) => v.filter(x => !!x.url);
    const own = playable(HELP_CONTENT[p.guideKey]?.videos);
    if (own.length) return own;
    const tab = helpTabOf(p);
    return GUIDE_PAGES.filter(g => helpTabOf(g) === tab)
      .flatMap(g => playable(HELP_CONTENT[g.guideKey]?.videos));
  });

  /** The cards for the current page: its guide, its videos — only those with something behind them. */
  readonly choices = computed<HelpChoice[]>(() => {
    const list: HelpChoice[] = [];
    if (this.page()) {
      list.push({ id: 'guide', icon: 'play_circle', tone: 'bg-teal/10 text-teal',
        labelKey: 'GUIDE.MENU.GUIDE', hintKey: 'GUIDE.MENU.GUIDE_HINT' });
      const videos = this.videos().length;
      if (videos) list.push({ id: 'videos', icon: 'smart_display', tone: 'bg-warning/10 text-warning',
        labelKey: 'GUIDE.MENU.VIDEOS', hintKey: 'GUIDE.MENU.VIDEOS_HINT', count: videos });
    }
    list.push({ id: 'chat', icon: 'chat', tone: 'bg-teal/10 text-teal',
      labelKey: 'GUIDE.MENU.CHAT', hintKey: 'GUIDE.MENU.CHAT_HINT' });
    return list;
  });

  /** daf-side-nav's `itemClasses` for a top-level entry. */
  readonly itemClasses = computed(() => {
    const base = 'w-full flex items-center gap-3 rounded-md transition-all duration-150 cursor-pointer active:scale-95 px-3 py-3';
    if (this.active()) return `${base} bg-tertiary/50 text-teal font-semibold`;
    return `${base} ${this.hovered() ? 'bg-surface-container/60 text-on-surface' : 'bg-transparent text-on-surface-variant'}`;
  });

  /** daf-side-nav's `iconVariation`: filled when active or hovered. */
  readonly iconVariation = computed(() =>
    `'FILL' ${this.active() || this.hovered() ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`);

  /** Opens the window — on the help page itself there is nothing to pick. */
  openChooser(): void {
    if (this.active()) return;
    const t = (k: string, p?: object) => this.translate.instant(k, p) as string;
    const p = this.page();
    this.pickingVideo.set(false);
    this.ref = this.modal.open({
      title: t('GUIDE.HELP_CENTER'),
      subtitle: p ? t('GUIDE.MENU.TITLE', { page: t(p.labelKey) }) : t('GUIDE.MENU.NO_PAGE'),
      icon: 'help',
      body: this.chooserTpl(),
      width: '760px',
    });
  }

  /**
   * « Écouter »: the window's title line, then each card, the card being read highlighted
   * (part i + 1 = card i). Again: stop.
   */
  toggleListen(): void {
    if (this.speech.speaking()) { this.speech.stop(); return; }
    const t = (k: string, p?: object) => this.translate.instant(k, p) as string;
    const p = this.page();
    const cards = this.choices();
    this.speech.speak([
      p ? t('GUIDE.MENU.TITLE', { page: t(p.labelKey) }) : t('GUIDE.MENU.NO_PAGE'),
      ...(cards.length
        ? cards.map(c => `${t(c.labelKey)}. ${t(c.hintKey, { count: c.count ?? 0 })}`)
        : [t('GUIDE.MENU.NONE')]),
    ], 'help-menu');
  }

  pick(id: HelpChoice['id']): void {
    this.speech.stop();
    if (id === 'videos') {
      const list = this.videos();
      if (list.length === 1) this.play(list[0]);
      else this.pickingVideo.set(true);
      return;
    }
    this.close();
    if (id === 'chat') { this.chat.open.set(true); return; }
    const p = this.page();
    // After the window's exit animation, so the guide's spotlight isn't drawn under it.
    if (p) setTimeout(() => this.guide.request(p.guideKey), 200);
  }

  /** Closes the window and plays `video` in a large modal (maximizable), on this page. */
  play(video: HelpVideo): void {
    this.close();
    this.playing.set(video);
    this.modal.open({
      title: this.translate.instant(video.titleKey) as string,
      subtitle: this.translate.instant('GUIDE.CENTER.MINUTES', { count: video.minutes }) as string,
      icon: 'play_circle',
      body: this.videoTpl(),
      width: '1100px',
      maximizable: true,
    });
  }

  /** The help page, on the current page's tab and sub-page. */
  openHelp(): void {
    this.close();
    const from = this.page();
    this.router.navigate([HELP_ROUTE], {
      relativeTo: this.route,
      queryParams: from
        ? { tab: helpTabOf(from), page: from.pattern ? this.url() : null, sub: from.helpTab ? from.guideKey : null }
        : {},
    });
  }

  private close(): void {
    this.ref?.close();
    this.ref = null;
  }
}
