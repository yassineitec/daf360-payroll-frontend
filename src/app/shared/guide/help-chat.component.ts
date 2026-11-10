import {
  ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonComponent, FormFieldComponent } from '@khalilrebhiitec/daf360';
import { UserStore } from '../../core/user.store';
import { GUIDE_PAGES, GuidePageDef, guidePageAt, helpTabOf } from './guide-pages';
import {
  HelpAnswer, answerText, answerTitle, answersOf, isGreeting, rankAnswers, sameText, suggestCorrections,
} from './help-answers';
import { HelpFaqCustomService } from './help-faq-custom.service';
import { SUPPORT_CONTACT } from './help-content';
import { HelpChatService } from './help-chat.service';
import { PageGuideService } from './page-guide.service';

/** One message of the conversation. Bot texts are i18n keys: a language switch re-renders them. */
type ChatMessage =
  | { id: number; from: 'user'; text: string }
  | {
      id: number; from: 'bot'; answer: HelpAnswer | null; related: HelpAnswer[]; greeting?: boolean;
      /** No answer: what was typed, and the same question with its typos fixed (« tst » → « test »). */
      asked?: string; corrections?: string[];
      /** undefined: not answered yet; a text: the proposal picked; null: « Non » / « Aucune ». */
      choice?: string | null;
    };

/**
 * Help assistant, Messenger-style — the RH module's, ported: a round bubble at the bottom
 * right of every payroll page, opening a conversation panel. A typed question gets the
 * closest FAQ / documentation entry or admin question (Administration › Assistant & FAQ)
 * of every page (`rankAnswers` — no AI), with its source, its page's guide and a 👍 / 👎.
 * The current page's questions are suggested and win ties. A greeting gets a welcome; a
 * question with a typo gets « Vouliez-vous dire … ? ».
 *
 * Placed like Finance's: alone in the bottom right corner on desktop (the display currency
 * is a row of the sidebar there), stacked ABOVE the currency bubble (`daf-radial-menu`,
 * mobile only) and the bottom bar on mobile — one layer BELOW it (z-40 vs z-50), so the
 * currency fan opens over this bubble. On mobile the open panel takes the whole screen.
 *
 * The bubble's and panel's geometry is plain CSS (`styles`), not Tailwind classes:
 * payroll's styles.css is not run through Tailwind (no postcss.config.json), so classes
 * like `bottom-[152px]` or `sm:right-8` only existed if the shell generated them.
 *
 * Lives in the payroll shell, so the conversation survives navigation. The chat bubbles
 * are hand-made: the library has no conversation component.
 */
