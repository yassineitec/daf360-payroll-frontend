import { GuidePageDef } from './guide-pages';
import { HELP_CONTENT, HelpDocSection, HelpFaq } from './help-content';
import { CustomFaq } from './help-faq-custom.service';

/**
 * Matching of the payroll help assistant (`app-help-chat`) and help page search: finds the FAQ answers and
 * documentation sections closest to a typed question. Word matching with stems and
 * synonyms over the translated texts — no AI, so it only ever shows validated content.
 */

/**
 * An entry the assistant can answer with: a FAQ answer, a documentation section, or a
 * question typed in Administration › Assistant & FAQ (`custom`: plain texts, not i18n keys).
 */
export type HelpAnswer =
  | { kind: 'faq'; page: GuidePageDef; faq: HelpFaq }
  | { kind: 'doc'; page: GuidePageDef; doc: HelpDocSection }
  | { kind: 'custom'; page: GuidePageDef; custom: CustomFaq };

/** `t` translates an i18n key; `lang` picks the text of an admin question (fr / en / ar). */
export function answerTitle(a: HelpAnswer, t: (key: string) => string, lang: string): string {
  if (a.kind === 'custom') return a.custom.question[langOf(lang)];
  return t(a.kind === 'faq' ? a.faq.questionKey : a.doc.titleKey);
}

export function answerText(a: HelpAnswer, t: (key: string) => string, lang: string): string {
  if (a.kind === 'custom') return a.custom.answer[langOf(lang)];
  return t(a.kind === 'faq' ? a.faq.answerKey : a.doc.textKey);
}

function langOf(lang: string): 'fr' | 'en' | 'ar' {
  const l = (lang || 'fr').slice(0, 2);
  return l === 'en' || l === 'ar' ? l : 'fr';
}

/**
 * Every entry of `pages`, page by page: the admin questions of the page first (ordered by
 * the admin), then its built-in FAQ, then its documentation.
 */
export function answersOf(pages: GuidePageDef[], custom: CustomFaq[] = []): HelpAnswer[] {
  return pages.flatMap(page => [
    ...custom.filter(c => c.pageKey === page.guideKey).map(c => ({ kind: 'custom' as const, page, custom: c })),
    ...(HELP_CONTENT[page.guideKey]?.faq ?? []).map(faq => ({ kind: 'faq' as const, page, faq })),
    ...(HELP_CONTENT[page.guideKey]?.docs ?? []).map(doc => ({ kind: 'doc' as const, page, doc })),
  ]);
}

