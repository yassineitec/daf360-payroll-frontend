import { Observable, of } from 'rxjs';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';

import fr from '@public/i18n/fr.json';
import en from '@public/i18n/en.json';

/**
 * Les catalogues de la paie, embarqués dans le bundle.
 *
 * Chargés inline et non par HTTP, comme dans rh-frontend et facturation : monté dans le
 * shell, le remote n'est PAS servi depuis sa propre origine — un
 * `provideTranslateHttpLoader({ prefix: '/assets/i18n/' })` interrogeait l'origine du
 * shell, qui ne connaît pas les clés `PAYROLL.*`. C'est ce que faisait `app.config.ts`, et
 * comme `public/assets/i18n/` n'a jamais existé côté paie, la requête tombait en 404 même
 * en autonome : chaque libellé traduit se serait affiché sous forme de clé.
 */
export const PAYROLL_TRANSLATIONS: Record<string, TranslationObject> = {
  fr: fr as unknown as TranslationObject,
  en: en as unknown as TranslationObject,
};

/** Sert le catalogue demandé, français par défaut pour une langue inconnue. */
export class InlineTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<TranslationObject> {
    return of(PAYROLL_TRANSLATIONS[lang] ?? PAYROLL_TRANSLATIONS['fr']);
  }
}
