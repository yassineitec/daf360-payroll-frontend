import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Mise en page commune aux sections de l'administration paie, sur le modèle de /rh/admin :
 * en-tête puis contenu empilés à 16px, recherche de 360px dans l'en-tête, champ pays de
 * 240px à côté. À ajouter aux `styles` de chaque section.
 */
export const ADMIN_SECTION_STYLES = `
  .admin-section { display: flex; flex-direction: column; gap: 16px; }
  .admin-search  { width: 360px; max-width: 100%; }
  .admin-pays    { width: 240px; max-width: 100%; }
  @media (max-width: 640px) { .admin-search, .admin-pays { width: 100%; } }

  /* Liste vide : message centré (+ action), comme l'.empty-state des sections RH. */
  .admin-empty {
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    padding: 36px; text-align: center; color: var(--color-on-surface-variant);
  }
  .admin-empty p { margin: 0; font-size: 13px; }

  /* Tableau large : défilement horizontal plutôt qu'un débordement de la page. */
  .admin-table-scroll { overflow-x: auto; }

  /* Erreur dans une pop-up : bandeau (l'.error-banner des sections RH). */
  .admin-error-banner {
    margin-top: 8px; padding: 8px 12px; border-radius: 8px; font-size: 12px;
    background: var(--color-error-container); color: var(--color-on-error-container);
  }

  /* Bouton « Ajouter » : libellé sur écran large, icône « + » seule sur mobile (RH). */
  .admin-mobile-only { display: none; }
  @media (max-width: 640px) {
    .admin-desktop-only { display: none; }
    .admin-mobile-only  { display: inline-flex; }
  }
`;

/**
 * En-tête d'une section de l'administration paie, sur le modèle des sections de /rh/admin
 * (`.section-header` de holidays-admin) : à gauche un petit titre et une ligne d'aide, à
 * droite les commandes de la section (choix du pays, recherche, bouton « Ajouter »),
 * projetées. Sur mobile, les commandes passent sous le titre et prennent la largeur.
 */
@Component({
  selector: 'app-admin-section-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ash">
      <div class="ash__text">
        <h3 class="ash__title">{{ title() }}</h3>
        @if (subtitle()) {
          <p class="ash__sub">{{ subtitle() }}</p>
        }
      </div>
      <div class="ash__actions"><ng-content /></div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ash { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .ash__text { min-width: 0; flex: 1 1 260px; }
    .ash__title { font-size: 13px; font-weight: 700; margin: 0; color: var(--color-on-surface); }
    .ash__sub { font-size: 12px; color: var(--color-on-surface-variant); margin: 2px 0 0; }
    .ash__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .ash__actions:empty { display: none; }
    @media (max-width: 640px) {
      .ash__actions { flex: 1 1 100%; }
    }
  `],
})
export class AdminSectionHeaderComponent {
  readonly title    = input.required<string>();
  readonly subtitle = input<string | null | undefined>();
}
