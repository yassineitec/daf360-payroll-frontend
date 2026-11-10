import { Directive, Injectable, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/** Voice region tried first for each UI language. */
const PREFERRED: Record<string, string> = { fr: 'fr-FR', en: 'en-US', ar: 'ar-SA' };
/** The guide reads each step aloud when this is '1' (the reader's choice, per browser). */
// Same key as the RH module: the read-aloud choice follows the user across modules.
const AUTO_KEY = 'rh-guide-voice';

/**
 * Read-aloud of the help texts with the browser's own voices (Web Speech API,
 * `speechSynthesis`) — no server, no AI. Only offered when the browser has a voice for the
 * UI language: Arabic is often missing on Windows, and a French voice reading Arabic would
 * be worse than nothing.
 */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  private readonly translate = inject(TranslateService);
  private readonly synth: SpeechSynthesis | null =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

  private readonly voices = signal<SpeechSynthesisVoice[]>([]);
  /** True while something is being read. */
  readonly speaking = signal(false);
  /** Index of the part being read in the last `speak()` call, null when silent. */
  readonly part = signal<number | null>(null);
  /** The guide reads each step as it opens. */
  readonly auto = signal(this.readAuto());

  private readonly lang = computed(() => (this.translate.currentLang() || 'fr').slice(0, 2));

  /** The voice for the UI language, if the browser has one. */
  private readonly voice = computed(() => {
    const lang = this.lang();
    const list = this.voices();
    return list.find(v => v.lang === PREFERRED[lang])
      ?? list.find(v => v.lang.toLowerCase().startsWith(lang));
  });

  /** Read-aloud can be offered: speech supported and a voice for the UI language. */
  readonly available = computed(() => !!this.synth && !!this.voice());

  /** Run counter: a newer `speak()` makes the older one's callbacks no-ops. */
  private run = 0;
  /** Who started the current reading (`speak(parts, owner)`), for `stopIf`. */
  private owner: string | null = null;

  constructor() {
    if (!this.synth) return;
    const load = () => this.voices.set(this.synth!.getVoices());
    load();
    // Chrome fills the list asynchronously.
    this.synth.addEventListener?.('voiceschanged', load);
  }

  /** Reads `parts` one after the other; `part` follows along. Stops anything already playing. */
  speak(parts: string[], owner: string | null = null): void {
    const synth = this.synth;
    const voice = this.voice();
    if (!synth || !voice) return;
    this.stop();
    const run = ++this.run;
    this.owner = owner;
    const texts = parts.map(p => p.trim()).filter(Boolean);
    if (!texts.length) return;
    this.speaking.set(true);
    texts.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 1;
      u.onstart = () => { if (run === this.run) this.part.set(i); };
      u.onend = u.onerror = () => {
        if (run !== this.run || i !== texts.length - 1) return;
        this.speaking.set(false);
        this.part.set(null);
      };
      synth.speak(u);
    });
  }

  /** Stops the reading only if `owner` started it — a window closing leaves the guide's alone. */
  stopIf(owner: string): void {
    if (this.owner === owner) this.stop();
  }

  stop(): void {
    this.owner = null;
    this.run++;
    this.synth?.cancel();
    this.speaking.set(false);
    this.part.set(null);
  }

  setAuto(on: boolean): void {
    this.auto.set(on);
    try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* kept for this visit only */ }
    if (!on) this.stop();
  }

  private readAuto(): boolean {
    try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; }
  }
}

/**
 * Stops the reading when its host leaves the DOM — put on the body of a library modal,
 * which has no close callback (✕, Échap, click outside all just destroy the view).
 */
@Directive({ selector: '[appStopSpeechOnDestroy]', standalone: true })
export class StopSpeechOnDestroyDirective implements OnDestroy {
  private readonly speech = inject(SpeechService);
  /** The `owner` passed to `speak()` by the host: only that reading is stopped. */
  readonly appStopSpeechOnDestroy = input.required<string>();
  ngOnDestroy(): void { this.speech.stopIf(this.appStopSpeechOnDestroy()); }
}
