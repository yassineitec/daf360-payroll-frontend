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
import { provideTranslateService } from "@ngx-translate/core";
import { provideTranslateHttpLoader } from "@ngx-translate/http-loader";
import { routes } from "./app.routes";
import { authInterceptor } from "./core/auth.interceptor";
import { UserStore } from "./core/user.store";

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
    ...provideTranslateService({ fallbackLang: "fr", lang: "fr" }),
    ...provideTranslateHttpLoader({ prefix: "/assets/i18n/", suffix: ".json" }),
  ],
};
