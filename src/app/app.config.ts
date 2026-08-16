import {
  APP_INITIALIZER,
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from "@angular/core";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { provideStore } from "@ngrx/store";
import { provideEffects } from "@ngrx/effects";
import { rootReducers } from "@khalilrebhiitec/daf360";
import { provideTranslateService, TranslateLoader } from "@ngx-translate/core";
import { routes } from "./app.routes";
import { authInterceptor } from "./core/auth.interceptor";
import { UserStore } from "./core/user.store";
import { DEFAULT_LANG, resolveInitialLang } from "./core/language-preference";
import { InlineTranslateLoader } from "./core/inline-translate.loader";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideStore(rootReducers),
    {
      provide: APP_INITIALIZER,
      useFactory: (userStore: UserStore) => () => userStore.loadCurrentUser(),
      deps: [UserStore],
      multi: true,
    },
    // Racine — n'est utilisée QUE lorsque la paie tourne en autonome (`npm start`, port
    // 4205) : montée dans le shell, c'est le `TranslateService` du shell qui est racine et
    // ce fichier n'est pas exécuté. Les catalogues sont embarqués (voir
    // `core/inline-translate.loader.ts`) ; l'ancien chargeur HTTP visait
    // `/assets/i18n/*.json`, un dossier qui n'existe pas côté paie.
    ...provideTranslateService({
      fallbackLang: DEFAULT_LANG,
      lang: resolveInitialLang(),
      loader: { provide: TranslateLoader, useClass: InlineTranslateLoader },
    }),
  ],
};