@Component({
  selector: 'app-help-chat',
  standalone: true,
  imports: [TranslatePipe, ButtonComponent, FormFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'chat.open.set(false)' },
  styles: [`
    .chat-panel {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--color-surface-container-lowest, #fff);
      box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);
    }
    .chat-bubble {
      position: fixed;
      right: 1.25rem;
      bottom: 152px;
      z-index: 40;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 3.5rem;
      height: 3.5rem;
      border: 0;
      border-radius: 9999px;
      background: var(--color-teal, #0d9488);
      color: #fff;
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
      cursor: pointer;
      transition: transform 0.15s;
    }
    .chat-fs18 { font-size: 18px; }
    .chat-fs20 { font-size: 20px; }
    .chat-fs22 { font-size: 22px; }
    .chat-mw85 { max-width: 85%; }
    .chat-mw90 { max-width: 90%; }
    .chat-bubble:hover { transform: scale(1.05); }
    .chat-bubble:active { transform: scale(0.95); }
    .chat-bubble--open { display: none; }
    @media (min-width: 40rem) {
      .chat-panel {
        inset: auto 2rem 6.5rem auto;
        width: 380px;
        height: min(560px, calc(100vh - 11rem));
        border: 1px solid color-mix(in srgb, var(--color-outline-variant, #bdc9c4) 60%, transparent);
        border-radius: 1rem;
      }
      .chat-bubble { right: 2rem; bottom: 2rem; }
      .chat-bubble--open { display: flex; }
    }
  `],
  template: `
    @if (chat.open()) {
      <section role="dialog" [attr.aria-label]="'GUIDE.CENTER.CHAT.NAME' | translate"
               class="chat-panel">
        <header class="flex items-center gap-3 border-b border-outline-variant/60 px-4 py-3">
          <span class="material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal/10 chat-fs20 text-teal">smart_toy</span>
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-body-md font-semibold text-on-surface">{{ 'GUIDE.CENTER.CHAT.NAME' | translate }}</h2>
            <p class="truncate text-label-sm text-outline">{{ 'GUIDE.CENTER.CHAT.TAGLINE' | translate }}</p>
          </div>
          @if (messages().length) {
            <button type="button" class="material-symbols-outlined chat-fs20 text-on-surface-variant hover:text-on-surface"
                    [attr.aria-label]="'GUIDE.CENTER.CHAT.CLEAR' | translate" [attr.title]="'GUIDE.CENTER.CHAT.CLEAR' | translate"
                    (click)="clearChat()">restart_alt</button>
          }
          <button type="button" class="material-symbols-outlined chat-fs22 text-on-surface-variant hover:text-on-surface"
                  [attr.aria-label]="'GUIDE.CLOSE' | translate" (click)="chat.open.set(false)">close</button>
        </header>

        <div #thread class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite">
          <div class="flex flex-col items-start gap-2">
            <p class="chat-mw90 rounded-2xl rounded-ss-sm bg-surface-container/60 px-4 py-3 text-body-sm text-on-surface">
              {{ 'GUIDE.CENTER.CHAT.HELLO' | translate }}
            </p>
            @if (!messages().length) {
              @for (sug of suggestions(); track $index) {
                <button type="button" (click)="pick(sug)"
                        class="chat-mw90 rounded-2xl border border-teal/30 px-3 py-2 text-start text-body-sm font-medium text-teal hover:bg-teal/10">
                  {{ title(sug) }}
                </button>
              }
            }
          </div>

          @for (m of messages(); track m.id) {
            @if (m.from === 'user') {
              <p class="chat-mw85 self-end rounded-2xl rounded-se-sm bg-teal px-4 py-2 text-body-sm text-white">{{ m.text }}</p>
            } @else {
              <div class="flex chat-mw90 flex-col gap-3 rounded-2xl rounded-ss-sm bg-surface-container/60 px-4 py-3">
                @if (m.answer; as a) {
                  <div class="flex flex-col gap-1">
                    <p class="text-body-sm font-semibold text-on-surface">{{ title(a) }}</p>
                    <p class="text-body-sm text-on-surface-variant">{{ text(a) }}</p>
                  </div>
                  <p class="text-label-sm text-outline">
                    {{ 'GUIDE.CENTER.CHAT.SOURCE' | translate:{ page: (a.page.labelKey | translate), kind: ((a.kind !== 'doc' ? 'GUIDE.CENTER.KIND_FAQ' : 'GUIDE.CENTER.KIND_DOC') | translate) } }}
                  </p>
                  @if (startUrl(a.page) !== null || canOpen(a.page)) {
                    <div class="flex flex-wrap gap-2">
                      @if (startUrl(a.page) !== null) {
                        <daf-button [options]="{ variant: 'teal', size: 'sm', label: ('GUIDE.CENTER.CHAT.START_GUIDE' | translate), iconStart: 'play_arrow' }"
                                    (onClick)="startGuide(a.page, a)" />
                      }
                      @if (canOpen(a.page)) {
                        <daf-button [options]="{ variant: 'ghost', size: 'sm', label: ('GUIDE.CENTER.CHAT.OPEN_PAGE' | translate), iconEnd: 'arrow_forward' }"
                                    (onClick)="openPage(a.page)" />
                      }
                    </div>
                  }
                  @if (m.related.length) {
                    <div class="flex flex-col items-start gap-1">
                      <span class="text-label-sm text-outline">{{ 'GUIDE.CENTER.CHAT.SEE_ALSO' | translate }}</span>
                      @for (r of m.related; track $index) {
                        <button type="button" class="text-start text-body-sm font-medium text-teal hover:underline" (click)="pick(r)">
                          {{ title(r) }}
                        </button>
                      }
                    </div>
                  }
                  <div class="flex items-center gap-2 border-t border-outline-variant/40 pt-2 text-label-sm text-outline">
                    @if (votes()[m.id]) {
                      <span>{{ 'GUIDE.CENTER.CHAT.THANKS' | translate }}</span>
                    } @else {
                      <span class="flex-1">{{ 'GUIDE.CENTER.CHAT.HELPFUL' | translate }}</span>
                      <button type="button" class="material-symbols-outlined chat-fs18 hover:text-teal"
                              [attr.aria-label]="'GUIDE.CENTER.CHAT.YES' | translate" (click)="vote(m.id, 'up')">thumb_up</button>
                      <button type="button" class="material-symbols-outlined chat-fs18 hover:text-error"
                              [attr.aria-label]="'GUIDE.CENTER.CHAT.NO' | translate" (click)="vote(m.id, 'down')">thumb_down</button>
                    }
                  </div>
                } @else if (m.greeting) {
                  <p class="text-body-sm text-on-surface">{{ 'GUIDE.CENTER.CHAT.GREETING' | translate }}</p>
                  @if (suggestions().length) {
                    <div class="flex flex-col items-start gap-1">
                      @for (sug of suggestions(); track $index) {
                        <button type="button" class="text-start text-body-sm font-medium text-teal hover:underline" (click)="pick(sug)">
                          {{ title(sug) }}
                        </button>
                      }
                    </div>
                  }
                } @else if (m.corrections?.length && m.choice !== null) {
                  <!-- « Vouliez-vous dire » : Oui / Non for one proposal, a list to pick from for several. -->
                  @let fixes = m.corrections ?? [];
                  <p class="text-body-sm text-on-surface">{{ 'GUIDE.CENTER.CHAT.NOTHING_FOR' | translate:{ text: m.asked } }}</p>
                  @if (m.choice) {
                    <p class="flex items-center gap-1 text-body-sm font-medium text-teal">
                      <span class="material-symbols-outlined chat-fs18">check_circle</span>{{ m.choice }}
                    </p>
                  } @else if (fixes.length === 1) {
                    <p class="text-body-sm text-on-surface">{{ 'GUIDE.CENTER.CHAT.DID_YOU_MEAN_ONE' | translate:{ word: fixes[0] } }}</p>
                    <div class="flex gap-2">
                      <daf-button [options]="{ variant: 'teal', size: 'sm', label: ('GUIDE.CENTER.CHAT.YES_SHORT' | translate) }"
                                  (onClick)="choose(m.id, fixes[0])" />
                      <daf-button [options]="{ variant: 'ghost', size: 'sm', label: ('GUIDE.CENTER.CHAT.NO_SHORT' | translate) }"
                                  (onClick)="choose(m.id, null)" />
                    </div>
                  } @else {
                    <p class="text-body-sm text-on-surface">{{ 'GUIDE.CENTER.CHAT.DID_YOU_MEAN_MANY' | translate }}</p>
                    <div class="flex flex-col items-stretch gap-1" role="list">
                      @for (c of fixes; track c) {
                        <button type="button" role="listitem" (click)="choose(m.id, c)"
                                class="flex items-center gap-2 rounded-lg border border-teal/30 px-3 py-2 text-start text-body-sm font-medium text-teal hover:bg-teal/10">
                          <span class="material-symbols-outlined chat-fs18">radio_button_unchecked</span>{{ c }}
                        </button>
                      }
                      <button type="button" (click)="choose(m.id, null)"
                              class="flex items-center gap-2 rounded-lg px-3 py-2 text-start text-body-sm text-on-surface-variant hover:bg-surface-container">
                        <span class="material-symbols-outlined chat-fs18">close</span>{{ 'GUIDE.CENTER.CHAT.NONE_OF_THEM' | translate }}
                      </button>
                    </div>
                  }
                } @else {
                  <p class="text-body-sm text-on-surface">{{ 'GUIDE.CENTER.CHAT.NO_ANSWER' | translate }}</p>
                  @if (support.email) {
                    <a [href]="'mailto:' + support.email" class="flex items-center gap-1 text-body-sm font-semibold text-teal hover:underline">
                      <span class="material-symbols-outlined chat-fs18">mail</span>{{ support.email }}
                    </a>
                  }
                }
              </div>
            }
          }
        </div>

        <!-- Enter sends: the keydown bubbles up from daf-form-field's input. -->
        <footer class="flex items-center gap-2 border-t border-outline-variant/60 px-3 py-3">
          <daf-form-field class="min-w-0 flex-1"
            [options]="{ type: 'text', placeholder: ('GUIDE.CENTER.CHAT.PLACEHOLDER' | translate), fullWidth: true }"
            [value]="draft()"
            (valueChange)="draft.set($any($event) ?? '')"
            (keydown.enter)="ask()" />
          <daf-button [options]="{ variant: 'teal', size: 'md', iconStart: 'send', title: ('GUIDE.CENTER.CHAT.SEND' | translate), disabled: !draft().trim() }"
                      (onClick)="ask()" />
        </footer>
      </section>
    }

    <!-- The bubble. Hidden on mobile while the panel (full screen there) is open. -->
    <button type="button" data-guide="help-chat"
            class="chat-bubble" [class.chat-bubble--open]="chat.open()"
            [attr.aria-label]="(chat.open() ? 'GUIDE.CLOSE' : 'GUIDE.CENTER.CHAT.OPEN') | translate"
            [attr.aria-expanded]="chat.open()"
            (click)="chat.open.set(!chat.open())">
      <span class="material-symbols-outlined" style="font-size: 28px">{{ chat.open() ? 'close' : 'chat' }}</span>
    </button>
  `,
})
export class HelpChatComponent {
  readonly chat = inject(HelpChatService);
  private readonly router    = inject(Router);
  private readonly route     = inject(ActivatedRoute);
  private readonly users     = inject(UserStore);
  private readonly guide     = inject(PageGuideService);
  private readonly translate = inject(TranslateService);
  private readonly customFaq = inject(HelpFaqCustomService);
  private readonly thread    = viewChild<ElementRef<HTMLElement>>('thread');