/** Case- and accent-insensitive: « cles » finds « clés ». */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function tokens(s: string): string[] {
  return normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Greetings (FR / EN / AR), compared after `normalize`. */
const GREETINGS = new Set([
  'hi', 'hello', 'hey', 'hola', 'yo', 'bonjour', 'bonsoir', 'salut', 'coucou', 'bjr', 'slt',
  'salam', 'salem', 'mrahba', 'marhaba', 'ahla', 'ahlan',
  'مرحبا', 'مرحبًا', 'اهلا', 'أهلا', 'سلام', 'السلام',
].map(normalize));

/** Words that may follow a greeting: « hi there », « bonjour l'assistant », « السلام عليكم ». */
const GREETING_EXTRAS = new Set([
  'there', 'all', 'everyone', 'good', 'morning', 'afternoon', 'evening', 'assistant', 'bot',
  'tout', 'le', 'la', 'l', 'monde', 'madame', 'monsieur', 'a', 'à', 'toi', 'vous',
  'ça', 'ca', 'va', 'vas', 'comment', 'how', 'are', 'you', 'doing', 'what', 'up',
  'كيف', 'الحال', 'حالك',
  'عليكم', 'صباح', 'مساء', 'الخير', 'بك', 'بكم',
].map(normalize));

/**
 * A message that is only a greeting (« hi », « Bonjour ! », « good morning », « السلام عليكم »):
 * the assistant answers it with a welcome, not with « no answer ».
 */
export function isGreeting(text: string): boolean {
  const words = tokens(text);
  const core = words.some(w => GREETINGS.has(w))
    || (words.includes('good') && words.some(w => ['morning', 'afternoon', 'evening'].includes(w)))
    || (words.some(w => w === normalize('صباح') || w === normalize('مساء')) && words.includes(normalize('الخير')));
  return core && words.every(w => GREETINGS.has(w) || GREETING_EXTRAS.has(w));
}

/** Same text once accents, case and punctuation are dropped: « Hello ! » is « hello ». */
export function sameText(a: string, b: string): boolean {
  return tokens(a).join(' ') === tokens(b).join(' ');
}

/** Words that say nothing about the subject (« comment je peux… »). */
const STOP_WORDS = new Set([
  'comment', 'pourquoi', 'quand', 'quoi', 'est', 'que', 'qui', 'pour', 'faire', 'peut',
  'peux', 'dans', 'avec', 'une', 'des', 'les', 'mon', 'mes', 'son', 'ses', 'sur', 'par',
  'pas', 'plus', 'cette', 'sont', 'ont', 'elle', 'elles', 'ils', 'aux', 'ces', 'vous',
  'nous', 'leur', 'quel', 'quelle', 'quels', 'quelles', 'depuis',
  'how', 'what', 'why', 'when', 'where', 'can', 'does', 'are', 'the', 'and', 'for', 'with',
  'from', 'their', 'your', 'this', 'that',
]);

/** Words users say for the same thing — « un employé est parti » finds « a quitté ». */
const SYNONYMS: string[][] = [
  ['salaire', 'salaires', 'paie', 'remuneration', 'brut', 'net', 'salary', 'pay', 'payroll', 'gross'],
  ['bulletin', 'bulletins', 'fiche', 'fiches', 'payslip', 'payslips', 'slip'],
  ['avance', 'avances', 'acompte', 'pret', 'advance', 'advances', 'loan'],
  ['cnss', 'cotisation', 'cotisations', 'securite', 'sociale', 'charges', 'contribution', 'social'],
  ['irpp', 'impot', 'impots', 'fiscal', 'retenue', 'tax', 'withholding'],
  ['simulation', 'simuler', 'simulateur', 'simule', 'estimer', 'estimation', 'simulate', 'simulator', 'estimate'],
  ['moteur', 'calcul', 'calculer', 'lancer', 'execution', 'run', 'engine', 'compute'],
  ['resultat', 'resultats', 'historique', 'archive', 'result', 'results', 'history'],
  ['employe', 'employes', 'collaborateur', 'collaborateurs', 'salarie', 'salaries', 'employee', 'employees', 'staff'],
  ['cohorte', 'groupe', 'lot', 'masse', 'cohort', 'group', 'batch'],
  ['candidat', 'recrutement', 'embauche', 'offre', 'candidate', 'hiring', 'offer'],
  ['budget', 'masse', 'previsionnel', 'prevision', 'forecast'],
  ['calibration', 'calibrer', 'etalonnage', 'ajuster', 'calibrate', 'tune'],
  ['rubrique', 'rubriques', 'element', 'elements', 'prime', 'primes', 'indemnite', 'bonus', 'allowance'],
  ['devise', 'monnaie', 'euro', 'dinar', 'taux', 'conversion', 'convertir', 'currency', 'rate'],
  ['pays', 'entite', 'filiale', 'societe', 'country', 'entity'],
  ['parametre', 'parametres', 'parametrage', 'configuration', 'configurer', 'reglage', 'admin', 'administration', 'settings', 'parameter'],
  ['refuse', 'interdit', 'acces', 'droit', 'droits', 'permission', 'permissions', 'forbidden', 'access'],
  ['carte', 'cartes', 'module', 'modules', 'ecran', 'ecrans', 'card', 'cards', 'screen'],
  ['exporter', 'export', 'telecharger', 'pdf', 'excel', 'imprimer', 'download', 'print'],
  ['valider', 'validation', 'approuver', 'approbation', 'accepter', 'approve', 'approval'],
  ['vide', 'rien', 'aucun', 'aucune', 'zero', 'empty', 'nothing'],
  ['langue', 'francais', 'anglais', 'traduction', 'language', 'english', 'french'],
  ['voir', 'affiche', 'afficher', 'apparait', 'see', 'show', 'shows'],
  ['creer', 'nouveau', 'nouvelle', 'ajouter', 'create', 'new', 'add'],
  ['modifier', 'changer', 'choisir', 'editer', 'change', 'edit', 'choose', 'switch'],
  ['supprimer', 'effacer', 'retirer', 'delete', 'remove'],
];

/**
 * Drops a conjugation / plural ending: « ajoutez », « profils » still match. One letter only
 * on mid-length words, so « employé » (employ) doesn't become « emploi » (emplo). Arabic
 * also loses its article « ال » / « و »: « الصورة » must find « صورة ».
 */
function stem(w: string): string {
  w = w.replace(/^(وال|ال|و)(?=[؀-ۿ]{3})/, '');
  return w.length > 7 ? w.slice(0, -2) : w.length > 5 ? w.slice(0, -1) : w;
}

/** The stems a query word stands for: itself first, then its synonyms. */
function variants(word: string): string[] {
  const s = stem(word);
  const group = SYNONYMS.find(g => g.some(x => stem(x) === s));
  return [...new Set([s, ...(group ?? []).map(stem)])];
}

/**
 * Latin script: a word must START with the stem (« renouveler » isn't « nouveau »).
 * Other scripts may contain it (Arabic glues « ال » and « و » in front of words).
 */
function found(words: string[], stems: string[]): boolean {
  return stems.some(v => words.some(w => (/^[a-z0-9]+$/.test(v) ? w.startsWith(v) : w.includes(v))));
}

/** Two-letter words that still name a subject (the length rule drops the others). */
const SHORT_WORDS = new Set(['cv']);

/** Under this, no word of the question is in the entry's title: no answer rather than a wrong one. */
const MIN_SCORE = 3;

/** The words of a text that carry its subject: no stop words, no short ones (but « cv »). */
function subjectWords(text: string): string[] {
  return tokens(text).filter(w => (w.length > 2 || SHORT_WORDS.has(w)) && !STOP_WORDS.has(w));
}

/**
 * Within one typo: a letter missing (« tst » / « test »), added, replaced, or two neighbours
 * swapped (« tset »). Optimal string alignment distance ≤ 1, without building the matrix.
 */
function oneTypo(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;                       // replaced
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // swapped
  }
  return la < lb ? a.slice(i) === b.slice(i + 1) : a.slice(i + 1) === b.slice(i); // missing / added
}

