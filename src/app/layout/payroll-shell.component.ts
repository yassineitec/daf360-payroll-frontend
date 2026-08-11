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
import { environment } from '../../environments/environment';

interface AppNavDef {
  id:         string;
  label:      string;
  icon:       string;
  route:      string;
  permission: string | null;
}

const APP_NAV_DEFS: AppNavDef[] = [
  { id: 'simulator',      label: 'Simulateur individuel', icon: 'calculate',            route: 'simulator',      permission: 'PAYROLL_RUN_SIMULATION' },
  { id: 'cohort',         label: 'Simulation cohorte',    icon: 'groups',               route: 'cohort',         permission: 'PAYROLL_RUN_SIMULATION' },
  { id: 'engine-run',     label: 'Calcul de paie',        icon: 'payments',             route: 'engine-run',     permission: 'PAYROLL_RUN_ENGINE' },
  { id: 'engine-results', label: 'Historique de paie',    icon: 'history',              route: 'engine-results', permission: 'PAYROLL_VIEW_RESULTS' },
  { id: 'calibration',    label: 'Calibration',           icon: 'tune',                 route: 'calibration',    permission: 'PAYROLL_RUN_CALIBRATION' },
  { id: 'parameter-sets', label: 'Paramètres',            icon: 'settings_applications', route: 'parameter-sets', permission: 'PAYROLL_VIEW_PARAMSET' },
  { id: 'budget',         label: 'Budget prévisionnel',   icon: 'account_balance',      route: 'budget',         permission: 'PAYROLL_VIEW_BUDGET_AGGREGATE' },
  { id: 'admin',          label: 'Administration',        icon: 'admin_panel_settings', route: 'admin',          permission: 'PAYROLL_SUPER_ADMIN' },
];

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

  readonly activeRoute = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url, injector: this.injector },
  );

  readonly sideNavConfig: SideNavConfig = {
    sectionLabel: 'PAIE',
    collapsible: true,
  };

  readonly navItems = computed<NavItem[]>(() =>
    APP_NAV_DEFS.filter(
      def => !def.permission || this.userStore.hasPermission(def.permission),
    ).map(def => ({ id: def.id, label: def.label, icon: def.icon, route: def.route })),
  );

  onNavClick(item: NavItem): void {
    if (item.route) {
      this.router.navigate([item.route], { relativeTo: this.activatedRoute });
    }
  }
}