  readonly support = SUPPORT_CONTACT;

  readonly draft    = signal('');
  readonly messages = signal<ChatMessage[]>([]);
  /** 👍 / 👎 per bot message id. Kept for this visit only, until a backend collects them. */
  readonly votes    = signal<Record<number, 'up' | 'down'>>({});
  private nextId = 0;

  private readonly url = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(() => this.router.url)),
    { initialValue: this.router.url },
  );

  /** Every page with help the user may see. */
  private readonly pages = computed(() =>
    GUIDE_PAGES.filter(p => p.permissions.length === 0 || p.permissions.some(c => this.users.hasPermission(c))));

  /** The page the user is on (none on the help center itself, for instance). */
  private readonly current = computed(() => {
    const page = guidePageAt(this.url() ?? '');
    return page && this.pages().includes(page) ? page : undefined;
  });

  /** Every entry, the current page's first, then its tab's (« Profils » + the file), then the rest. */
  private readonly answers = computed(() => {
    const cur = this.current();
    const tab = cur ? helpTabOf(cur) : null;
    const pages = [...this.pages()].sort((x, y) => rankOf(x) - rankOf(y));
    function rankOf(p: GuidePageDef): number {
      return p === cur ? 0 : helpTabOf(p) === tab ? 1 : 2;
    }
    return answersOf(pages, this.customFaq.entries());
  });

  /** Offered before the first message: the current page's first questions (the home's elsewhere). */
  readonly suggestions = computed(() => {
    const key = this.current()?.guideKey ?? 'home';
    return this.answers().filter(a => a.kind !== 'doc' && a.page.guideKey === key).slice(0, 3);
  });

  /** Read by the template through title() / text(): a language switch re-renders the answers. */
  private readonly lang = computed(() => this.translate.currentLang() || 'fr');

  title(a: HelpAnswer): string {
    return answerTitle(a, k => this.translate.instant(k) as string, this.lang());
  }

  text(a: HelpAnswer): string {
    return answerText(a, k => this.translate.instant(k) as string, this.lang());
  }

  constructor() {
    // The admin questions: fetched the first time the panel opens.
    effect(() => { if (this.chat.open()) untracked(() => this.customFaq.ensureLoaded()); });
    // Opening the panel or a new message: show the latest one, once rendered.
    effect(() => {
      if (!this.chat.open()) return;
      this.messages();
      untracked(() => requestAnimationFrame(() => {
        const el = this.thread()?.nativeElement;
        el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }));
    });
  }

  /** Sends the draft, or `forced` (a suggestion, a « Voir aussi » link) as its own answer. */
  ask(text = this.draft(), forced?: HelpAnswer): void {
    text = text.trim();
    if (!text) return;
    if (!forced) this.draft.set('');
    // A bare greeting (« hi », « bonjour »): the admin's own answer to it if there is one
    // (a question titled « hello »), a welcome with the page's questions otherwise.
    const greeting = !forced && isGreeting(text);
    const own = greeting
      ? this.answers().filter(a => a.kind === 'custom' && sameText(this.title(a), text))
      : [];
    const ranked = forced
      ? [forced]
      : greeting
        ? own
        : rankAnswers(text, this.answers(), k => this.translate.instant(k) as string, this.lang());
    // Nothing found: the same question with its typos fixed, to confirm (« Vouliez-vous dire »).
    const corrections = !forced && !greeting && !ranked.length
      ? suggestCorrections(text, this.answers(), k => this.translate.instant(k) as string, this.lang())
      : [];
    this.messages.update(m => [
      ...m,
      { id: this.nextId++, from: 'user', text },
      {
        id: this.nextId++, from: 'bot', answer: ranked[0] ?? null, related: ranked.slice(1, 3),
        greeting: greeting && !own.length, asked: text, corrections,
      },
    ]);
  }

  /** Asks an entry as if its title had been typed. */
  pick(a: HelpAnswer): void {
    this.ask(this.title(a), a);
  }

  /** Answers a « Vouliez-vous dire »: asks the picked text, or (null) gives up with « no answer ». */
  choose(id: number, choice: string | null): void {
    this.messages.update(list => list.map(m => (m.id === id && m.from === 'bot' ? { ...m, choice } : m)));
    if (choice) this.ask(choice);
  }

  vote(id: number, value: 'up' | 'down'): void {
    this.votes.update(v => ({ ...v, [id]: value }));
  }

  clearChat(): void {
    this.messages.set([]);
    this.votes.set({});
  }

  /**
   * Where `page`'s guide can start: its route, or — for a page whose URL carries an id
   * (a profile file) — the current URL when the user is on one; null otherwise.
   */
  startUrl(page: GuidePageDef): string | null {
    if (!page.pattern) return page.route;
    const url = this.url() ?? '';
    return page.pattern.test(url.split(/[?#]/)[0]) ? url : null;
  }

  /** « Ouvrir la page »: only for another page, reachable without an id. */
  canOpen(page: GuidePageDef): boolean {
    return !page.pattern && page !== this.current();
  }

  /**
   * Goes to the page, closes the panel (the guide dims the page), then starts the guide —
   * for a documentation section, only its step (same texts as the section), with « Voir
   * tout le guide »; for a FAQ or admin question, the whole guide.
   */
  startGuide(page: GuidePageDef, from?: HelpAnswer): void {
    const url = this.startUrl(page);
    if (url === null) return;
    this.chat.open.set(false);
    const nav = page.pattern ? this.router.navigateByUrl(url) : this.openPage(page, false);
    const focus = from?.kind === 'doc' ? from.doc.textKey : undefined;
    nav.then(() => this.guide.request(page.guideKey, focus));
  }

  openPage(page: GuidePageDef, close = window.innerWidth < 640): Promise<boolean> {
    if (close) this.chat.open.set(false);   // full screen on mobile: the page would stay hidden
    return this.router.navigate(page.route.split('/'), { relativeTo: this.route, queryParams: page.query });
  }
}
