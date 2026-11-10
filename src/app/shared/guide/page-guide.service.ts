import { Injectable, signal } from '@angular/core';

/** A guide start: the page's `storageKey`, and optionally the one step to show. */
export interface GuideRequest {
  key: string;
  /**
   * i18n key (text or title) of the only step to show — the assistant's « Lancer le
   * guide » on a documentation section, which reuses its step's texts. Not found on the
   * page: the whole guide starts.
   */
  focus?: string;
}

/**
 * Hands a "start the guide of page X" request from the sidebar's « Aide & guides »
 * (`app-help-center`) to the page's own `app-page-guide`. The help center navigates
 * first; the page's guide then sees its `storageKey` here and starts — immediately if
 * the page was already displayed.
 */
@Injectable({ providedIn: 'root' })
export class PageGuideService {
  /** The guide to start, until that guide picks it up. */
  readonly requested = signal<GuideRequest | null>(null);

  /**
   * Every guide start, never cleared (unlike `requested`, consumed by the page): lets the
   * « Première visite ? » bubble know a guide was started some other way.
   */
  readonly started = signal<{ key: string } | null>(null);

  /** Starts `key`'s guide — only its step `focus` when given (see `GuideRequest.focus`). */
  request(key: string, focus?: string): void {
    this.requested.set({ key, focus });
    this.started.set({ key });
  }
}
