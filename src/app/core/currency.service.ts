import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

/**
 * Display-currency conversion for payroll KPI amounts — same approach as finance
 * (`daf360-facturation-frontend` `CurrencyRateService` + `CurrencyDisplayService`): live
 * EUR-based rates cached 24h, approximate fallback rates when the API is unreachable.
 * These are *today's* rates, for reading totals in another currency — not the rates the
 * engine froze at calculation time (`payroll_forex_snapshots`), which only exist for
 * countries with forex sources configured.
 */
const RATES_KEY    = 'payroll_currency_rates';
const DISPLAY_KEY  = 'payroll_display_currency';
const RATES_TTL_MS = 24 * 60 * 60 * 1000;

export const SUPPORTED_CURRENCIES = ['TND', 'EUR', 'USD', 'EGP', 'SAR', 'AED'] as const;

/** 1–3 characters drawn in the radial menu circle (`glyph`). */
export const CURRENCY_GLYPHS: Record<string, string> = { TND: 'DT', EUR: '€', USD: '$', EGP: 'E£', SAR: 'SR', AED: 'DH' };

/** 1 EUR = X currency — used as the initial signal value AND as the per-currency fallback
 *  inside convert() when a specific currency isn't in the live/cached set. */
const FALLBACK_RATES: Record<string, number> = { EUR: 1, USD: 1.08, TND: 3.35, EGP: 52.4, SAR: 4.05, AED: 3.97 };

/** A rate set is only trustworthy if EUR is ~1 and every currency this app offers is present as
 *  a finite, positive number — rejects a degenerate/corrupted set instead of silently using it. */
function isValidRateSet(rates: unknown): rates is Record<string, number> {
  if (!rates || typeof rates !== 'object') return false;
  const r = rates as Record<string, unknown>;
  const eur = r['EUR'];
  if (typeof eur !== 'number' || !Number.isFinite(eur) || Math.abs(eur - 1) > 0.0001) return false;
  for (const code of SUPPORTED_CURRENCIES) {
    const v = r[code];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return false;
  }
  return true;
}

@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private readonly http = inject(HttpClient);

  /** 1 EUR = X currency. */
  readonly rates = signal<Record<string, number>>({ ...FALLBACK_RATES });

  /** Currency chosen in the radial menu; `null` = show each amount in its own currency. */
  readonly display = signal<string | null>(this.read(DISPLAY_KEY));

  constructor() {
    const cached = this.read(RATES_KEY);
    if (cached) {
      try {
        const entry = JSON.parse(cached) as { rates: Record<string, number>; ts: number };
        if (Date.now() - entry.ts < RATES_TTL_MS && isValidRateSet(entry.rates)) {
          this.rates.set(entry.rates);
          return;
        }
      } catch { /* stale or corrupt cache — refetch */ }
    }
    this.http.get<{ conversion_rates: Record<string, number> }>('https://open.exchangerate-api.com/v6/latest/EUR')
      .subscribe({
        next: resp => {
          const rates = { ...resp.conversion_rates, EUR: 1 };
          if (!isValidRateSet(rates)) {
            console.warn('[CurrencyService] Fetched rate set failed validation — keeping existing rates.');
            return;
          }
          this.rates.set(rates);
          this.write(RATES_KEY, JSON.stringify({ rates, ts: Date.now() }));
        },
        error: () => { /* keep fallback rates */ },
      });
  }

  setDisplay(code: string | null): void {
    this.display.set(code);
    if (code) this.write(DISPLAY_KEY, code);
    else try { localStorage.removeItem(DISPLAY_KEY); } catch { /* storage unavailable */ }
  }

  convert(amount: number, from: string, to: string): number {
    if (from === to) return amount;
    const r = this.rates();
    const fromKey = from.toUpperCase();
    const toKey = to.toUpperCase();
    const fromRate = r[fromKey] ?? FALLBACK_RATES[fromKey] ?? 1;
    const toRate   = r[toKey]   ?? FALLBACK_RATES[toKey]   ?? 1;
    return (amount / fromRate) * toRate;
  }

  /** True when converting this currency code would need FALLBACK_RATES because it isn't in the
   *  current live/cached rate set — callers displaying a converted total should flag the result
   *  as approximate rather than presenting it as exact. */
  needsFallbackRate(code: string): boolean {
    return !(code.toUpperCase() in this.rates());
  }

  private read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  private write(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  }
}
