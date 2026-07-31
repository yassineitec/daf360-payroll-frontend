const { withNativeFederation, shareAll } =
  require('@angular-architects/native-federation/config');

module.exports = withNativeFederation({
  name: 'payroll',
  exposes: {
    './Routes': './src/app/app.routes.ts',
  },
  shared: {
    ...shareAll({
      singleton: true,
      strictVersion: false,
      requiredVersion: 'auto',
    }),
    '@angular/core': {
      singleton: true,
      strictVersion: false,
      requiredVersion: '^21.2.0',
    },
    '@angular/common': {
      singleton: true,
      strictVersion: false,
      requiredVersion: '^21.2.0',
    },
    '@angular/router': {
      singleton: true,
      strictVersion: false,
      requiredVersion: '^21.2.0',
    },
    '@angular/platform-browser': {
      singleton: true,
      strictVersion: false,
      requiredVersion: '^21.2.0',
    },
    '@angular/animations': {
      singleton: true,
      strictVersion: false,
      requiredVersion: '^21.2.0',
    },
    '@angular/animations/browser': {
      singleton: true,
      strictVersion: false,
      requiredVersion: '^21.2.0',
    },
    '@khalilrebhiitec/daf360': {
      singleton: true,
      strictVersion: false,
      requiredVersion: '^4.13.0',
    },
    '@ngrx/store': {
      singleton: true,
      strictVersion: false,
      requiredVersion: '^21.1.0',
    },
    '@ngrx/effects': {
      singleton: true,
      strictVersion: false,
      requiredVersion: '^21.1.0',
    },
    '@ngx-translate/core': {
      singleton: true,
      strictVersion: false,
      requiredVersion: 'auto',
    },
  },
  skip: ['rxjs/ajax', 'rxjs/fetch', 'rxjs/testing', 'rxjs/webSocket'],
});
