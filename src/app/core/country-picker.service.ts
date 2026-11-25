import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import {
  CountryActions,
  type CountryOption,
  selectSelectedCountryId,
  selectSelectedCountryIds,
} from '@khalilrebhiitec/daf360';
import { environment } from '../../environments/environment';

/** GET /api/hr/ref/pays/header — une ligne par pays du sélecteur (périmètre du rôle). */
interface HeaderPaysResponse {
  id: number;
  labelFr: string | null;
  labelEn: string | null;
  isoCode: string | null;
}

/**
 * Le sélecteur de pays du bas de la barre latérale Paie (`daf-country-picker`, lib 5.19.0).
 *
 * Même source et même store que le shell, le RH et la finance : les ids sont ceux de la table
 * `pays` du RH (c'est ce que porte le store) — les mêmes que la paie. Le shell mémorise le choix et écarte les pays qui ne sont plus permis ;
 * ce service ne fait que fournir la liste et relayer les coches.
 */
@Injectable({ providedIn: 'root' })
export class CountryPickerService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(Store);
  private readonly translate = inject(TranslateService);

  private readonly raw = signal<HeaderPaysResponse[]>([]);
  private requested = false;

  readonly activeCountry = this.store.selectSignal(selectSelectedCountryId);
  readonly activeCountries = this.store.selectSignal(selectSelectedCountryIds);

  /** Pays proposés, libellés dans la langue courante. Vide = sélecteur masqué. */
  readonly countries = computed<CountryOption[]>(() => {
    const en = this.translate.currentLang() === 'en';
    return this.raw()
      .filter(p => Number.isInteger(p.id) && p.id > 0)
      .map(p => {
        const iso = normalizeIso(p.isoCode);
        return {
          id: p.id,
          label: (en && p.labelEn) || p.labelFr || `#${p.id}`,
          code: iso ?? undefined,
          flagClass: iso ? `fi fi-${iso.toLowerCase()}` : undefined,
        };
      });
  });

  /** Plusieurs pays cochables dès qu'il y a un choix à faire, comme dans le shell. */
  readonly multiCountry = computed(() => this.countries().length > 1);

  readonly allCountriesLabel = computed<string | undefined>(() => {
    this.translate.currentLang();
    if (!this.multiCountry()) return undefined;
    const key = 'PAYROLL.PAYSLIPS.HISTORY.FILTER_ALL_PAYS';
    const label = this.translate.instant(key);
    return label && label !== key ? label : 'Tous les pays';
  });

  load(): void {
    if (this.requested) return;
    this.requested = true;
    this.http
      .get<HeaderPaysResponse[]>(`${environment.hrApiUrl}/api/hr/ref/pays/header`, { withCredentials: true })
      .pipe(catchError(() => of<HeaderPaysResponse[]>([])))
      .subscribe(list => this.raw.set(list ?? []));
  }

  onCountryChange(country: CountryOption | null): void {
    this.select(country ? [country.id] : []);
  }

  onCountriesChange(countries: CountryOption[]): void {
    this.select(countries.map(c => c.id));
  }

  private select(ids: readonly (number | string)[]): void {
    this.store.dispatch(CountryActions.selectCountries({ countryIds: ids }));
  }
}

/** 'TN' → 'TN' ; tout ce qui n'est pas 2 lettres est écarté (pas de classe fi-xxx cassée). */
function normalizeIso(code: string | null | undefined): string | null {
  const c = (code ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}
