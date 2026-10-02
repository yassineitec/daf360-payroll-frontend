import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';

interface HrPaysRow { id: number; iso_code: string; french_label: string; english_label: string | null; }

/**
 * Entity (pays) names in the UI language, for every payroll country picker and filter.
 *
 * The payroll replica `pays_ref` only carries the French label, so the English one is
 * read from the RH reference (`/api/hr/config/hs/pays-list`) — once per session. Until it
 * arrives, or if it fails, callers get their own fallback (usually the French label), so
 * a picker never goes blank.
 *
 * `name()` reads `translate.currentLang()` and the loaded map, both signals: calling it
 * inside a `computed` is enough to follow a language switch.
 */
@Injectable({ providedIn: 'root' })
export class PaysNamesService {
  private readonly http      = inject(HttpClient);
  private readonly translate = inject(TranslateService);
  private readonly byId      = signal<Map<number, { fr: string; en: string | null }>>(new Map());

  constructor() {
    this.http.get<HrPaysRow[]>(`${environment.hrApiUrl}/api/hr/config/hs/pays-list`)
      .pipe(catchError(() => of([] as HrPaysRow[])))
      .subscribe(rows => this.byId.set(new Map(
        rows.map(r => [Number(r.id), { fr: r.french_label, en: r.english_label }]))));
  }

  /** The entity's name in the UI language; `fallback` when the RH reference has no row. */
  name(id: number | null | undefined, fallback: string): string {
    const isEn = (this.translate.currentLang() ?? '').startsWith('en');
    const row = id != null ? this.byId().get(Number(id)) : undefined;
    if (!row) return fallback;
    return (isEn && row.en) || row.fr || fallback;
  }
}
