/**
 * La langue choisie par l'utilisateur, conservée d'une session à l'autre.
 *
 * Sans ça, `provideTranslateService({ lang: 'fr' })` s'appliquait à chaque chargement :
 * l'utilisateur passait en anglais, rafraîchissait, et retrouvait le français.
 *
 * `localStorage` plutôt qu'un cookie : c'est une préférence d'affichage, elle n'a aucune
 * raison de partir dans chaque requête HTTP. Et plutôt que le profil serveur : la langue
 * doit s'appliquer AVANT le premier rendu, donc avant que `/me` ait répondu.
 *
 * Toutes les lectures/écritures sont protégées : `localStorage` lève une exception dans
 * certains navigateurs quand le stockage est désactivé (Safari en navigation privée,
 * politiques d'entreprise). Une préférence de langue ne doit jamais empêcher l'application
 * de démarrer — en cas d'échec on retombe simplement sur la langue par défaut.
 */

const STORAGE_KEY = 'daf360.lang';

/**
 * Les langues réellement proposées, à garder alignées sur le `languagesFromCodes([...])`
 * du sélecteur de l'en-tête (shell-layout). rh-frontend embarque aussi un `ar.json`, mais
 * l'arabe n'est pas offert au choix : l'ajouter ici sans l'ajouter au sélecteur ferait
 * accepter une langue que l'utilisateur ne peut pas quitter.
 */
const SUPPORTED = ['fr', 'en'] as const;
export type AppLang = (typeof SUPPORTED)[number];

export const DEFAULT_LANG: AppLang = 'fr';

function isSupported(value: string | null): value is AppLang {
  return !!value && (SUPPORTED as readonly string[]).includes(value);
}

/**
 * La langue à utiliser au démarrage : celle qui a été enregistrée, sinon celle du
 * navigateur si l'application la connaît, sinon le français.
 *
 * La valeur stockée est VALIDÉE contre `SUPPORTED` : une clé bricolée à la main dans les
 * outils de développement ferait sinon charger `/assets/i18n/xx.json`, qui n'existe pas, et
 * chaque libellé s'afficherait sous forme de clé.
 */
export function resolveInitialLang(): AppLang {
  const stored = readStoredLang();
  if (stored) return stored;

  const browser = (navigator.language ?? '').slice(0, 2).toLowerCase();
  return isSupported(browser) ? browser : DEFAULT_LANG;
}

export function readStoredLang(): AppLang | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isSupported(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function storeLang(lang: string): void {
  try {
    if (isSupported(lang)) localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Stockage indisponible : la langue reste active pour la session en cours, elle ne
    // survivra simplement pas au rafraîchissement. Rien à signaler à l'utilisateur.
  }
}
