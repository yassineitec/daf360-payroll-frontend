import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CurrencyService } from './currency.service';

describe('CurrencyService', () => {
  let httpMock: HttpTestingController;
  const RATES_KEY = 'payroll_currency_rates';
  const DISPLAY_KEY = 'payroll_display_currency';

  beforeEach(() => {
    localStorage.removeItem(RATES_KEY);
    localStorage.removeItem(DISPLAY_KEY);
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.removeItem(RATES_KEY);
    localStorage.removeItem(DISPLAY_KEY);
  });

  it('rejects a cached entry missing a required currency and fetches fresh instead', () => {
    localStorage.setItem(RATES_KEY, JSON.stringify({ rates: { EUR: 1, USD: 1.08 }, ts: Date.now() }));

    const service = TestBed.inject(CurrencyService);

    httpMock.expectOne('https://open.exchangerate-api.com/v6/latest/EUR')
      .flush({ conversion_rates: { EUR: 1, USD: 1.08, TND: 3.35, EGP: 52.4, SAR: 4.05, AED: 3.97 } });

    expect(service.rates()['TND']).toBe(3.35);
  });

  it('rejects a cached entry where EUR is not ~1 and fetches fresh instead', () => {
    localStorage.setItem(RATES_KEY, JSON.stringify({
      rates: { EUR: 1000, USD: 1080, TND: 3350, EGP: 52400, SAR: 4050, AED: 3970 }, ts: Date.now(),
    }));

    const service = TestBed.inject(CurrencyService);

    httpMock.expectOne('https://open.exchangerate-api.com/v6/latest/EUR')
      .flush({ conversion_rates: { EUR: 1, USD: 1.08, TND: 3.35, EGP: 52.4, SAR: 4.05, AED: 3.97 } });

    expect(service.rates()['EUR']).toBe(1);
  });

  it('rejects a cached entry with a zero/negative rate for a required currency and fetches fresh instead', () => {
    localStorage.setItem(RATES_KEY, JSON.stringify({
      rates: { EUR: 1, USD: 1.08, TND: 0, EGP: 52.4, SAR: 4.05, AED: 3.97 }, ts: Date.now(),
    }));

    const service = TestBed.inject(CurrencyService);

    httpMock.expectOne('https://open.exchangerate-api.com/v6/latest/EUR')
      .flush({ conversion_rates: { EUR: 1, USD: 1.08, TND: 3.35, EGP: 52.4, SAR: 4.05, AED: 3.97 } });

    expect(service.rates()['TND']).toBe(3.35);
  });

  it('accepts a valid cached entry as-is, with no fetch', () => {
    localStorage.setItem(RATES_KEY, JSON.stringify({
      rates: { EUR: 1, USD: 1.08, TND: 3.4, EGP: 52.0, SAR: 4.0, AED: 3.9 }, ts: Date.now(),
    }));

    const service = TestBed.inject(CurrencyService);

    httpMock.expectNone('https://open.exchangerate-api.com/v6/latest/EUR');
    expect(service.rates()['TND']).toBe(3.4);
  });

  it('ignores an invalid fetch response and keeps the existing rates', () => {
    const service = TestBed.inject(CurrencyService);
    const before = service.rates();

    httpMock.expectOne('https://open.exchangerate-api.com/v6/latest/EUR')
      .flush({ conversion_rates: { EUR: 1, USD: 1.08 } });

    expect(service.rates()).toEqual(before);
  });

  it('a valid fetch response replaces rates() with the fetched rates', () => {
    const service = TestBed.inject(CurrencyService);

    const fetched = { EUR: 1, USD: 1.08, TND: 3.4, EGP: 52.0, SAR: 4.0, AED: 3.9 };
    httpMock.expectOne('https://open.exchangerate-api.com/v6/latest/EUR')
      .flush({ conversion_rates: fetched });

    expect(service.rates()).toEqual(fetched);
  });

  it('convert() uses the real rate for a currency present in rates()', () => {
    const service = TestBed.inject(CurrencyService);
    httpMock.expectOne('https://open.exchangerate-api.com/v6/latest/EUR')
      .flush({ conversion_rates: { EUR: 1, USD: 1.08, TND: 3.4, EGP: 52.0, SAR: 4.0, AED: 3.9 } });

    expect(service.convert(100, 'EUR', 'TND')).toBeCloseTo(340, 5);
  });

  it('convert() falls back to the named FALLBACK_RATES entry, not a blanket 1:1, for a currency missing from rates()', () => {
    const service = TestBed.inject(CurrencyService);
    httpMock.expectOne('https://open.exchangerate-api.com/v6/latest/EUR')
      .flush({ conversion_rates: { EUR: 1, USD: 1.08, TND: 3.4, EGP: 52.0, SAR: 4.0, AED: 3.9 } });

    // SUPPORTED_CURRENCIES and FALLBACK_RATES list the same 6 codes today, so isValidRateSet()
    // guarantees any rates() a real fetch/cache can produce already contains every currency
    // FALLBACK_RATES has — there is no validly-reachable live/cached state that omits one of
    // them, so this exact scenario can't be constructed through the public fetch/cache paths
    // alone. To exercise convert()'s per-currency-fallback branch itself — the actual headline
    // fix, a named rate instead of a blanket 1:1 — simulate that state directly via the public
    // `rates` signal, as if TND had dropped out of an otherwise-valid set (e.g. a future/partial
    // API response).
    const { TND, ...withoutTnd } = service.rates();
    service.rates.set(withoutTnd);

    // The pre-fix bug used a blanket `?? 1`, which would return 100 here. The real named
    // fallback for TND is 3.35, so a correct result is 335, not 100.
    expect(service.convert(100, 'EUR', 'TND')).toBeCloseTo(335, 5);
  });

  it('needsFallbackRate() reports true only for a currency absent from the current rates()', () => {
    const service = TestBed.inject(CurrencyService);
    httpMock.expectOne('https://open.exchangerate-api.com/v6/latest/EUR')
      .flush({ conversion_rates: { EUR: 1, USD: 1.08, TND: 3.4, EGP: 52.0, SAR: 4.0, AED: 3.9 } });

    expect(service.needsFallbackRate('TND')).toBe(false);
    expect(service.needsFallbackRate('GBP')).toBe(true);
  });
});
