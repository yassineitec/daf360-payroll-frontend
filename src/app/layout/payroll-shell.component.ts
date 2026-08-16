import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component,
  Injector, OnInit, computed, inject,
} from '@angular/core';
import { Router, NavigationEnd, RouterOutlet, ActivatedRoute } from '@angular/router';
import { filter, map } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { SideNavComponent } from '@khalilrebhiitec/daf360';
import type { NavItem, SideNavConfig } from '@khalilrebhiitec/daf360';
import { UserStore } from '../core/user.store';
import { RemoteStylesService } from '../core/remote-styles.service';
import { PAYROLL_NAV_DEFS, activeNavRoute } from '../core/payroll-nav';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-payroll-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, SideNavComponent],
  templateUrl: './payroll-shell.component.html',
  styleUrl: './payroll-shell.component.scss',
})
export class PayrollShellComponent implements OnInit {
  private readonly userStore    = inject(UserStore);
  private readonly router       = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly remoteStyles = inject(RemoteStylesService);
  private readonly injector     = inject(Injector);
  private readonly cdr          = inject(ChangeDetectorRef);

  ngOnInit(): void {
    this.remoteStyles.injectStyles(environment.stylesUrl);
    this.cdr.detectChanges();
  }

  private readonly rawUrl = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url, injector: this.injector },
  );

  /**
   * The URL reduced to a nav segment — `daf-side-nav` compares by strict equality, so
   * handing it the absolute `/payroll/simulator` left every entry unlit. See
   * `core/payroll-nav.ts`.
   */
  readonly activeRoute = computed(() => activeNavRoute(this.rawUrl() ?? ''));

  readonly sideNavConfig: SideNavConfig = {
    sectionLabel: 'PAIE',
    collapsible: true,
  };

  /** Entries the user is allowed to see. Codes live in `core/payroll-nav.ts` and are the
   *  same ones the route guards enforce, so the sidebar can't offer a page that bounces. */
  readonly navItems = computed<NavItem[]>(() =>
    PAYROLL_NAV_DEFS
      .filter(def =>
        !def.permissions.length ||
        def.permissions.some(code => this.userStore.hasPermission(code)),
      )
      .map(def => ({ id: def.id, label: def.label, icon: def.icon, route: def.route })),
  );

  onNavClick(item: NavItem): void {
    if (item.route) {
      this.router.navigate([item.route], { relativeTo: this.activatedRoute });
    }
  }
}
