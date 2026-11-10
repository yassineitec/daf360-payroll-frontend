import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Texts of a question typed in Administration › Assistant & FAQ, per language (EN / AR may be empty). */
export interface CustomFaq {
  id: number;
  /** Guide key of the page it is about (`GUIDE_PAGES.guideKey`). */
  pageKey: string;
  question: Record<'fr' | 'en' | 'ar', string>;
  answer:   Record<'fr' | 'en' | 'ar', string>;
}

interface HelpFaqDto {
  id: number;
  pageKey: string;
  questionFr: string; answerFr: string;
  questionEn: string | null; answerEn: string | null;
  questionAr: string | null; answerAr: string | null;
}

/**
 * The published questions of Administration › Assistant & FAQ (`GET /api/payroll/help-faq/active`,
 * open to every signed-in user), for the help assistant — same service as the RH module's.
 * Loaded once, on first use; the admin tab calls `reload()` after a change. A failed call
 * leaves the list empty: the assistant still answers with the built-in FAQ.
 */
@Injectable({ providedIn: 'root' })
export class HelpFaqCustomService {
  private readonly http = inject(HttpClient);
  readonly entries = signal<CustomFaq[]>([]);
  private loaded = false;

  ensureLoaded(): void {
    if (this.loaded) return;
    this.reload();
  }

  reload(): void {
    this.loaded = true;
    this.http.get<HelpFaqDto[]>(`${environment.payrollApiUrl}/api/payroll/help-faq/active`)
      .pipe(catchError(() => { this.loaded = false; return of([] as HelpFaqDto[]); }))
      .subscribe(list => this.entries.set(list.map(toCustom)));
  }
}

/** A translation counts only with both its question and its answer; otherwise French. */
function toCustom(d: HelpFaqDto): CustomFaq {
  const en = !!(d.questionEn?.trim() && d.answerEn?.trim());
  const ar = !!(d.questionAr?.trim() && d.answerAr?.trim());
  return {
    id: d.id,
    pageKey: d.pageKey,
    question: { fr: d.questionFr, en: en ? d.questionEn! : d.questionFr, ar: ar ? d.questionAr! : d.questionFr },
    answer:   { fr: d.answerFr,   en: en ? d.answerEn!   : d.answerFr,   ar: ar ? d.answerAr!   : d.answerFr },
  };
}
