import { ChangeDetectionStrategy, Component, computed, input, output, signal, type Signal } from '@angular/core';
import { ButtonComponent, PaginationComponent } from '@khalilrebhiitec/daf360';

/**
 * Pièces communes aux sections de l'administration paie, reprises des sections de
 * /rh/admin (request-types-admin, holidays-admin…) :
 *  - indicateur de chargement centré (le `app-spinner` du RH) ;
 *  - bas de tableau « N éléments » + `daf-pagination`, 5 lignes par page ;
 *  - pied de pop-up Annuler / Enregistrer (vert, avec état de chargement) — dans le corps
 *    de la pop-up et non dans `ModalConfig.buttons`, figé à l'ouverture : c'est ce qui lui
 *    permet de suivre l'enregistrement en cours ;
 *  - découpage en pages d'une liste déjà filtrée.
 */

/** Lignes par page — même valeur que les sections de /rh/admin. */
export const ADMIN_PAGE_SIZE = 5;

/** Indicateur de chargement (copie du `app-spinner` de rh-frontend). */
@Component({
  selector: 'app-admin-spinner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="spinner" role="status" aria-label="Chargement…"></span>`,
  styles: [`
    :host { display: flex; justify-content: center; padding: 24px; }
    .spinner {
      display: inline-block; width: 32px; height: 32px;
      border: 3px solid var(--color-outline-variant, #E0E7E9);
      border-top-color: var(--color-primary, #1C4E5C);
      border-radius: 50%;
      animation: spin .7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class AdminSpinnerComponent {}

/** Bas de tableau : « N éléments » à gauche, pagination à droite dès qu'il y a 2 pages. */
@Component({
  selector: 'app-admin-table-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PaginationComponent],
  template: `
    <div class="atf">
      <span class="atf__count"><strong>{{ total() }}</strong> {{ unit() }}</span>
      @if (totalPages() > 1) {
        <daf-pagination
          [currentPage]="page()"
          [totalPages]="totalPages()"
          [totalElements]="total()"
          (pageChange)="pageChange.emit($event)" />
      }
    </div>
  `,
  styles: [`
    .atf { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .atf__count { font-size: 12px; color: var(--color-on-surface-variant); }
  `],
})
export class AdminTableFooterComponent {
  readonly total      = input.required<number>();
  readonly page       = input.required<number>();
  readonly totalPages = input.required<number>();
  /** Libellé de l'unité, déjà traduit (« élément(s) », « pays »…). */
  readonly unit       = input.required<string>();
  readonly pageChange = output<number>();
}

/** Pied de pop-up : Annuler (gris) + Enregistrer (vert, chargement pendant l'envoi). */
@Component({
  selector: 'app-admin-modal-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent],
  template: `
    <div class="amf">
      <daf-button [label]="cancelLabel()" variant="secondary" [options]="{ disabled: saving() }" (onClick)="cancel.emit()" />
      <daf-button [label]="saveLabel()" variant="teal" [options]="{ loading: saving(), disabled: saving() || disabled() }" (onClick)="save.emit()" />
    </div>
  `,
  styles: [`
    .amf {
      display: flex; justify-content: flex-end; gap: 12px;
      margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--color-outline-variant);
    }
  `],
})
export class AdminModalFooterComponent {
  readonly saveLabel   = input.required<string>();
  readonly cancelLabel = input.required<string>();
  readonly saving      = input(false);
  readonly disabled    = input(false);
  readonly save        = output<void>();
  readonly cancel      = output<void>();
}

/**
 * Découpe une liste (déjà filtrée) en pages de {@link ADMIN_PAGE_SIZE}. La page courante est
 * ramenée dans les bornes quand la liste rétrécit (recherche, filtre) — jamais de page vide.
 */
export class AdminPager<T> {
  readonly page = signal(0);
  readonly total: Signal<number>;
  readonly totalPages: Signal<number>;
  readonly current: Signal<number>;
  readonly rows: Signal<T[]>;

  constructor(source: () => T[], size = ADMIN_PAGE_SIZE) {
    this.total = computed(() => source().length);
    this.totalPages = computed(() => Math.max(1, Math.ceil(this.total() / size)));
    this.current = computed(() => Math.min(this.page(), this.totalPages() - 1));
    this.rows = computed(() => source().slice(this.current() * size, (this.current() + 1) * size));
  }

  go(page: number): void {
    this.page.set(page);
  }
}
