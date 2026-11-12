import {
  Component, TemplateRef, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ButtonComponent, FormFieldComponent, ModalService, PageComponent,
  PageHeaderComponent, SectionCardComponent, SelectComponent, SelectOption, StatusBadgeComponent,
  TabItem, TabsComponent, tabParam,
} from '@khalilrebhiitec/daf360';
import { UserStore } from '../../core/user.store';
import { GUIDE_PAGES, GuidePageDef, helpTabOf } from '../../shared/guide/guide-pages';
import {
  HELP_CONTENT, HelpDocSection, HelpPageContent, HelpVideo, SUPPORT_CONTACT,
} from '../../shared/guide/help-content';
import { HelpAnswer, answerText, answerTitle, answersOf, rankAnswers } from '../../shared/guide/help-answers';
import { HelpFaqCustomService } from '../../shared/guide/help-faq-custom.service';
import { HelpChatService } from '../../shared/guide/help-chat.service';
import { PageGuideService } from '../../shared/guide/page-guide.service';

/** The two halves of a tab's content, behind the pill strip. */
type HelpSection = 'faq' | 'docs';

const NO_CONTENT: HelpPageContent = { faq: [], docs: [], videos: [] };

/** A FAQ entry as shown: built-in (translated) or typed in Administration › Assistant & FAQ. */
interface ShownFaq { id: string; question: string; answer: string }

/**
 * /finance/aide — the « Aide & guides » page, same layout as the RH one: one daf-tabs tab
 * per page with a guide, each holding that page's FAQ and documentation (left), its guide,
 * videos and the support contact (right). Content lives in `help-content.ts`, pages with a
 * guide in `guide-pages.ts`. Typed questions go to the assistant bubble (`app-help-chat`).
 *
 * A tab also lists the guides of its sub-pages (`helpTab`), picked in the « Section »
 * dropdown. A sub-page whose URL carries an id (`pattern`) can only be guided on the page
 * the user came from — passed by « Aide & guides » as `?page=`.
 *
 * The active tab is in the URL (`?tab=<guideKey>`, the library's `tabParam`), so F5, a
 * bookmark or a shared link reopens it.
 */
@Component({
  selector: 'app-help',
  standalone: true,
  imports: [
    TranslatePipe, ButtonComponent, FormFieldComponent, PageComponent,
    PageHeaderComponent, SectionCardComponent, SelectComponent, StatusBadgeComponent, TabsComponent,
  ],
  templateUrl: './help.component.html',
})
export class HelpComponent {
  private readonly router    = inject(Router);
  private readonly route     = inject(ActivatedRoute);
  private readonly users     = inject(UserStore);
  private readonly guide     = inject(PageGuideService);
  private readonly translate = inject(TranslateService);
  private readonly modal     = inject(ModalService);
  private readonly videoTpl  = viewChild.required<TemplateRef<unknown>>('videoTpl');
  readonly chat = inject(HelpChatService);
  /** Questions published in Administration › Assistant & FAQ: shown first in each page's FAQ. */
  private readonly customFaq = inject(HelpFaqCustomService);

  readonly support = SUPPORT_CONTACT;
  /** The video shown in the player modal. */
  readonly playing = signal<HelpVideo | null>(null);

  /** Expanded FAQ entry (its id) or documentation section (its title key) — one at a time. */
  readonly openId = signal<string | null>(null);
  /** FAQ or documentation. daf-tabs falls back to the first one when the tab has no FAQ. */
  readonly section = signal<string>(   // a HelpSection; string for daf-tabs' [(active)]
    this.route.snapshot.queryParamMap.get('section') === 'docs' ? 'docs' : 'faq');

  /** The page the help page was opened from, when its URL carries an id (`?page=`). */
  private readonly fromUrl = toSignal(
    this.route.queryParamMap.pipe(map(q => q.get('page'))), { initialValue: null });

  /** Every guide the user may run. */
  readonly pages = computed(() =>
    GUIDE_PAGES.filter(p => p.permissions.length === 0 || p.permissions.some(c => this.users.hasPermission(c))));

  /** Pages with their own tab — sub-pages are listed inside their parent's. */
  private readonly tabPages = computed(() => this.pages().filter(p => !p.helpTab));

  readonly activeTab = tabParam(computed(() => this.tabPages().map(p => p.guideKey)), 'home');