/** Most proposals a « Vouliez-vous dire » shows. */
const MAX_CORRECTIONS = 4;

/**
 * When `question` finds nothing: the same question with its unknown words (3 letters or
 * more, in no title of `answers`) replaced by title words one typo away — only the
 * versions that do find an answer, at most four. Untouched words, spacing and
 * punctuation are kept; the replacement keeps the title's accents (« conge » → « congé »).
 */
export function suggestCorrections(
  question: string, answers: HelpAnswer[], t: (key: string) => string, lang = 'fr',
): string[] {
  // Title words, normalized → as written (lower case, accents kept).
  const vocab = new Map<string, string>();
  for (const a of answers) {
    for (const raw of answerTitle(a, t, lang).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      const w = normalize(raw);
      if (w.length > 2 && !STOP_WORDS.has(w) && !vocab.has(w)) vocab.set(w, raw);
    }
  }
  const known = [...vocab.keys()];
  const fixes = new Map<string, string[]>();
  for (const w of new Set(subjectWords(question))) {
    if (w.length < 3 || found(known, variants(w))) continue;
    const near = known.filter(k => oneTypo(w, k));
    if (near.length) fixes.set(w, near);
  }
  if (!fixes.size) return [];

  // Every combination of fixes (capped), rebuilt over the original text.
  let combos: Map<string, string>[] = [new Map()];
  for (const [w, near] of fixes) {
    combos = combos.flatMap(c => near.map(k => new Map(c).set(w, k))).slice(0, 24);
  }
  const parts = question.split(/([^\p{L}\p{N}]+)/u);
  const scored = combos.map(c => {
    const text = parts.map(p => (c.has(normalize(p)) ? vocab.get(c.get(normalize(p))!)! : p)).join('');
    return { text, hits: rankAnswers(text, answers, t, lang).length };
  });
  return [...new Set(scored.filter(s => s.hits > 0).map(s => s.text))].slice(0, MAX_CORRECTIONS);
}

/**
 * `answers` sorted by how well they match `question`, weakest dropped. Per question word:
 * the word itself in the title counts 4, a synonym in the title 3, either in the text 1.
 *
 * Ties go to the title with the fewest words the question doesn't cover, so « Comment
 * rejeter un candidat ? » finds itself before « Comment accepter ou rejeter un candidat
 * depuis sa fiche ? »; then to the title that uses the question's exact words (« rejetés »
 * finds « Où sont les candidats rejetés ? » before « Comment rejeter un candidat ? »);
 * then to a FAQ answer over a documentation section; then to the order of `answers` (the
 * current page's entries come first).
 */
export function rankAnswers(
  question: string, answers: HelpAnswer[], t: (key: string) => string, lang = 'fr',
): HelpAnswer[] {
  const words = subjectWords(question);
  if (!words.length) return [];
  const asked = words.flatMap(variants);
  return answers
    .map((a, index) => {
      const titleText = answerTitle(a, t, lang);
      const title = tokens(titleText);
      const body  = tokens(answerText(a, t, lang));
      let score = 0;
      for (const w of words) {
        const [own, ...syn] = variants(w);
        if (found(title, [own])) score += 4;
        else if (found(title, syn)) score += 3;
        else if (found(body, [own, ...syn])) score += 1;
      }
      const extra = subjectWords(titleText).filter(w => !found([w], asked)).length;
      const exact = words.filter(w => title.includes(w)).length;
      return { a, score, extra, exact, faq: a.kind === 'doc' ? 1 : 0, index };
    })
    .filter(r => r.score >= MIN_SCORE)
    .sort((x, y) => y.score - x.score || x.extra - y.extra || y.exact - x.exact || x.faq - y.faq || x.index - y.index)
    .map(r => r.a);
}
