import type { TranslateService } from '@ngx-translate/core';
import type { RubriqueResultItem } from '../core/payroll-engine.service';

/** Modes de calcul traduits (`ADMIN_HOME.RUBRIQUES.MODE.*`) ; un mode inconnu s'affiche tel quel. */
const KNOWN_MODES = new Set(['TAUX_PCT', 'MONTANT_FIXE', 'BAREME_PROGRESSIF', 'ANNUALISE_BAREME', 'FORMULE', 'NEWTON_RAPHSON']);

/** Libellé anglais quand il existe — les résultats calculés avant son ajout n'ont que `labelFr`. */
export function rubriqueLineLabel(line: RubriqueResultItem, translate: TranslateService): string {
  return (translate.currentLang() === 'en' && line.labelEn) || line.labelFr;
}

export function rubriqueModeLabel(mode: string, translate: TranslateService): string {
  return KNOWN_MODES.has(mode) ? translate.instant(`PAYROLL.ADMIN_HOME.RUBRIQUES.MODE.${mode}`) : mode;
}