  /** One tab per page. Labels re-translated on a language switch. */
  readonly tabs = computed<TabItem[]>(() => {
    this.translate.currentLang();
    return this.tabPages().map(p => ({
      id: p.guideKey,
      label: this.translate.instant(p.labelKey) as string,
      icon: p.icon,
    }));
  });

  /** The active tab's guides: its own page first, then its sub-pages. */
  readonly guides = computed(() => {
    const own = this.tabPages().find(p => p.guideKey === this.activeTab()) ?? this.tabPages()[0];
    if (!own) return [];
    return [own, ...this.pages().filter(p => p.helpTab === own.guideKey)];
  });

  /** The sub-page picked in the dropdown; starts on the one the help page was opened from (`?sub=`). */
  private readonly subPagePick = signal<string | null>(this.route.snapshot.queryParamMap.get('sub'));

  /** Sub-page whose FAQ and documentation are shown: the one picked, else the one the user came from, else the tab's own. */
  readonly subPage = computed<GuidePageDef | undefined>(() => {
    const guides = this.guides();
    const pick = this.subPagePick();
    return guides.find(g => g.guideKey === pick)
      ?? guides.find(g => g.pattern && this.startUrl(g) !== null)
      ?? guides[0];
  });

  /** Bumped when a theme header is clicked, so the dropdown snaps back to the current sub-page. */
  private readonly selectNonce = signal(0);
  readonly subPageSelected = computed(() => {
    this.selectNonce();
    return [this.subPage()?.guideKey ?? ''];
  });

  /** FAQ and documentation of the selected sub-page; videos of the whole tab. */
  readonly content = computed<HelpPageContent>(() => {
    const own = HELP_CONTENT[this.subPage()?.guideKey ?? ''] ?? NO_CONTENT;
    return {
      faq:    own.faq,
      docs:   own.docs,
      videos: this.guides().flatMap(p => HELP_CONTENT[p.guideKey]?.videos ?? []),
    };
  });

  /** Text of the search box above the FAQ / documentation. */
  readonly query = signal('');

  /** While something is typed: the matching entries, best first (synonyms, no accents). */
  private readonly matches = computed(() => {
    const q = this.query().trim();
    const page = this.subPage();
    if (q.length < 2 || !page) return null;
    return rankAnswers(q, answersOf([page], this.customFaq.entries()), k => this.translate.instant(k) as string, this.lang());
  });

  private readonly lang = computed(() => this.translate.currentLang() || 'fr');

  /** The admin questions of the selected sub-page, as answers. */
  private readonly customAnswers = computed<HelpAnswer[]>(() => {
    const page = this.subPage();
    return page ? answersOf([page], this.customFaq.entries()).filter(a => a.kind === 'custom') : [];
  });

  /** The FAQ shown: the admin questions first, then the built-in ones — or the search hits. */
  readonly shownFaq = computed<ShownFaq[]>(() => {
    const lang = this.lang();
    const t = (k: string) => this.translate.instant(k) as string;
    const show = (a: HelpAnswer): ShownFaq[] => a.kind === 'doc' ? [] : [{
      id: a.kind === 'custom' ? `custom-${a.custom.id}` : a.faq.id,
      question: answerTitle(a, t, lang),
      answer: answerText(a, t, lang),
    }];
    const m = this.matches();
    if (m) return m.flatMap(show);
    const page = this.subPage();
    const builtIn: HelpAnswer[] = page ? this.content().faq.map(faq => ({ kind: 'faq' as const, page, faq })) : [];
    return [...this.customAnswers(), ...builtIn].flatMap(show);
  });

  readonly shownDocs = computed<HelpDocSection[]>(() => {
    const m = this.matches();
    return m ? m.flatMap(a => (a.kind === 'doc' ? [a.doc] : [])) : this.content().docs;
  });

  /** A tab with several pages (its own + sub-pages) picks one in the « Section » dropdown. */
  readonly usePicker = computed(() => this.guides().length > 1);

