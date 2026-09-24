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

export const SUPPORTED_CURRENCIES = ['TND', 'EUR', 'USD', 'EGP'] as const;

/** 1–3 characters drawn in the radial menu circle (`glyph`). */
export const CURRENCY_GLYPHS: Record<string, string> = { TND: 'DT', EUR: '€', USD: '$', EGP: 'E£' };

@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private readonly http = inject(HttpClient);

  /** 1 EUR = X currency. */
  readonly rates = signal<Record<string, number>>({ EUR: 1, USD: 1.08, TND: 3.35, EGP: 52.4 });

  /** Currency chosen in the radial menu; `null` = show each amount in its own currency. */
  readonly display = signal<string | null>(this.read(DISPLAY_KEY));

  constructor() {
    const cached = this.read(RATES_KEY);
    if (cached) {
      try {
        const entry = JSON.parse(cached) as { rates: Record<string, number>; ts: number };
        if (Date.now() - entry.ts < RATES_TTL_MS) { this.rates.set(entry.rates); return; }
      } catch { /* stale or corrupt cache — refetch */ }
    }
    this.http.get<{ conversion_rates: Record<string, number> }>('https://open.exchangerate-api.com/v6/latest/EUR')
      .subscribe({
        next: resp => {
          const rates = { ...resp.conversion_rates, EUR: 1 };
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
    return (amount / (r[from.toUpperCase()] ?? 1)) * (r[to.toUpperCase()] ?? 1);
  }

  private read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  private write(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  }
}
