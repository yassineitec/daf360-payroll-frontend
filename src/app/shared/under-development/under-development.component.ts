import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

interface UnderDevelopmentRouteData {
  titleKey: string;
}

/**
 * Placeholder for a route whose real component still exists in the codebase but isn't
 * routed to yet — same look as the finance P&L page (`facturation/reporting`). Swap it
 * back in `*.routes.ts` when the module ships — nothing here needs to change.
 */
@Component({
  selector: 'app-under-development',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="placeholder-page">
      <h2>{{ titleKey | translate }}</h2>
      <p>{{ 'PAYROLL.COMMON.UNDER_DEVELOPMENT_TITLE' | translate }}.</p>
    </div>
  `,
  styles: [`.placeholder-page { padding: 1rem; color: #475569; }`],
})
export class UnderDevelopmentComponent {
  readonly titleKey = (inject(ActivatedRoute).snapshot.data as UnderDevelopmentRouteData).titleKey;
}