  /**
   * Options of the « Section » dropdown — as in /rh/aide. When the tab's sub-pages carry a
   * `group`: the tab's own page under « Général », then the sub-pages by theme, each theme
   * headed by a disabled row. Without: the pages in order, no headers.
   */
  readonly subPageOptions = computed<SelectOption[]>(() => {
    this.translate.currentLang();
    const t = (k: string) => this.translate.instant(k) as string;
    if (!this.guides().some(g => g.group)) {
      return this.guides().map(g => ({ value: g.guideKey, label: t(g.labelKey), icon: g.icon }));
    }
    const order: string[] = [];
    const byGroup = new Map<string, GuidePageDef[]>();
    for (const g of this.guides()) {
      const key = g.group ?? 'GENERAL';
      if (!byGroup.has(key)) { byGroup.set(key, []); order.push(key); }
      byGroup.get(key)!.push(g);
    }
    return order.flatMap(key => [
      { value: `__group-${key}`, label: t(`GUIDE.GROUPS.${key}`).toUpperCase(), disabled: true },
      ...byGroup.get(key)!.map(g => ({ value: g.guideKey, label: t(g.labelKey), icon: g.icon })),
    ]);
  });

  /** A theme header or an emptied selection keeps the current section. */
  onSubPageSelect(values: string[]): void {
    if (values[0] && !values[0].startsWith('__group-')) this.subPagePick.set(values[0]);
    else this.selectNonce.update(n => n + 1);
  }

  /** The right column's guide: the sub-page shown on the left. */
  readonly shownGuides = computed(() => {
    const p = this.subPage();
    return p ? [p] : [];
  });

  /** Only the halves the sub-page has content for. */
  readonly sectionTabs = computed<TabItem[]>(() => {
    this.translate.currentLang();
    const t = (k: string) => this.translate.instant(k) as string;
    const items: TabItem[] = [];
    if (this.content().faq.length || this.customAnswers().length) items.push({ id: 'faq', label: t('GUIDE.CENTER.FAQ_TITLE'), icon: 'quiz' });
    if (this.content().docs.length) items.push({ id: 'docs', label: t('GUIDE.CENTER.DOCS_TITLE'), icon: 'menu_book' });
    return items;
  });

  constructor() {
    this.customFaq.ensureLoaded();
    // Another sub-page: its own list, unfiltered.
    effect(() => {
      this.subPage();
      untracked(() => this.query.set(''));
    });
  }

  /** Opens the video in a large library modal (maximizable), not a new window. */
  playVideo(video: HelpVideo): void {
    if (!video.url) return;
    this.playing.set(video);
    this.modal.open({
      resizable: true,
      minWidth: '360px',
      minHeight: '260px',
      title: this.translate.instant(video.titleKey) as string,
      subtitle: this.translate.instant('GUIDE.CENTER.MINUTES', { count: video.minutes }) as string,
      icon: 'play_circle',
      body: this.videoTpl(),
      width: '1100px',
      maximizable: true,
    });
  }

  toggle(id: string): void {
    this.openId.update(cur => (cur === id ? null : id));
  }

  /** Opens `page`'s tab, sub-page and half, `id` (a FAQ or doc entry) expanded. */
  openHit(page: GuidePageDef, id: string | null, section: HelpSection = 'faq'): void {
    this.activeTab.set(helpTabOf(page));
    this.subPagePick.set(page.guideKey);
    this.section.set(section);
    this.openId.set(id);
  }

  /**
   * Where `page`'s guide can start: the page the help page was opened from when it is one
   * of `page`'s (an invoice), the page's route otherwise; null when `page` needs a specific
   * record and the user didn't come from one.
   */
  startUrl(page: GuidePageDef): string | null {
    if (!page.pattern) return page.route;
    const url = this.fromUrl();
    return url?.startsWith('/') && page.pattern.test(url.split(/[?#]/)[0]) ? url : null;
  }

  /** Goes to the page, then asks its `app-page-guide` to start. */
  startGuide(page: GuidePageDef): void {
    const url = this.startUrl(page);
    if (url === null) { this.openHit(page, null); return; }
    const nav = page.pattern ? this.router.navigateByUrl(url) : this.openPage(page);
    nav.then(() => this.guide.request(page.guideKey));
  }

  /** « Ouvrir » next to « Lancer »: a record's guide goes back to that record, others to their page. */
  openGuidePage(page: GuidePageDef): void {
    const url = this.startUrl(page);
    if (page.pattern && url) this.router.navigateByUrl(url);
    else this.openPage(page);
  }

  /** Goes to the page itself (for a sub-page with an id: its list, to pick one). */
  openPage(page: GuidePageDef): Promise<boolean> {
    return this.router.navigate(['..', ...page.route.split('/')], { relativeTo: this.route, queryParams: page.query });
  }
}
