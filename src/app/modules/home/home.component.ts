import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CardComponent, PageComponent, PageHeaderComponent } from '@khalilrebhiitec/daf360';
import type { CardOptions } from '@khalilrebhiitec/daf360';
import { UserStore } from '../../core/user.store';
import { PAYROLL_NAV_DEFS } from '../../core/payroll-nav';

interface ModuleCard {
  id:      string;
  route:   string;
  options: CardOptions;
}

type Tone = 'primary' | 'secondary' | 'tertiary' | 'teal' | 'warning' | 'danger';

/** Tone → `daf-card` icon classes, same literal lib tokens as the finance home. */
const TONE_ICON: Record<Tone, { iconColor: string; iconBg: string }> = {
  primary:   { iconColor: 'text-primary',   iconBg: 'bg-primary/10'   },
  secondary: { iconColor: 'text-secondary', iconBg: 'bg-secondary/10' },
  tertiary:  { iconColor: 'text-tertiary',  iconBg: 'bg-tertiary/10'  },
  teal:      { iconColor: 'text-teal',      iconBg: 'bg-teal/10'      },
  warning:   { iconColor: 'text-warning',   iconBg: 'bg-warning/10'   },
  danger:    { iconColor: 'text-danger',    iconBg: 'bg-danger/10'    },
};

/** Card tone per nav id — an id missing here falls back to `primary`. */
const MODULE_TONE: Record<string, Tone> = {
  'simulator':            'primary',
  'payslips':             'teal',
  'employee-config':      'secondary',
  'cohort':               'tertiary',
  'engine-run':           'warning',
  'engine-results':       'teal',
  'candidate-simulation': 'tertiary',
  'calibration':          'secondary',
  'parameter-sets':       'danger',
  'budget':               'warning',
};

/**
 * Accueil paie — same shape as the finance home: daf-page + daf-page-header, then one card
 * per screen. Cards come from `PAYROLL_NAV_DEFS`, the same list as the sidebar, filtered on
 * the same permission codes, so the page never offers a card the route guard would bounce.
 * Groups ("Historique de paie") are flattened: the home lists screens, not menu folders.
 */
@Component({
  selector: 'app-payroll-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, PageComponent, PageHeaderComponent, CardComponent],
  templateUrl: './home.component.html',
})
export class HomeComponent {
  private readonly userStore      = inject(UserStore);
  private readonly router         = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly translate      = inject(TranslateService);

  readonly firstName = computed(() => (this.userStore.currentUser()?.fullName ?? '').split(' ')[0]);

  /** `currentLang()` is read so titles re-translate on a language switch — `daf-card`
   *  takes an options object, so the pipe can't do it. */
  readonly moduleCards = computed<ModuleCard[]>(() => {
    this.translate.currentLang();
    this.userStore.permissions();

    return PAYROLL_NAV_DEFS
      .flatMap(def => def.children ?? [def])
      .filter(def => !!def.route && def.id !== 'accueil')
      .filter(def =>
        !def.permissions.length ||
        def.permissions.some(code => this.userStore.hasPermission(code)),
      )
      .map(def => ({
        id:    def.id,
        route: def.route!,
        options: {
          variant:     'glass',
          padding:     'md',
          radius:      'xl',
          hoverable:   true,
          clickable:   true,
          fullHeight:  true,
          icon:        def.icon,
          iconFilled:  true,
          ...TONE_ICON[MODULE_TONE[def.id] ?? 'primary'],
          title:       this.translate.instant(def.labelKey),
          description: this.translate.instant(`PAYROLL.HOME.DESC.${def.labelKey.split('.').pop()}`),
        } satisfies CardOptions,
      }));
  });

  navigateTo(route: string): void {
    this.router.navigate(['../', route], { relativeTo: this.activatedRoute });
  }
}
